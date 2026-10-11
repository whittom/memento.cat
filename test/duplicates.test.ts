import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/api";
import { archivePost } from "../src/collect/archive";
import type { NormalizedMedia, NormalizedPost } from "../src/connectors/types";
import { DEDUPE_BATCH, dedupeBatch, dedupeCreator } from "../src/dedupe";
import { purgePosts } from "../src/purge";
import { Budget } from "../src/lib/budget";
import type { Config } from "../src/lib/config";
import { creatorStats, insertCreator, insertPost, listCreators, listPosts, type MediaInsert } from "../src/storage/db";
import { localEnv } from "./local-env";

const config: Config = {
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 1000, maxPagesPerCreator: 3, maxMediaBytes: 1_000_000, rateLimitFloor: 10,
  redditUserAgent: "", mastodonUserAgent: "memento (test)", visualDedupeThreshold: 0, autoDedupe: false,
};
const NOW = "2026-10-03T12:00:00.000Z";
const A = "bluesky:did:plc:a";
const B = "bluesky:did:plc:b";

/** Réseau simulé : chaque adresse rend le contenu indiqué (deux adresses peuvent rendre le même contenu). */
function network(contents: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = contents[url];
    return Promise.resolve(body === undefined ? new Response("absent", { status: 404 }) : new Response(body, { headers: { "content-type": "image/jpeg" } }));
  });
  return calls;
}

const media = (url: string, thumb: string | null = null): NormalizedMedia => ({
  kind: "image", sourceUrl: url, thumbUrl: thumb, width: 10, height: 10, thumbWidth: null, thumbHeight: null, description: null,
});

const post = (creatorId: string, n: number, m: NormalizedMedia[]): NormalizedPost => ({
  id: `bluesky:${creatorId.slice(-1)}${n}`, platform: "bluesky", creatorId, nativeRef: `at://x/${n}`, nativeId: `${creatorId.slice(-1)}${n}`,
  publishedAt: `2026-09-0${n}T12:00:00.000Z`, title: null, text: `texte ${n}`, sourceUrl: `https://bsky.app/${n}`, media: m,
});

async function setup() {
  const ctx = localEnv();
  await insertCreator(ctx.env.DB, { id: A, platform: "bluesky", handle: "a.test", displayName: null }, NOW);
  await insertCreator(ctx.env.DB, { id: B, platform: "bluesky", handle: "b.test", displayName: null }, NOW);
  const archive = (p: NormalizedPost) =>
    archivePost(ctx.env, ctx.env.DB, new Budget(100, 1000), config, p, { handle: "h", displayName: null }, NOW);
  return { ...ctx, archive };
}

const mediaRows = (sqlite: ReturnType<typeof localEnv>["sqlite"], postId: string) =>
  sqlite.prepare("SELECT position, r2_key, duplicate_post_id, duplicate_position, downloaded FROM media WHERE post_id = ? ORDER BY position").all(postId);

afterEach(() => vi.unstubAllGlobals());

