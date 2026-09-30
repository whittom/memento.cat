import type { MediaKind, NormalizedPost } from "../connectors/types";

/** Segment de chemin sûr pour un créateur : "bluesky:did:plc:abc" → "did_plc_abc". */
export function creatorSegment(creatorId: string): string {
  const stable = creatorId.slice(creatorId.indexOf(":") + 1);
  return stable.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Préfixe R2 d'une publication : <plateforme>/<créateur>/<AAAA>/<MM>/<AAAA-MM-JJ>_<id>/ */
export function postPrefix(post: Pick<NormalizedPost, "platform" | "creatorId" | "publishedAt" | "nativeId">): string {
  const day = post.publishedAt.slice(0, 10);
  const [year, month] = day.split("-");
  const id = post.nativeId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${post.platform}/${creatorSegment(post.creatorId)}/${year}/${month}/${day}_${id}/`;
}

export function creatorPrefix(platform: string, creatorId: string): string {
  return `${platform}/${creatorSegment(creatorId)}/`;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Extension à partir du type MIME, sinon de l'URL, sinon du genre de média. */
export function extensionFor(mime: string | null, url: string, kind: MediaKind): string {
  const fromMime = mime ? EXT_BY_MIME[mime.split(";")[0]?.trim().toLowerCase() ?? ""] : undefined;
  if (fromMime) return fromMime;
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();
  const m = /\.([a-z0-9]{2,4})$/i.exec(path);
  if (m?.[1]) return m[1].toLowerCase();
  return kind === "image" ? "jpg" : "mp4";
}

export function mediaKey(prefix: string, position: number, ext: string): string {
  return `${prefix}media_${String(position + 1).padStart(2, "0")}.${ext}`;
}

export function thumbKey(prefix: string, position: number, ext: string): string {
  return `${prefix}media_${String(position + 1).padStart(2, "0")}.thumb.${ext}`;
}

export function postJsonKey(prefix: string): string {
  return `${prefix}post.json`;
}
