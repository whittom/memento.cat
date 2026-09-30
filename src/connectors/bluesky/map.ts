import { arr, num, obj, str, type Json } from "../../lib/json";
import type { NormalizedMedia, NormalizedPost } from "../types";

export const BSKY_APPVIEW = "https://public.api.bsky.app";

/** Découpe une URI at://did/collection/rkey. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | undefined {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m?.[1] || !m[2] || !m[3]) return undefined;
  return { did: m[1], collection: m[2], rkey: m[3] };
}

export function blobUrl(pds: string, did: string, cid: string): string {
  const u = new URL("/xrpc/com.atproto.sync.getBlob", pds);
  u.searchParams.set("did", did);
  u.searchParams.set("cid", cid);
  return u.toString();
}

/**
 * Convertit un élément de app.bsky.feed.getAuthorFeed en publication normalisée.
 * Renvoie null pour les republications (repost) et les publications d'un autre auteur.
 * videoUrl(cid) construit l'URL de téléchargement d'une vidéo (blob sur le PDS de l'auteur).
 */
export function mapFeedItem(
  item: Json,
  creatorDid: string,
  videoUrl: (cid: string) => string,
): NormalizedPost | null {
  const it = obj(item);
  if (!it || it["reason"] !== undefined) return null;
  const post = obj(it["post"]);
  if (!post) return null;
  const author = obj(post["author"]);
  if (str(author?.["did"]) !== creatorDid) return null;

  const uri = str(post["uri"]);
  const parsed = uri ? parseAtUri(uri) : undefined;
  const record = obj(post["record"]);
  if (!uri || !parsed || !record) return null;

  const createdAt = str(record["createdAt"]);
  const indexedAt = str(post["indexedAt"]);
  const publishedAt = normalizeDate(createdAt, indexedAt);
  if (!publishedAt) return null;

  return {
    id: `bluesky:${parsed.rkey}`,
    platform: "bluesky",
    creatorId: `bluesky:${creatorDid}`,
    nativeRef: uri,
    nativeId: parsed.rkey,
    publishedAt,
    title: null,
    text: str(record["text"]) ?? "",
    sourceUrl: `https://bsky.app/profile/${creatorDid}/post/${parsed.rkey}`,
    media: mapEmbed(post["embed"], videoUrl),
  };
}

/** Date de création, bornée par la date d'indexation (une date future est ramenée à l'indexation). */
function normalizeDate(createdAt: string | undefined, indexedAt: string | undefined): string | undefined {
  const c = createdAt ? Date.parse(createdAt) : Number.NaN;
  const i = indexedAt ? Date.parse(indexedAt) : Number.NaN;
  if (Number.isFinite(c) && (!Number.isFinite(i) || c <= i)) return new Date(c).toISOString();
  if (Number.isFinite(i)) return new Date(i).toISOString();
  return undefined;
}

export function mapEmbed(embed: Json | undefined, videoUrl: (cid: string) => string): NormalizedMedia[] {
  const e = obj(embed);
  if (!e) return [];
  const type = str(e["$type"]);
  if (type === "app.bsky.embed.recordWithMedia#view") return mapEmbed(e["media"], videoUrl);
  if (type === "app.bsky.embed.images#view") {
    return arr(e["images"]).flatMap((img): NormalizedMedia[] => {
      const i = obj(img);
      const full = str(i?.["fullsize"]);
      if (!i || !full) return [];
      const ratio = obj(i["aspectRatio"]);
      return [{
        kind: "image",
        sourceUrl: full,
        thumbUrl: str(i["thumb"]) ?? null,
        width: num(ratio?.["width"]) ?? null,
        height: num(ratio?.["height"]) ?? null,
        thumbWidth: null,
        thumbHeight: null,
        description: nonEmpty(str(i["alt"])),
      }];
    });
  }
  if (type === "app.bsky.embed.video#view") {
    const cid = str(e["cid"]);
    if (!cid) return [];
    const ratio = obj(e["aspectRatio"]);
    return [{
      kind: "video",
      sourceUrl: videoUrl(cid),
      thumbUrl: str(e["thumbnail"]) ?? null,
      width: num(ratio?.["width"]) ?? null,
      height: num(ratio?.["height"]) ?? null,
      thumbWidth: null,
      thumbHeight: null,
      description: nonEmpty(str(e["alt"])),
    }];
  }
  return [];
}

function nonEmpty(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}
