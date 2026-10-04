import { afterEach, describe, expect, it, vi } from "vitest";
import { archivePost } from "../src/collect/archive";
import type { NormalizedMedia, NormalizedPost } from "../src/connectors/types";
import { Budget } from "../src/lib/budget";
import type { Config } from "../src/lib/config";
import { insertCreator } from "../src/storage/db";
import { MAX_THUMB_SOURCE_BYTES, THUMB_SIDE, makeThumbnail } from "../src/storage/thumbnail";
import { localEnv } from "./local-env";

const config: Config = {
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 1000, maxPagesPerCreator: 3, maxMediaBytes: 100_000_000, rateLimitFloor: 10,
  redditUserAgent: "", mastodonUserAgent: "memento (test)",
};
const NOW = "2026-10-05T12:00:00.000Z";
const A = "bluesky:did:plc:a";

/** Fausse liaison Images : « réduit » en renvoyant 4 octets, et note les paramètres reçus. */
function fakeImages(opts: { fail?: boolean; width?: number; height?: number } = {}) {
  const calls: { transform?: unknown; output?: unknown }[] = [];
  const images = {
    input: (stream: ReadableStream<Uint8Array>) => {
      const call: { transform?: unknown; output?: unknown } = {};
      calls.push(call);
      void stream;
      const handle = {
        transform: (t: unknown) => ((call.transform = t), handle),
        output: (o: unknown) => {
          call.output = o;
          if (opts.fail) return Promise.reject(Object.assign(new Error("quota"), { code: 9422 }));
          return Promise.resolve({ response: () => new Response(new Uint8Array([1, 2, 3, 4])) });
        },
      };
      return handle;
    },
    info: () => Promise.resolve({ format: "image/webp", fileSize: 4, width: opts.width ?? 480, height: opts.height ?? 320 }),
  };
  return { images: images as unknown as ImagesBinding, calls };
}

const media = (url: string, thumb: string | null = null, kind: NormalizedMedia["kind"] = "image"): NormalizedMedia => ({
  kind, sourceUrl: url, thumbUrl: thumb, width: null, height: null, thumbWidth: null, thumbHeight: null, description: null,
});
const post = (n: number, m: NormalizedMedia[]): NormalizedPost => ({
  id: `bluesky:a${n}`, platform: "bluesky", creatorId: A, nativeRef: `at://x/${n}`, nativeId: `a${n}`,
  publishedAt: `2026-09-0${n}T12:00:00.000Z`, title: null, text: "", sourceUrl: `https://bsky.app/${n}`, media: m,
});

function network(contents: Record<string, string>, type = "image/jpeg") {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const body = contents[String(input)];
    return Promise.resolve(body === undefined ? new Response("absent", { status: 404 }) : new Response(body, { headers: { "content-type": type } }));
  });
}

async function setup(images?: ImagesBinding) {
  const ctx = localEnv();
  (ctx.env as unknown as { IMAGES?: ImagesBinding }).IMAGES = images;
  await insertCreator(ctx.env.DB, { id: A, platform: "bluesky", handle: "a.test", displayName: null }, NOW);
  const archive = (p: NormalizedPost) => archivePost(ctx.env, ctx.env.DB, new Budget(100, 1000), config, p, { handle: "h", displayName: null }, NOW);
  const row = (id: string) => ctx.sqlite.prepare("SELECT thumb_r2_key, thumb_width, thumb_height FROM media WHERE post_id = ?").get(id);
  return { ...ctx, archive, row };
}

afterEach(() => vi.unstubAllGlobals());

