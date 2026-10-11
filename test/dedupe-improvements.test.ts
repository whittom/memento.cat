import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCreator } from "../src/collect";
import { archivePost } from "../src/collect/archive";
import type { NormalizedMedia, NormalizedPost } from "../src/connectors/types";
import { dedupeCreator } from "../src/dedupe";
import { runMaintenance } from "../src/dedupe/maintenance";
import { Budget } from "../src/lib/budget";
import type { Config } from "../src/lib/config";
import { getCreator, insertCreator } from "../src/storage/db";
import { fakeImages, image } from "./fake-images";
import { localEnv } from "./local-env";

const NOW = "2026-10-11T12:00:00.000Z";
const A = "bluesky:did:plc:a";
const config: Config = {
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 100, maxQueriesPerRun: 1000, maxPagesPerCreator: 3, maxMediaBytes: 100_000_000, rateLimitFloor: 10,
  redditUserAgent: "", mastodonUserAgent: "memento (test)", visualDedupeThreshold: 6, autoDedupe: true,
};

const img = (url: string, thumb: string | null = null, w = 1000, h = 800): NormalizedMedia => ({
  kind: "image", sourceUrl: url, thumbUrl: thumb, width: w, height: h, thumbWidth: null, thumbHeight: null, description: null,
});
const vid = (url: string, thumb: string): NormalizedMedia => ({
  kind: "video", sourceUrl: url, thumbUrl: thumb, width: 1280, height: 720, thumbWidth: null, thumbHeight: null, description: null,
});
const post = (n: number, m: NormalizedMedia[]): NormalizedPost => ({
  id: `bluesky:a${n}`, platform: "bluesky", creatorId: A, nativeRef: `at://x/${n}`, nativeId: `a${n}`,
  publishedAt: `2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`, title: null, text: "", sourceUrl: `https://bsky.app/${n}`, media: m,
});

/** Réseau simulé ; il note les adresses demandées. Une adresse en .mp4 est servie comme vidéo. */
function network(contents: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = contents[url];
    const type = url.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
    return Promise.resolve(body === undefined ? new Response("absent", { status: 404 }) : new Response(body, { headers: { "content-type": type } }));
  });
  return calls;
}

async function setup(vars: Record<string, string> = {}) {
  const ctx = localEnv();
  Object.assign(ctx.env, { IMAGES: fakeImages().images, VISUAL_DEDUPE_THRESHOLD: "6", AUTO_DEDUPE: "true", ...vars });
  await insertCreator(ctx.env.DB, { id: A, platform: "bluesky", handle: "a.test", displayName: null }, NOW);
  const archive = (p: NormalizedPost) => archivePost(ctx.env, ctx.env.DB, new Budget(100, 1000), config, p, { handle: "h", displayName: null }, NOW);
  const row = (id: string, position = 0) =>
    ctx.sqlite.prepare("SELECT duplicate_post_id, r2_key, thumb_r2_key, downloaded FROM media WHERE post_id = ? AND position = ?").get(id, position);
  const posts = () => ctx.sqlite.prepare("SELECT id FROM posts ORDER BY rowid").all().map((r) => r["id"]);
  return { ...ctx, archive, row, posts };
}

afterEach(() => vi.unstubAllGlobals());

describe("9.13 fiches écartées", () => {
  it("une fiche supprimée par le ménage n'est plus archivée, et le curseur la dépasse", async () => {
    const { env, archive, posts, sqlite } = await setup();
    network({ "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/2.jpg": image({ seed: 1 }) });
    await archive(post(1, [img("https://cdn/1.jpg")]));
    await archive(post(2, [img("https://cdn/2.jpg")]));
    for (let i = 0; i < 10 && !(await dedupeCreator(env, A, true)).done; i++);
    expect(posts()).toEqual(["bluesky:a1"]);
    expect(sqlite.prepare("SELECT id FROM discarded_posts").all().map((r) => r["id"])).toEqual(["bluesky:a2"]);

    const calls = network({ "https://cdn/2.jpg": image({ seed: 1 }) });
    const creator = (await getCreator(env.DB, A))!;
    await collectCreator(env, env.DB, new Budget(100, 1000), config, { fetchSince: () => Promise.resolve({ posts: [post(2, [img("https://cdn/2.jpg")])], reachedCursor: true }) }, creator, NOW);
    expect(calls).toEqual([]);
    expect(posts()).toEqual(["bluesky:a1"]);
    expect((await getCreator(env.DB, A))?.cursor).toBe("2026-09-02T12:00:00.000Z");
  });
});

describe("9.14 première occurrence dès l'archivage", () => {
  it("une fiche plus ancienne archivée après une plus récente prend le groupe", async () => {
    const { archive, row } = await setup();
    network({ "https://cdn/5.jpg": image({ seed: 1 }), "https://cdn/1.jpg": image({ seed: 1 }) });
    await archive(post(5, [img("https://cdn/5.jpg")]));
    await archive(post(1, [img("https://cdn/1.jpg")]));
    expect(row("bluesky:a1")).toMatchObject({ duplicate_post_id: null });
    expect(String(row("bluesky:a1")?.["r2_key"])).toContain("2026-09-01_a1/");
    expect(row("bluesky:a5")).toMatchObject({ duplicate_post_id: "bluesky:a1", r2_key: row("bluesky:a1")?.["r2_key"] });
  });
});

