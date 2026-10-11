import { afterEach, describe, expect, it, vi } from "vitest";
import { archivePost } from "../src/collect/archive";
import type { NormalizedMedia, NormalizedPost } from "../src/connectors/types";
import { FINGERPRINT_BATCH, dedupeCreator } from "../src/dedupe";
import { distance, fingerprintFromGrey, fromHex, toHex } from "../src/dedupe/fingerprint";
import { Budget } from "../src/lib/budget";
import type { Config } from "../src/lib/config";
import { insertCreator, insertPost, type MediaInsert } from "../src/storage/db";
import { fakeImages, image, type Fake } from "./fake-images";
import { localEnv } from "./local-env";

const NOW = "2026-10-11T12:00:00.000Z";
const A = "bluesky:did:plc:a";
const config = (visualDedupeThreshold = 6): Config => ({
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 100, maxQueriesPerRun: 1000, maxPagesPerCreator: 3, maxMediaBytes: 100_000_000, rateLimitFloor: 10,
  redditUserAgent: "", mastodonUserAgent: "memento (test)", visualDedupeThreshold, autoDedupe: false,
});

const media = (url: string, w: number | null = null, h: number | null = null): NormalizedMedia => ({
  kind: "image", sourceUrl: url, thumbUrl: null, width: w, height: h, thumbWidth: null, thumbHeight: null, description: null,
});
const post = (n: number, m: NormalizedMedia[]): NormalizedPost => ({
  id: `bluesky:a${n}`, platform: "bluesky", creatorId: A, nativeRef: `at://x/${n}`, nativeId: `a${n}`,
  publishedAt: `2026-09-${String(n).padStart(2, "0")}T12:00:00.000Z`, title: null, text: "", sourceUrl: `https://bsky.app/${n}`, media: m,
});

function network(contents: Record<string, string>) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const body = contents[String(input)];
    return Promise.resolve(body === undefined ? new Response("absent", { status: 404 }) : new Response(body, { headers: { "content-type": "image/jpeg" } }));
  });
}

async function setup(threshold = 6) {
  const ctx = localEnv();
  const fake = fakeImages();
  Object.assign(ctx.env, { IMAGES: fake.images, VISUAL_DEDUPE_THRESHOLD: String(threshold) });
  await insertCreator(ctx.env.DB, { id: A, platform: "bluesky", handle: "a.test", displayName: null }, NOW);
  const archive = (p: NormalizedPost) => archivePost(ctx.env, ctx.env.DB, new Budget(100, 1000), config(threshold), p, { handle: "h", displayName: null }, NOW);
  const row = (id: string, position = 0) =>
    ctx.sqlite.prepare("SELECT duplicate_post_id, r2_key, fingerprint, width, height FROM media WHERE post_id = ? AND position = ?").get(id, position);
  return { ...ctx, fake, archive, row };
}

afterEach(() => vi.unstubAllGlobals());

describe("empreinte visuelle", () => {
  it("calcule l'empreinte à partir des pixels, la relit et mesure l'écart", () => {
    const grey = Uint8Array.from({ length: 17 * 16 }, (_, i) => (i % 17) * ((i >> 4) % 2 ? 1 : -1) + 128);
    const print = fingerprintFromGrey(grey);
    expect(print).not.toBeNull();
    expect(fromHex(toHex(print!))).toEqual(print);
    expect(distance(print!, print!)).toBe(0);
  });

  it("écarte une image quasi unie", () => {
    expect(fingerprintFromGrey(new Uint8Array(17 * 16).fill(90))).toBeNull();
  });
});