describe("médias identiques à l'archivage (exigence 9)", () => {
  it("relie un média de même adresse sans le télécharger, ni lui ni sa miniature", async () => {
    const { archive, sqlite, media: r2 } = await setup();
    const calls = network({ "https://cdn/1.jpg": "image-1", "https://cdn/1t.jpg": "mini-1" });
    await archive(post(A, 1, [media("https://cdn/1.jpg", "https://cdn/1t.jpg")]));
    calls.length = 0;
    await archive(post(A, 2, [media("https://cdn/1.jpg", "https://cdn/1t.jpg")]));
    expect(calls).toEqual([]);
    const [row] = mediaRows(sqlite, "bluesky:a2");
    expect(row).toMatchObject({ duplicate_post_id: "bluesky:a1", duplicate_position: 0, downloaded: 1 });
    expect(row?.["r2_key"]).toBe(mediaRows(sqlite, "bluesky:a1")[0]?.["r2_key"]);
    expect([...r2.files.keys()].filter((k) => k.includes("a2/") && !k.endsWith("post.json"))).toEqual([]);
  });

  it("relie un média de même contenu sous une autre adresse et supprime le fichier en double", async () => {
    const { archive, sqlite, media: r2 } = await setup();
    network({ "https://cdn/1.jpg": "même image", "https://autre/x.jpg": "même image", "https://cdn/3.jpg": "autre image" });
    await archive(post(A, 1, [media("https://cdn/1.jpg")]));
    await archive(post(A, 2, [media("https://autre/x.jpg"), media("https://cdn/3.jpg")]));
    const rows = mediaRows(sqlite, "bluesky:a2");
    expect(rows[0]).toMatchObject({ duplicate_post_id: "bluesky:a1", duplicate_position: 0 });
    // Média par média : le second, différent, est archivé normalement.
    expect(rows[1]).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
    const own = [...r2.files.keys()].filter((k) => k.includes("a2/") && !k.endsWith("post.json"));
    expect(own).toHaveLength(1);
    const json = JSON.parse(new TextDecoder().decode(r2.files.get([...r2.files.keys()].find((k) => k.includes("a2/") && k.endsWith("post.json"))!))) as { media: { duplicateOf: unknown }[] };
    expect(json.media[0]?.duplicateOf).toEqual({ postId: "bluesky:a1", position: 0 });
  });

  it("ne relie jamais au média d'un autre créateur", async () => {
    const { archive, sqlite } = await setup();
    network({ "https://cdn/1.jpg": "image" });
    await archive(post(A, 1, [media("https://cdn/1.jpg")]));
    await archive(post(B, 1, [media("https://cdn/1.jpg")]));
    expect(mediaRows(sqlite, "bluesky:b1")[0]).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
  });

  it("dans une même publication, relie au premier média, jamais en chaîne", async () => {
    const { archive, sqlite } = await setup();
    network({ "https://cdn/1.jpg": "image", "https://cdn/2.jpg": "image" });
    await archive(post(A, 1, [media("https://cdn/1.jpg"), media("https://cdn/2.jpg")]));
    await archive(post(A, 2, [media("https://cdn/2.jpg")]));
    expect(mediaRows(sqlite, "bluesky:a1")[1]).toMatchObject({ duplicate_post_id: "bluesky:a1", duplicate_position: 0 });
    expect(mediaRows(sqlite, "bluesky:a2")[0]).toMatchObject({ duplicate_post_id: "bluesky:a1", duplicate_position: 0 });
  });

  it("un média en échec n'est jamais un original", async () => {
    const { archive, sqlite } = await setup();
    network({});
    await archive(post(A, 1, [media("https://cdn/1.jpg")]));
    network({ "https://cdn/1.jpg": "image" });
    await archive(post(A, 2, [media("https://cdn/1.jpg")]));
    expect(mediaRows(sqlite, "bluesky:a2")[0]).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
  });
});

describe("décomptes, API et filtre (exigences 9.6 et 9.7)", () => {
  it("les doublons ne comptent ni dans les non consultés ni dans la taille archivée", async () => {
    const { archive, env } = await setup();
    network({ "https://cdn/1.jpg": "12345" });
    await archive(post(A, 1, [media("https://cdn/1.jpg")]));
    await archive(post(A, 2, [media("https://cdn/1.jpg")]));
    const creator = (await listCreators(env.DB)).find((c) => c.id === A);
    expect(creator?.unviewed_count).toBe(1);
    expect(await creatorStats(env.DB, A)).toEqual({ posts: 2, media: 2, bytes: 5 });
    const rows = await listPosts(env.DB, { creator: A, limit: 10 });
    expect(rows.map((r) => [r.id, r.duplicate_count, r.unviewed_count])).toEqual([["bluesky:a2", 1, 0], ["bluesky:a1", 0, 1]]);
  });

  it("l'API présente duplicateOf et duplicate, et duplicates=hide retire les publications faites de doublons", async () => {
    const { archive, env } = await setup();
    network({ "https://cdn/1.jpg": "image" });
    await archive(post(A, 1, [media("https://cdn/1.jpg")]));
    await archive(post(A, 2, [media("https://cdn/1.jpg")]));
    const all = (await (await handleApi(new Request("https://m/api/posts"), env)).json()) as { posts: { id: string; duplicate: boolean; media: { duplicateOf: unknown }[] }[] };
    expect(all.posts.map((p) => [p.id, p.duplicate])).toEqual([["bluesky:a2", true], ["bluesky:a1", false]]);
    expect(all.posts[0]?.media[0]?.duplicateOf).toEqual({ postId: "bluesky:a1", position: 0 });
    const hidden = (await (await handleApi(new Request("https://m/api/posts?duplicates=hide"), env)).json()) as { posts: { id: string }[] };
    expect(hidden.posts.map((p) => p.id)).toEqual(["bluesky:a1"]);
  });
});

