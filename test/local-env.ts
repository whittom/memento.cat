import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Environnement de test proche du Worker : une vraie base SQLite (node:sqlite, FTS5 compris) qui reçoit
 * les migrations du dépôt et répond comme D1, et un faux R2 en mémoire dont l'ETag est le MD5 du contenu,
 * comme R2 pour un envoi en une partie.
 */

const normalize = (v: unknown): unknown => (typeof v === "boolean" ? (v ? 1 : 0) : v);

function d1(sqlite: DatabaseSync): D1Database {
  const statement = (sql: string, args: unknown[] = []) => {
    const exec = () => sqlite.prepare(sql);
    const params = args.map(normalize);
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      first: (column?: string) => {
        const row = exec().get(...params) ?? null;
        return Promise.resolve(row && column ? (row[column] ?? null) : row);
      },
      all: () => Promise.resolve({ results: exec().all(...params), success: true, meta: {} }),
      run: () => {
        const r = exec().run(...params);
        return Promise.resolve({ results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } });
      },
      raw: () => Promise.resolve(exec().all(...params).map((r) => Object.values(r))),
    };
  };
  type Stmt = ReturnType<typeof statement>;
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Stmt[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    exec: (sql: string) => {
      sqlite.exec(sql);
      return Promise.resolve({ count: 0, duration: 0 });
    },
  } as unknown as D1Database;
}

export interface FakeBucket {
  bucket: R2Bucket;
  files: Map<string, Uint8Array>;
}

function bucket(): FakeBucket {
  const files = new Map<string, Uint8Array>();
  const types = new Map<string, string | undefined>();
  const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
  const toBytes = async (body: unknown): Promise<Uint8Array> => {
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    return new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
  };
  const object = (key: string) => {
    const data = files.get(key);
    if (!data) return null;
    return {
      key,
      size: data.byteLength,
      etag: md5(data),
      httpMetadata: { contentType: types.get(key) },
      get body() {
        return new Response(data).body;
      },
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(data)) as unknown),
    };
  };
  const b = {
    put: async (key: string, body: unknown, opts?: { httpMetadata?: { contentType?: string } }) => {
      const data = await toBytes(body);
      files.set(key, data);
      types.set(key, opts?.httpMetadata?.contentType);
      return { key, size: data.byteLength, etag: md5(data) };
    },
    get: (key: string) => Promise.resolve(object(key)),
    head: (key: string) => Promise.resolve(object(key)),
    delete: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) files.delete(k);
      return Promise.resolve();
    },
    list: (opts: { prefix?: string; limit?: number } = {}) => {
      const keys = [...files.keys()].filter((k) => k.startsWith(opts.prefix ?? "")).sort();
      const limit = opts.limit ?? 1000;
      return Promise.resolve({ objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit });
    },
  };
  return { bucket: b as unknown as R2Bucket, files };
}

export function localEnv(): { env: Env; sqlite: DatabaseSync; media: FakeBucket } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  // Vitest s'exécute à la racine du dépôt.
  for (const name of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const media = bucket();
  const env = { DB: d1(sqlite), MEDIA: media.bucket, REQUIRE_ACCESS: "false" } as unknown as Env;
  return { env, sqlite, media };
}
