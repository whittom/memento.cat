import { describe, expect, it } from "vitest";
import { collectCreator, syncCreator } from "../src/collect";
import type { FetchResult, NormalizedPost } from "../src/connectors/types";
import { Budget } from "../src/lib/budget";
import { BudgetExhaustedError, HttpError } from "../src/lib/errors";
import type { Config } from "../src/lib/config";
import type { CreatorRow } from "../src/storage/db";

const config: Config = {
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 40, maxPagesPerCreator: 3, maxMediaBytes: 1, rateLimitFloor: 10, redditUserAgent: "",
};

const creator = (state: CreatorRow["state"], cursor: string | null = null): CreatorRow => ({
  id: "bluesky:did:plc:abc", platform: "bluesky", handle: "exemple.bsky.social", display_name: null, state,
  deleted_at: null, cursor, created_at: "2026-09-01T00:00:00.000Z", last_run_at: null, last_success_at: null, last_error: null,
});

const post = (n: number): NormalizedPost => ({
  id: `bluesky:p${n}`, platform: "bluesky", creatorId: "bluesky:did:plc:abc", nativeRef: `at://x/p${n}`, nativeId: `p${n}`,
  publishedAt: `2026-09-0${n}T12:00:00.000Z`, title: null, text: "", sourceUrl: `https://bsky.app/p${n}`, media: [],
});

/** Base D1 factice : enregistre les requêtes d'écriture, répond aux lectures selon le SQL. */
function fakeDb(opts: { creator?: CreatorRow | null; existing?: string[] } = {}) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const bound = (args: unknown[]) => ({
        first: () => {
          if (sql.includes("FROM creators")) return Promise.resolve(opts.creator ?? null);
          if (sql.includes("FROM posts WHERE id")) return Promise.resolve(opts.existing?.includes(String(args[0])) ? { x: 1 } : null);
          return Promise.resolve(null);
        },
        run: () => {
          writes.push({ sql, args });
          return Promise.resolve({});
        },
      });
      return { bind: (...args: unknown[]) => bound(args) };
    },
  };
  return { db: db as unknown as D1Database, writes };
}

const connector = (result: FetchResult) => ({ fetchSince: () => Promise.resolve(result) });
const env = (db: D1Database) => ({ DB: db }) as unknown as Env;

describe("synchronisation manuelle : garde-fous", () => {
  const cases: [string, CreatorRow | null, number][] = [
    ["créateur inconnu", null, 404],
    ["effacement en cours", creator("purging"), 404],
    ["corbeille", creator("deleted"), 409],
    ["synchronisation désactivée", creator("paused"), 409],
  ];
  it.each(cases)("refuse : %s", async (_label, row, status) => {
    const { db, writes } = fakeDb({ creator: row });
    const err = await syncCreator(env(db), "bluesky:did:plc:abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect(writes).toHaveLength(0);
  });
});

describe("collecte d'un créateur", () => {
  it("n'archive pas les doublons, fait avancer le curseur et enregistre le succès", async () => {
    const { db, writes } = fakeDb({ existing: ["bluesky:p1", "bluesky:p2"] });
    const tally = { archived: 0 };
    const r = await collectCreator(env(db), db, new Budget(45, 40), config, connector({ posts: [post(1), post(2)], reachedCursor: true }), creator("active"), "2026-09-30T00:00:00.000Z", tally);
    expect(r).toEqual({ archived: 0, reachedCursor: true });
    expect(writes.filter((w) => w.sql.includes("SET cursor")).map((w) => w.args[0])).toEqual(["2026-09-01T12:00:00.000Z", "2026-09-02T12:00:00.000Z"]);
    expect(writes.at(-1)?.sql).toContain("last_success_at");
  });

  it("signale un curseur non rejoint pour que la galerie relance", async () => {
    const { db } = fakeDb();
    const r = await collectCreator(env(db), db, new Budget(45, 40), config, connector({ posts: [], reachedCursor: false }), creator("active", "2026-08-01T00:00:00.000Z"), "2026-09-30T00:00:00.000Z");
    expect(r.reachedCursor).toBe(false);
  });

  it("s'arrête proprement quand le budget ne suffit plus, sans avancer le curseur au-delà", async () => {
    const { db, writes } = fakeDb({ existing: ["bluesky:p1"] });
    const tally = { archived: 0 };
    const run = collectCreator(env(db), db, new Budget(45, 0), config, connector({ posts: [post(1), post(2)], reachedCursor: true }), creator("active"), "2026-09-30T00:00:00.000Z", tally);
    await expect(run).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(tally.archived).toBe(0);
    expect(writes.filter((w) => w.sql.includes("SET cursor")).map((w) => w.args[0])).toEqual(["2026-09-01T12:00:00.000Z"]);
    expect(writes.some((w) => w.sql.includes("last_success_at"))).toBe(false);
  });
});