describe("miniatures fabriquées (exigence 10)", () => {
  it("fabrique une miniature WebP de 480 px au plus pour une image sans miniature", async () => {
    const f = fakeImages({ width: 480, height: 320 });
    const { archive, row, media: r2 } = await setup(f.images);
    network({ "https://cdn/1.jpg": "image" });
    await archive(post(1, [media("https://cdn/1.jpg")]));
    expect(f.calls[0]?.transform).toEqual({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "scale-down" });
    expect(f.calls[0]?.output).toMatchObject({ format: "image/webp" });
    const r = row("bluesky:a1");
    expect(r).toMatchObject({ thumb_width: 480, thumb_height: 320 });
    expect(String(r?.["thumb_r2_key"])).toMatch(/media_01\.thumb\.webp$/);
    expect(r2.files.get(String(r?.["thumb_r2_key"]))).toEqual(new Uint8Array([1, 2, 3, 4]));
    const json = JSON.parse(new TextDecoder().decode(r2.files.get([...r2.files.keys()].find((k) => k.endsWith("post.json"))!))) as { media: { thumbR2Key: string }[] };
    expect(json.media[0]?.thumbR2Key).toBe(r?.["thumb_r2_key"]);
  });

  it("n'en fabrique pas quand la plateforme en fournit une", async () => {
    const f = fakeImages();
    const { archive, row } = await setup(f.images);
    network({ "https://cdn/1.jpg": "image", "https://cdn/1t.jpg": "mini" });
    await archive(post(1, [media("https://cdn/1.jpg", "https://cdn/1t.jpg")]));
    expect(f.calls).toHaveLength(0);
    expect(String(row("bluesky:a1")?.["thumb_r2_key"])).toMatch(/media_01\.thumb\.jpg$/);
  });

  it("en fabrique une quand le téléchargement de la miniature fournie échoue", async () => {
    const f = fakeImages();
    const { archive, row } = await setup(f.images);
    network({ "https://cdn/1.jpg": "image" });
    await archive(post(1, [media("https://cdn/1.jpg", "https://cdn/absente.jpg")]));
    expect(f.calls).toHaveLength(1);
    expect(String(row("bluesky:a1")?.["thumb_r2_key"])).toMatch(/\.thumb\.webp$/);
  });

  it("n'en fabrique pas pour une vidéo, un doublon ni une image non téléchargée", async () => {
    const f = fakeImages();
    const { archive, row } = await setup(f.images);
    network({ "https://cdn/v.mp4": "video", "https://cdn/1.jpg": "image" });
    await archive(post(1, [media("https://cdn/v.mp4", null, "video"), media("https://cdn/1.jpg"), media("https://cdn/absente.jpg")]));
    expect(f.calls).toHaveLength(1);
    await archive(post(2, [media("https://cdn/1.jpg")]));
    expect(f.calls).toHaveLength(1);
    expect(row("bluesky:a2")).toMatchObject({ thumb_r2_key: expect.stringMatching(/a1\/media_02\.thumb\.webp$/) as string });
  });

  it("l'archivage réussit sans miniature quand la liaison échoue (quota) ou est absente", async () => {
    for (const images of [fakeImages({ fail: true }).images, undefined]) {
      const { archive, row } = await setup(images);
      network({ "https://cdn/1.jpg": "image" });
      await archive(post(1, [media("https://cdn/1.jpg")]));
      expect(row("bluesky:a1")).toMatchObject({ thumb_r2_key: null, thumb_width: null });
    }
  });
});

describe("makeThumbnail", () => {
  it("refuse sans appeler la liaison : SVG, type inconnu, fichier absent, source trop grosse", async () => {
    const f = fakeImages();
    const { env, media: r2 } = localEnv();
    await env.MEDIA.put("k", "x");
    expect(await makeThumbnail(f.images, env.MEDIA, "k", "image/svg+xml", 1)).toBeNull();
    expect(await makeThumbnail(f.images, env.MEDIA, "k", null, 1)).toBeNull();
    expect(await makeThumbnail(f.images, env.MEDIA, "k", "video/mp4", 1)).toBeNull();
    expect(await makeThumbnail(f.images, env.MEDIA, "absent", "image/jpeg", 1)).toBeNull();
    expect(await makeThumbnail(f.images, env.MEDIA, "k", "image/jpeg", MAX_THUMB_SOURCE_BYTES + 1)).toBeNull();
    expect(f.calls).toHaveLength(0);
    expect(r2.files.size).toBe(1);
  });
});