describe("reconnaissance visuelle à l'archivage (exigence 9.11)", () => {
  it("relie une même image d'un autre encodage (écart sous le seuil) et supprime le fichier en double", async () => {
    const { archive, row, media: r2 } = await setup();
    network({ "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/2.jpg": image({ seed: 1, flip: 4 }) });
    await archive(post(1, [media("https://cdn/1.jpg")]));
    expect(String(row("bluesky:a1")?.["fingerprint"])).toMatch(/^[0-9a-f]{64}$/);
    expect(row("bluesky:a1")).toMatchObject({ width: 1000, height: 800 });
    await archive(post(2, [media("https://cdn/2.jpg")]));
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: "bluesky:a1", r2_key: row("bluesky:a1")?.["r2_key"] });
    expect([...r2.files.keys()].filter((k) => k.includes("/2026-09-02_") && !k.endsWith("post.json"))).toEqual([]);
  });

  it("second regard : une paire douteuse est reliée si les pixels concordent, pas sinon", async () => {
    const { archive, row } = await setup();
    network({
      "https://cdn/1.jpg": image({ seed: 1 }),
      "https://cdn/2.jpg": image({ seed: 1, flip: 16, shift: 2 }),
      "https://cdn/3.jpg": image({ seed: 1, flip: 16, shift: 40 }),
      "https://cdn/4.jpg": image({ seed: 1, flip: 40 }),
    });
    await archive(post(1, [media("https://cdn/1.jpg")]));
    await archive(post(2, [media("https://cdn/2.jpg")]));
    await archive(post(3, [media("https://cdn/3.jpg")]));
    await archive(post(4, [media("https://cdn/4.jpg")]));
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: "bluesky:a1" });
    expect(row("bluesky:a3")).toMatchObject({ duplicate_post_id: null });
    expect(row("bluesky:a4")).toMatchObject({ duplicate_post_id: null });
  });

  it("ne relie pas une image meilleure que l'original, d'autres proportions, ni avec le seuil à 0", async () => {
    const { archive, row } = await setup();
    network({
      "https://cdn/1.jpg": image({ seed: 1 }),
      "https://cdn/2.jpg": image({ seed: 1, w: 2000, h: 1600 }),
      "https://cdn/3.jpg": image({ seed: 1, w: 1000, h: 1000 }),
    });
    await archive(post(1, [media("https://cdn/1.jpg")]));
    await archive(post(2, [media("https://cdn/2.jpg")]));
    await archive(post(3, [media("https://cdn/3.jpg")]));
    expect(row("bluesky:a2")).toMatchObject({ duplicate_post_id: null });
    expect(row("bluesky:a3")).toMatchObject({ duplicate_post_id: null });

    const off = await setup(0);
    network({ "https://cdn/1.jpg": image({ seed: 1 }), "https://cdn/2.jpg": image({ seed: 1, flip: 2 }) });
    await off.archive(post(1, [media("https://cdn/1.jpg")]));
    await off.archive(post(2, [media("https://cdn/2.jpg")]));
    expect(off.row("bluesky:a2")).toMatchObject({ duplicate_post_id: null, fingerprint: null });
    expect(off.fake.transforms()).toBe(2); // les miniatures seulement
  });
});

