import { isPlatform, type NormalizedPost } from "../connectors/types";
import { arr, bool, num, obj, str } from "../lib/json";
import { insertPost, upsertCreatorFromArchive, type MediaInsert } from "../storage/db";

/**
 * Reconstruit l'index D1 à partir des post.json de R2, par lots de 12 objets listés
 * (au plus ~7 requêtes D1 par publication, pour rester sous la limite du plan gratuit).
 * Les créateurs absents de D1 sont recréés à l'état « désactivé ».
 */
export async function reindexBatch(env: Env, cursor: string | undefined): Promise<{ indexed: number; cursor: string | null }> {
  const listed = await env.MEDIA.list({ cursor, limit: 12 });
  const keys = listed.objects.map((o) => o.key).filter((k) => k.endsWith("/post.json"));
  let indexed = 0;

  for (const key of keys) {
    const file = await env.MEDIA.get(key);
    const data = obj(file ? ((await file.json())) : null);
    const platform = data?.["platform"];
    if (!data || !isPlatform(platform)) continue;
    const creatorId = str(data["creatorId"]);
    const id = str(data["id"]);
    const publishedAt = str(data["publishedAt"]);
    if (!creatorId || !id || !publishedAt) continue;
    const creator = obj(data["creator"]);
    const capturedAt = str(data["capturedAt"]) ?? new Date().toISOString();

    await upsertCreatorFromArchive(env.DB, {
      id: creatorId,
      platform,
      handle: str(creator?.["handle"]) ?? creatorId,
      displayName: str(creator?.["displayName"]) ?? null,
      createdAt: capturedAt,
      cursor: publishedAt,
    });

    const prefix = key.slice(0, -"post.json".length);
    const post: NormalizedPost = {
      id,
      platform,
      creatorId,
      nativeRef: str(data["nativeRef"]) ?? "",
      nativeId: str(data["nativeId"]) ?? "",
      publishedAt,
      title: str(data["title"]) ?? null,
      text: str(data["text"]) ?? "",
      sourceUrl: str(data["sourceUrl"]) ?? "",
      media: [],
    };
    const media: MediaInsert[] = arr(data["media"]).map((m, position) => {
      const o = obj(m) ?? {};
      const kind = str(o["kind"]);
      return {
        post_id: id,
        position,
        kind: kind === "video" || kind === "gif" ? kind : "image",
        mime_type: str(o["mimeType"]) ?? null,
        r2_key: str(o["r2Key"]) ?? null,
        etag: str(o["etag"]) ?? null,
        bytes: num(o["bytes"]) ?? null,
        width: num(o["width"]) ?? null,
        height: num(o["height"]) ?? null,
        thumb_r2_key: str(o["thumbR2Key"]) ?? null,
        thumb_width: num(o["thumbWidth"]) ?? null,
        thumb_height: num(o["thumbHeight"]) ?? null,
        description: str(o["description"]) ?? null,
        source_url: str(o["sourceUrl"]) ?? "",
        downloaded: bool(o["downloaded"]) ? 1 : 0,
      };
    });
    await insertPost(env.DB, post, prefix, media, capturedAt);
    indexed++;
  }

  return { indexed, cursor: listed.truncated ? listed.cursor : null };
}