describe("9.16 reconnaissance avant téléchargement", () => {
  it("une miniature qui ressemble à un original : le fichier complet n'est pas téléchargé", async () => {
    const { archive, row, media: r2 } = await setup();
    const calls = network({
      "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/1t.jpg": image({ seed: 1, w: 320, h: 256 }),
      "https://autre/2.jpg": image({ seed: 1, flip: 2 }), "https://autre/2t.jpg": image({ seed: 1, w: 320, h: 256 }),
    });
    await archive(post(1, [img("https://cdn/1.jpg", "https://cdn/1t.jpg")]));
    await archive(post(2, [img("https://autre/2.jpg", "https://autre/2t.jpg")]));
    expect(calls).not.toContain("https://autre/2.jpg");
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: "bluesky:a1", thumb_r2_key: row("bluesky:a1")?.["thumb_r2_key"] });
    expect([...r2.files.keys()].filter((k) => k.includes("2026-09-02_a2/") && !k.endsWith("post.json"))).toEqual([]);
  });

  it("télécharge quand le nouveau média est meilleur que l'original (plus de pixels)", async () => {
    const { archive, row } = await setup();
    const calls = network({
      "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/1t.jpg": image({ seed: 1, w: 320, h: 256 }),
      "https://autre/2.jpg": image({ seed: 1, w: 2000, h: 1600 }), "https://autre/2t.jpg": image({ seed: 1, w: 320, h: 256 }),
    });
    await archive(post(1, [img("https://cdn/1.jpg", "https://cdn/1t.jpg")]));
    await archive(post(2, [img("https://autre/2.jpg", "https://autre/2t.jpg", 2000, 1600)]));
    expect(calls).toContain("https://autre/2.jpg");
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
  });
});

describe("9.18 vidéos", () => {
  it("une même vidéo republiée est reconnue par sa miniature, sans télécharger la vidéo", async () => {
    const { archive, row } = await setup();
    const calls = network({
      "https://cdn/1.mp4": "vidéo 1", "https://cdn/1t.jpg": image({ seed: 5, w: 1280, h: 720 }),
      "https://cdn/2.mp4": "vidéo 2", "https://cdn/2t.jpg": image({ seed: 5, shift: 1, w: 1280, h: 720 }),
      "https://cdn/3.mp4": "vidéo 3", "https://cdn/3t.jpg": image({ seed: 6, w: 1280, h: 720 }),
    });
    await archive(post(1, [vid("https://cdn/1.mp4", "https://cdn/1t.jpg")]));
    await archive(post(2, [vid("https://cdn/2.mp4", "https://cdn/2t.jpg")]));
    await archive(post(3, [vid("https://cdn/3.mp4", "https://cdn/3t.jpg")]));
    expect(calls).not.toContain("https://cdn/2.mp4");
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: "bluesky:a1" });
    expect(calls).toContain("https://cdn/3.mp4");
    expect(row("bluesky:a3")).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
  });

  it("une vidéo n'est jamais rapprochée d'une image", async () => {
    const { archive, row } = await setup();
    network({ "https://cdn/1.jpg": image({ seed: 5, w: 1280, h: 720 }), "https://cdn/2.mp4": "vidéo", "https://cdn/2t.jpg": image({ seed: 5, w: 1280, h: 720 }) });
    await archive(post(1, [img("https://cdn/1.jpg", null, 1280, 720)]));
    await archive(post(2, [vid("https://cdn/2.mp4", "https://cdn/2t.jpg")]));
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: null, downloaded: 1 });
  });
});

describe("9.15 et 9.17 maintenance planifiée", () => {
  /** Archive d'avant la reconnaissance visuelle : rien de relié, aucune empreinte. */
  async function legacy(vars: Record<string, string> = {}) {
    const ctx = await setup({ VISUAL_DEDUPE_THRESHOLD: "0" });
    network({ "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/2.jpg": image({ seed: 1, flip: 3, w: 2000, h: 1600 }) });
    await ctx.archive(post(1, [img("https://cdn/1.jpg")]));
    await ctx.archive(post(2, [img("https://cdn/2.jpg", null, 2000, 1600)]));
    ctx.sqlite.prepare("UPDATE media SET fingerprint = NULL").run();
    Object.assign(ctx.env, { VISUAL_DEDUPE_THRESHOLD: "6", ...vars });
    return ctx;
  }

  it("calcule les empreintes, relie, réoriente, puis passe au créateur suivant, sans jamais supprimer de fiche", async () => {
    const { env, posts, row } = await legacy();
    const steps: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await runMaintenance(env, NOW);
      steps.push(r.step);
      if (r.step === "vérifié") break;
    }
    expect(steps).toEqual(["empreintes", "liens", "réorientation", "vérifié"]);
    expect(posts()).toEqual(["bluesky:a1", "bluesky:a2"]);
    // La fiche 1 (publiée la première) garde l'image, avec le meilleur fichier ; la fiche 2 lui est reliée.
    expect(row("bluesky:a1")).toMatchObject({ duplicate_post_id: null });
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: "bluesky:a1" });
    // Le bouton supprimera ensuite la fiche 2, entièrement en double.
    expect(await dedupeCreator(env, A, false)).toMatchObject({ count: 0, moves: 0, postCount: 1 });
  });

  it("désactivée par AUTO_DEDUPE = false", async () => {
    const { env } = await legacy({ AUTO_DEDUPE: "false" });
    expect(await runMaintenance(env, NOW)).toMatchObject({ step: "désactivée" });
  });
});