describe("effacement d'un original (exigence 9.5)", () => {
  it("reloge le fichier chez le premier doublon et relie les autres à lui", async () => {
    const { archive, env, sqlite, media: r2 } = await setup();
    network({ "https://cdn/1.jpg": "image" });
    for (const n of [1, 2, 3]) await archive(post(A, n, [media("https://cdn/1.jpg")]));
    const prefix = (sqlite.prepare("SELECT r2_prefix FROM posts WHERE id = ?").get("bluesky:a1")?.["r2_prefix"]) as string;
    await purgePosts(env, [{ id: "bluesky:a1", r2_prefix: prefix }]);

    const heir = mediaRows(sqlite, "bluesky:a2")[0];
    expect(heir).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
    expect(String(heir?.["r2_key"])).toContain("a2/");
    expect(r2.files.has(String(heir?.["r2_key"]))).toBe(true);
    expect(mediaRows(sqlite, "bluesky:a3")[0]).toMatchObject({ duplicate_post_id: "bluesky:a2", duplicate_position: 0, r2_key: heir?.["r2_key"] });
    expect([...r2.files.keys()].some((k) => k.startsWith(prefix))).toBe(false);
  });
});

describe("rattrapage des doublons déjà archivés (exigence 9.9)", () => {
  async function legacy() {
    const ctx = await setup();
    // Archive d'avant la reconnaissance : deux fichiers identiques, aucun lien.
    for (const n of [1, 2]) {
      const p = post(A, n, [media(`https://cdn/${n}.jpg`)]);
      const prefix = `bluesky/a/2026/09/${n}/`;
      const stored = (await ctx.env.MEDIA.put(`${prefix}media_01.jpg`, "même image"))!;
      await ctx.env.MEDIA.put(`${prefix}post.json`, JSON.stringify({ ...p, media: [{ ...p.media[0], r2Key: `${prefix}media_01.jpg`, duplicateOf: null }] }));
      const row: MediaInsert = {
        post_id: p.id, position: 0, kind: "image", mime_type: "image/jpeg", r2_key: `${prefix}media_01.jpg`, etag: stored.etag, bytes: stored.size,
        width: 10, height: 10, thumb_r2_key: null, thumb_width: null, thumb_height: null, description: null, source_url: p.media[0]!.sourceUrl, downloaded: 1,
      };
      await insertPost(ctx.env.DB, p, prefix, [row], NOW);
    }
    return ctx;
  }

  it("simule par défaut sans rien écrire", async () => {
    const { env, sqlite, media: r2 } = await legacy();
    const r = await dedupeBatch(env, { apply: false });
    expect(r).toMatchObject({ found: 1, bytes: 11, linked: 0, remaining: 1 });
    expect(mediaRows(sqlite, "bluesky:a2")[0]).toMatchObject({ duplicate_post_id: null });
    expect(r2.files.has("bluesky/a/2026/09/2/media_01.jpg")).toBe(true);
  });

  it("applique : post.json, ligne, puis suppression du fichier en double ; une seconde passe ne trouve plus rien", async () => {
    const { env, sqlite, media: r2 } = await legacy();
    expect(await dedupeBatch(env, { apply: true })).toMatchObject({ found: 1, linked: 1, remaining: 0 });
    expect(mediaRows(sqlite, "bluesky:a2")[0]).toMatchObject({ duplicate_post_id: "bluesky:a1", r2_key: "bluesky/a/2026/09/1/media_01.jpg" });
    expect(r2.files.has("bluesky/a/2026/09/2/media_01.jpg")).toBe(false);
    const json = JSON.parse(new TextDecoder().decode(r2.files.get("bluesky/a/2026/09/2/post.json"))) as { media: { duplicateOf: unknown; r2Key: string }[] };
    expect(json.media[0]).toMatchObject({ duplicateOf: { postId: "bluesky:a1", position: 0 }, r2Key: "bluesky/a/2026/09/1/media_01.jpg" });
    expect(await dedupeBatch(env, { apply: true })).toMatchObject({ found: 0, linked: 0 });
  });

  it("limité à un créateur, ne touche pas aux autres", async () => {
    const { env } = await legacy();
    expect(await dedupeBatch(env, { apply: true, creatorId: B })).toMatchObject({ found: 0, linked: 0 });
  });
});