describe("ménage visuel d'un créateur (exigences 9.10, 9.11)", () => {
  /** Archive d'avant la reconnaissance visuelle : médias sans empreinte ni lien. */
  async function archiveOf(spec: Fake[][], threshold = 6) {
    const ctx = await setup(threshold);
    for (const [i, contents] of spec.entries()) {
      const n = i + 1;
      const p = post(n, contents.map((_, k) => media(`https://cdn/${n}-${k}.jpg`)));
      const prefix = `bluesky/a/2026/09/${n}/`;
      const rows: MediaInsert[] = [];
      for (const [k, f] of contents.entries()) {
        const key = `${prefix}media_0${k + 1}.jpg`;
        const stored = (await ctx.env.MEDIA.put(key, image(f), { httpMetadata: { contentType: "image/jpeg" } }))!;
        rows.push({
          post_id: p.id, position: k, kind: "image", mime_type: "image/jpeg", r2_key: key, etag: stored.etag, bytes: stored.size,
          width: f.w ?? 1000, height: f.h ?? 800, thumb_r2_key: null, thumb_width: null, thumb_height: null, description: null,
          source_url: p.media[k]!.sourceUrl, downloaded: 1,
        });
      }
      await ctx.env.MEDIA.put(`${prefix}post.json`, JSON.stringify({ ...p, media: rows.map((r) => ({ r2Key: r.r2_key, duplicateOf: null })) }));
      await insertPost(ctx.env.DB, p, prefix, rows, NOW);
    }
    return ctx;
  }

  async function simulate(env: Env) {
    for (let i = 0; i < 20; i++) {
      const r = await dedupeCreator(env, A, false);
      if (r.pendingFingerprints === 0) return r;
    }
    throw new Error("empreintes jamais terminées");
  }

  async function runAll(env: Env) {
    for (let i = 0; i < 50; i++) if ((await dedupeCreator(env, A, true)).done) return;
    throw new Error("ménage jamais terminé");
  }

  it("calcule d'abord les empreintes par lots, puis chiffre le plan", async () => {
    const { env } = await archiveOf(Array.from({ length: FINGERPRINT_BATCH + 5 }, (_, i) => [{ seed: i + 1 }]));
    const first = await dedupeCreator(env, A, false);
    expect(first.pendingFingerprints).toBe(5);
    expect(await dedupeCreator(env, A, false)).toMatchObject({ pendingFingerprints: 0, count: 0, done: true });
  });

  it("garde le meilleur fichier, mais sous la fiche publiée la première, et supprime la plus récente (9.12)", async () => {
    const { env, sqlite, row, media: r2 } = await archiveOf([[{ seed: 1 }], [{ seed: 1, flip: 3, w: 2000, h: 1600 }], [{ seed: 2 }]]);
    expect(await simulate(env)).toMatchObject({ count: 1, visualCount: 1, moves: 1, postCount: 1 });
    await runAll(env);
    expect(sqlite.prepare("SELECT id FROM posts ORDER BY rowid").all().map((r) => r["id"])).toEqual(["bluesky:a1", "bluesky:a3"]);
    const kept = row("bluesky:a1");
    expect(kept).toMatchObject({ duplicate_post_id: null });
    expect(String(kept?.["r2_key"])).toMatch(/^bluesky\/a\/2026\/09\/1\//);
    // Le fichier gardé est le meilleur (2000 × 1600), recopié sous la fiche la plus ancienne.
    expect(JSON.parse(new TextDecoder().decode(r2.files.get(String(kept?.["r2_key"]))))).toMatchObject({ w: 2000 });
    expect([...r2.files.keys()].some((k) => k.startsWith("bluesky/a/2026/09/2/"))).toBe(false);
    expect(await dedupeCreator(env, A, false)).toMatchObject({ count: 0, moves: 0, postCount: 0, done: true });
  });

  it("second regard au ménage, et relie à la nouvelle image les doublons déjà reliés à l'ancienne", async () => {
    const { env, sqlite, row } = await archiveOf([
      [{ seed: 1 }],
      [{ seed: 1, flip: 16, shift: 1, w: 2000, h: 1600 }],
      [{ seed: 1 }, { seed: 9 }],
    ]);
    // La fiche 3 a une copie exacte de l'image 1, déjà reliée à elle, et une image propre.
    const a1 = row("bluesky:a1");
    sqlite.prepare("UPDATE media SET duplicate_post_id = 'bluesky:a1', duplicate_position = 0, r2_key = ? WHERE post_id = 'bluesky:a3' AND position = 0").run(a1?.["r2_key"] as string);
    expect(await simulate(env)).toMatchObject({ count: 1, visualCount: 1 });
    await runAll(env);
    // Le groupe revient à la fiche 1 (publiée la première) ; la copie de la fiche 3 la suit ; la fiche 2 part.
    expect(row("bluesky:a1")).toMatchObject({ duplicate_post_id: null });
    expect(row("bluesky:a3")).toMatchObject({ duplicate_post_id: "bluesky:a1", r2_key: row("bluesky:a1")?.["r2_key"] });
    expect(row("bluesky:a3", 1)).toMatchObject({ duplicate_post_id: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts WHERE id = 'bluesky:a2'").get()?.["n"]).toBe(0);
  });

  it("copies exactes : la fiche publiée la première garde le média, même archivée après", async () => {
    const { env, sqlite, row } = await archiveOf([[{ seed: 1 }], [{ seed: 1 }]], 0);
    sqlite.prepare("UPDATE posts SET published_at = '2026-09-20T12:00:00.000Z' WHERE id = 'bluesky:a1'").run();
    expect(await simulate(env)).toMatchObject({ count: 1, moves: 1, postCount: 1 });
    await runAll(env);
    expect(sqlite.prepare("SELECT id FROM posts").all().map((r) => r["id"])).toEqual(["bluesky:a2"]);
    expect(String(row("bluesky:a2")?.["r2_key"])).toMatch(/^bluesky\/a\/2026\/09\/2\//);
  });

  it("sans liaison Images ou avec le seuil à 0, seules les copies identiques sont traitées", async () => {
    const { env } = await archiveOf([[{ seed: 1 }], [{ seed: 1, flip: 2 }]], 0);
    expect(await simulate(env)).toMatchObject({ count: 0, visualCount: 0, done: true });
  });
});
