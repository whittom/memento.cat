import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "../src/connectors/types";
import { PlatformError } from "../src/lib/errors";
import { purgesDeletedContent, verifyBatch } from "../src/verify";

type Post = { id: string; native_ref: string; r2_prefix: string };
interface Stmt { sql: string; args: unknown[] }

const posts: Post[] = [
  { id: "p1", native_ref: "t3_a", r2_prefix: "reddit/auteur/2026/09/2026-09-01_a/" },
  { id: "p2", native_ref: "t3_b", r2_prefix: "reddit/auteur/2026/09/2026-09-02_b/" },
  { id: "p3", native_ref: "t3_c", r2_prefix: "reddit/auteur/2026/09/2026-09-03_c/" },
];

/** Environnement simulé : base D1 et stockage R2 qui journalisent leurs appels dans l'ordre. */
function fakeEnv(platform: Platform, rows: Post[] = posts) {
  const journal: string[] = [];
  const batches: Stmt[][] = [];
  const r2Deleted: string[] = [];
  const stmt = (sql: string, args: unknown[]) => ({
    sql, args,
    first: () => Promise.resolve(sql.includes("FROM creators") ? { id: "c1", platform, handle: "auteur", state: "active" } : { n: 0 }),
    all: () => Promise.resolve({ results: rows }),
    run: () => Promise.resolve({}),
  });
  const DB = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => stmt(sql, args) }),
    batch: (statements: Stmt[]) => {
      batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
      journal.push(`d1:${statements[0]?.sql.slice(0, 20)}`);
      return Promise.resolve([]);
    },
  };
  const MEDIA = {
    list: ({ prefix }: { prefix: string }) => Promise.resolve({ objects: [{ key: `${prefix}post.json` }, { key: `${prefix}media_01.jpg` }], truncated: false }),
    delete: (keys: string[]) => {
      r2Deleted.push(...keys);
      journal.push("r2:delete");
      return Promise.resolve();
    },
  };
  const env = { DB, MEDIA, REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret", REDDIT_USER_AGENT: "cloudflare-worker:memento:v0.1 (by /u/test)" } as unknown as Env;
  return { env, batches, r2Deleted, journal };
}

const t3 = (name: string, over: Record<string, unknown> = {}) => ({ kind: "t3", data: { name, author: "auteur", removed_by_category: null, selftext: "", ...over } });

/** Simule Reddit : jeton OAuth puis /api/info avec la réponse donnée. */
function stubReddit(info: () => Response) {
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = String(input);
    if (url.includes("access_token")) return Promise.resolve(Response.json({ access_token: "jeton" }));
    if (url.includes("/api/info")) return Promise.resolve(info());
    return Promise.resolve(new Response("?", { status: 404 }));
  });
}

describe("vérification des suppressions : politique par plateforme", () => {
  it("n'efface que Reddit", () => {
    expect(purgesDeletedContent("reddit")).toBe(true);
    expect(purgesDeletedContent("bluesky")).toBe(false);
    expect(purgesDeletedContent("mastodon")).toBe(false);
  });
});

describe("Reddit : effacement d'une publication supprimée à la source", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("efface les publications retirées ou absentes (fichiers puis lignes) et garde les autres", async () => {
    stubReddit(() => Response.json({ data: { children: [t3("t3_a"), t3("t3_b", { removed_by_category: "moderator" })] } }));
    const { env, batches, r2Deleted, journal } = fakeEnv("reddit");

    const r = await verifyBatch(env, "c1", null);

    expect(r).toMatchObject({ processed: 3, deleted: 0, purged: 2, remaining: 0 });
    // Fichiers R2 des deux publications effacées, jamais ceux de la publication encore en ligne.
    expect(r2Deleted.sort()).toEqual([
      "reddit/auteur/2026/09/2026-09-02_b/media_01.jpg", "reddit/auteur/2026/09/2026-09-02_b/post.json",
      "reddit/auteur/2026/09/2026-09-03_c/media_01.jpg", "reddit/auteur/2026/09/2026-09-03_c/post.json",
    ]);
    // Lignes D1 : trois requêtes par publication (médias, index de recherche, publication).
    const erased = batches.find((b) => b.some((s) => s.sql.startsWith("DELETE FROM posts WHERE")));
    expect(erased).toHaveLength(6);
    expect(erased?.filter((s) => s.sql.startsWith("DELETE FROM posts WHERE")).map((s) => s.args[0])).toEqual(["p2", "p3"]);
    expect(erased?.filter((s) => s.sql.startsWith("DELETE FROM media")).map((s) => s.args[0])).toEqual(["p2", "p3"]);
    expect(erased?.filter((s) => s.sql.includes("posts_fts")).map((s) => s.args[0])).toEqual(["p2", "p3"]);
    // Aucune publication Reddit n'est marquée « supprimée » : elle est effacée ou vérifiée.
    expect(batches.flat().some((s) => s.sql.includes("status = 'deleted'"))).toBe(false);
    const checked = batches.find((b) => b.every((s) => s.sql.startsWith("UPDATE posts SET checked_at")));
    expect(checked?.map((s) => s.args.at(-1))).toEqual(["p1"]);
    // Les fichiers sont effacés avant les lignes : un échec R2 ne laisse pas de fichiers orphelins.
    expect(journal.indexOf("r2:delete")).toBeLessThan(journal.findIndex((e) => e.startsWith("d1:DELETE")));
  });

  it("n'efface rien quand l'API répond sans liste de publications", async () => {
    stubReddit(() => Response.json({ message: "Forbidden" }));
    const { env, batches, r2Deleted } = fakeEnv("reddit");
    await expect(verifyBatch(env, "c1", null)).rejects.toBeInstanceOf(PlatformError);
    expect(r2Deleted).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("n'efface rien sur une erreur du serveur ni sur un quota atteint", async () => {
    for (const status of [500, 429]) {
      stubReddit(() => new Response("{}", { status }));
      const { env, batches, r2Deleted } = fakeEnv("reddit");
      await expect(verifyBatch(env, "c1", null)).rejects.toBeDefined();
      expect(r2Deleted).toEqual([]);
      expect(batches).toEqual([]);
    }
  });

  it("n'efface rien quand toutes les publications sont en ligne", async () => {
    stubReddit(() => Response.json({ data: { children: ["t3_a", "t3_b", "t3_c"].map((n) => t3(n)) } }));
    const { env, r2Deleted } = fakeEnv("reddit");
    expect(await verifyBatch(env, "c1", null)).toMatchObject({ processed: 3, deleted: 0, purged: 0 });
    expect(r2Deleted).toEqual([]);
  });
});

describe("Bluesky : la copie d'une publication supprimée est conservée", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marque la publication « supprimée » sans rien effacer", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ posts: [{ uri: "at://x/p1" }] })));
    const rows: Post[] = [{ id: "bluesky:p1", native_ref: "at://x/p1", r2_prefix: "bluesky/x/1/" }, { id: "bluesky:p2", native_ref: "at://x/p2", r2_prefix: "bluesky/x/2/" }];
    const { env, batches, r2Deleted } = fakeEnv("bluesky", rows);

    const r = await verifyBatch(env, "c1", null);

    expect(r).toMatchObject({ processed: 2, deleted: 1, purged: 0 });
    expect(r2Deleted).toEqual([]);
    const sql = batches.flat().map((s) => s.sql);
    expect(sql.some((s) => s.includes("status = 'deleted'"))).toBe(true);
    expect(sql.some((s) => s.startsWith("DELETE"))).toBe(false);
  });
});
