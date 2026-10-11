import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../src/api";
import { HF_CHAT_URL, cleanDescription, describeMedia } from "../src/describe";
import type { NormalizedPost } from "../src/connectors/types";
import { insertCreator, insertPost, listPosts, type MediaInsert } from "../src/storage/db";
import { fakeImages, image } from "./fake-images";
import { localEnv } from "./local-env";

const NOW = "2026-10-11T12:00:00.000Z";
const A = "bluesky:did:plc:a";

/** Faux service Hugging Face : rend la réponse indiquée et note chaque appel. */
function hugging(reply: { status?: number; content?: unknown } = {}) {
  const calls: { url: string; auth: string | null; body: { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] } }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) as never });
    if (reply.status && reply.status !== 200) return new Response("erreur", { status: reply.status });
    return Response.json({ choices: [{ message: { role: "assistant", content: reply.content ?? "Un phare blanc au bord d'une falaise, sous un ciel orageux." } }] });
  });
  return calls;
}

async function setup(vars: Record<string, string | undefined> = { HF_TOKEN: "hf_test" }) {
  const ctx = localEnv();
  Object.assign(ctx.env, { IMAGES: fakeImages().images, HF_VISION_MODEL: "test/modele", ...vars });
  await insertCreator(ctx.env.DB, { id: A, platform: "bluesky", handle: "a.test", displayName: null }, NOW);
  const p: NormalizedPost = {
    id: "bluesky:a1", platform: "bluesky", creatorId: A, nativeRef: "at://x/1", nativeId: "a1",
    publishedAt: "2026-09-01T12:00:00.000Z", title: null, text: "", sourceUrl: "https://bsky.app/1", media: [],
  };
  const prefix = "bluesky/a/2026/09/1/";
  await ctx.env.MEDIA.put(`${prefix}media_01.jpg`, image({ seed: 1 }));
  await ctx.env.MEDIA.put(`${prefix}media_02.mp4`, "vidéo");
  await ctx.env.MEDIA.put(`${prefix}media_02.thumb.jpg`, image({ seed: 2 }));
  await ctx.env.MEDIA.put(`${prefix}post.json`, JSON.stringify({ ...p, media: [{ r2Key: `${prefix}media_01.jpg` }, { r2Key: `${prefix}media_02.mp4` }] }));
  const base = { post_id: p.id, etag: null, bytes: 10, width: 1000, height: 800, thumb_width: null, thumb_height: null, source_url: "https://cdn/x", downloaded: 1 };
  const rows: MediaInsert[] = [
    { ...base, position: 0, kind: "image", mime_type: "image/jpeg", r2_key: `${prefix}media_01.jpg`, thumb_r2_key: null, description: "Texte du créateur" },
    { ...base, position: 1, kind: "video", mime_type: "video/mp4", r2_key: `${prefix}media_02.mp4`, thumb_r2_key: `${prefix}media_02.thumb.jpg`, description: null },
  ];
  await insertPost(ctx.env.DB, p, prefix, rows, NOW);
  const media = (position: number) =>
    ctx.sqlite.prepare("SELECT description, ai_description, ai_description_model FROM media WHERE post_id = 'bluesky:a1' AND position = ?").get(position);
  return { ...ctx, media, prefix };
}

afterEach(() => vi.unstubAllGlobals());

describe("description d'un média par IA (exigence 11)", () => {
  it("envoie l'image réduite au modèle, conserve la description à part et l'indexe", async () => {
    const { env, media: get, prefix } = await setup();
    const calls = hugging();
    const d = await describeMedia(env, "bluesky:a1", 0, false, NOW);
    expect(d).toEqual({ text: "Un phare blanc au bord d'une falaise, sous un ciel orageux.", model: "test/modele", at: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: HF_CHAT_URL, auth: "Bearer hf_test", body: { model: "test/modele" } });
    expect(calls[0]?.body.messages[0]?.content[1]?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    // Le texte du créateur est intact ; la description IA est à part, dans la base et dans post.json.
    expect(get(0)).toMatchObject({ description: "Texte du créateur", ai_description: d.text, ai_description_model: "test/modele" });
    const json = (await (await env.MEDIA.get(`${prefix}post.json`))!.json()) as { media: { aiDescription?: unknown }[] };
    expect(json.media[0]?.aiDescription).toEqual(d);
    expect((await listPosts(env.DB, { q: "phare", limit: 10 })).map((r) => r.id)).toEqual(["bluesky:a1"]);
  });

  it("rend la description conservée sans rappeler le modèle, et la régénère sur demande", async () => {
    const { env } = await setup();
    const calls = hugging();
    await describeMedia(env, "bluesky:a1", 0, false, NOW);
    await describeMedia(env, "bluesky:a1", 0, false, NOW);
    expect(calls).toHaveLength(1);
    hugging({ content: "Un autre texte." });
    expect((await describeMedia(env, "bluesky:a1", 0, true, NOW)).text).toBe("Un autre texte.");
  });

  it("décrit une vidéo par sa miniature", async () => {
    const { env, media } = await setup();
    hugging({ content: "Une vague qui déferle." });
    await describeMedia(env, "bluesky:a1", 1, false, NOW);
    expect(media(1)).toMatchObject({ ai_description: "Une vague qui déferle." });
  });

  it("messages explicites et rien de conservé : jeton absent, crédits épuisés, quota, modèle introuvable", async () => {
    const none = await setup({ HF_TOKEN: undefined });
    hugging();
    await expect(describeMedia(none.env, "bluesky:a1", 0, false, NOW)).rejects.toMatchObject({ status: 503 });
    for (const [status, expected] of [[402, 502], [429, 429], [404, 502], [401, 502]] as const) {
      const { env, media } = await setup();
      hugging({ status });
      await expect(describeMedia(env, "bluesky:a1", 0, false, NOW)).rejects.toMatchObject({ status: expected });
      expect(media(0)).toMatchObject({ ai_description: null });
    }
  });

  it("présente la description dans l'API, et la route valide la position", async () => {
    const { env } = await setup();
    hugging();
    const res = await handleApi(
      new Request("https://m/api/posts/bluesky%3Aa1/media/0/describe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      env,
    );
    expect(res.status).toBe(200);
    const listed = (await (await handleApi(new Request("https://m/api/posts/bluesky%3Aa1"), env)).json()) as { post: { media: { aiDescription: unknown }[] } };
    expect(listed.post.media[0]?.aiDescription).toMatchObject({ model: "test/modele" });
    const bad = handleApi(new Request("https://m/api/posts/bluesky%3Aa1/media/x/describe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), env);
    await expect(bad).rejects.toMatchObject({ status: 400 });
  });

  it("nettoie la réponse du modèle", () => {
    expect(cleanDescription("<think>je réfléchis\nlonguement</think>\n  Un chat   roux.  ")).toBe("Un chat roux.");
    expect(cleanDescription("raisonnement sans balise ouvrante</think>Un chien.")).toBe("Un chien.");
    expect(cleanDescription("x".repeat(3000))).toHaveLength(2000);
  });
});

describe("raison d'un refus du modèle", () => {
  it("extrait le message d'erreur du routeur Hugging Face", async () => {
    const { providerError } = await import("../src/describe");
    expect(providerError('{"error":{"message":"Model does not support image input","type":"invalid_request_error"}}')).toBe("Model does not support image input");
    expect(providerError('{"error":"Bad request: messages too long"}')).toBe("Bad request: messages too long");
    expect(providerError("texte brut")).toBe("texte brut");
  });
});