describe("ménage des doublons d'un créateur depuis la page Créateurs (exigence 9.10)", () => {
  /** Archive d'avant la reconnaissance : n publications, chacune avec les médias indiqués (contenu brut), aucun lien. */
  async function archiveOf(spec: string[][]) {
    const ctx = await setup();
    for (const [i, contents] of spec.entries()) {
      const n = i + 1;
      const p = post(A, n, contents.map((_, k) => media(`https://cdn/${n}-${k}.jpg`)));
      const prefix = `bluesky/a/2026/09/${n}/`;
      const rows: MediaInsert[] = [];
      for (const [k, content] of contents.entries()) {
        const key = `${prefix}media_0${k + 1}.jpg`;
        const stored = (await ctx.env.MEDIA.put(key, content))!;
        rows.push({
          post_id: p.id, position: k, kind: "image", mime_type: "image/jpeg", r2_key: key, etag: stored.etag, bytes: stored.size,
          width: 10, height: 10, thumb_r2_key: null, thumb_width: null, thumb_height: null, description: null, source_url: p.media[k]!.sourceUrl, downloaded: 1,
        });
      }
      await ctx.env.MEDIA.put(`${prefix}post.json`, JSON.stringify({ ...p, media: rows.map((r) => ({ r2Key: r.r2_key, duplicateOf: null })) }));
      await insertPost(ctx.env.DB, p, prefix, rows, NOW);
    }
    return ctx;
  }

  async function runAll(env: Env, id = A) {
    const total = { linked: 0, deletedPosts: 0, calls: 0 };
    for (;;) {
      const r = await dedupeCreator(env, id, true);
      total.linked += r.linked;
      total.deletedPosts += r.deletedPosts;
      total.calls++;
      if (r.done || total.calls > 50) return total;
    }
  }

  it("simule : médias à relier, fiches entièrement en double, rien d'écrit", async () => {
    const { env, sqlite } = await archiveOf([["x", "y"], ["x"], ["y", "z"]]);
    expect(await dedupeCreator(env, A, false)).toMatchObject({ count: 2, postCount: 1, linked: 0, deletedPosts: 0, done: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get()?.["n"]).toBe(3);
  });

  it("garde la première occurrence, relie les autres et supprime les fiches faites uniquement de doublons", async () => {
    const { env, sqlite, media: r2 } = await archiveOf([["x", "y"], ["x"], ["y", "z"]]);
    expect(await runAll(env)).toMatchObject({ linked: 2, deletedPosts: 1 });
    const posts = sqlite.prepare("SELECT id FROM posts ORDER BY rowid").all().map((r) => r["id"]);
    expect(posts).toEqual(["bluesky:a1", "bluesky:a3"]);
    // La galerie qui garde une image propre (z) reste entière, son doublon (y) relié à la première occurrence.
    expect(mediaRows(sqlite, "bluesky:a3")[0]).toMatchObject({ duplicate_post_id: "bluesky:a1", duplicate_position: 1 });
    expect(mediaRows(sqlite, "bluesky:a3")[1]).toMatchObject({ duplicate_post_id: null });
    expect([...r2.files.keys()].some((k) => k.startsWith("bluesky/a/2026/09/2/"))).toBe(false);
    expect(r2.files.has("bluesky/a/2026/09/1/media_01.jpg")).toBe(true);
    expect(await dedupeCreator(env, A, false)).toMatchObject({ count: 0, postCount: 0, done: true });
  });

  it("travaille par lots sous la limite du plan gratuit et termine", async () => {
    const { env, sqlite } = await archiveOf(Array.from({ length: DEDUPE_BATCH + 4 }, () => ["même"]));
    const total = await runAll(env);
    expect(total.calls).toBeGreaterThan(1);
    expect(total).toMatchObject({ linked: DEDUPE_BATCH + 3, deletedPosts: DEDUPE_BATCH + 3 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get()?.["n"]).toBe(1);
  });

  it("ne touche pas aux autres créateurs, et refuse un créateur à la corbeille", async () => {
    const { env, sqlite } = await archiveOf([["x"], ["x"]]);
    expect(await dedupeCreator(env, B, true)).toMatchObject({ count: 0, done: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get()?.["n"]).toBe(2);
    sqlite.prepare("UPDATE creators SET state = 'deleted' WHERE id = ?").run(A);
    const call = handleApi(new Request(`https://m/api/creators/${encodeURIComponent(A)}/duplicates`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env);
    await expect(call).rejects.toMatchObject({ status: 409 });
  });
});
