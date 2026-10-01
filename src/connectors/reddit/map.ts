import { arr, bool, num, obj, str, type Json, type JsonObject } from "../../lib/json";
import type { NormalizedMedia, NormalizedPost } from "../types";

const THUMB_TARGET_WIDTH = 320;

interface Img { u: string; x: number | null; y: number | null }

function img(v: Json | undefined, urlKey = "u", wKey = "x", hKey = "y"): Img | undefined {
  const o = obj(v);
  const u = str(o?.[urlKey]);
  if (!o || !u) return undefined;
  return { u, x: num(o[wKey]) ?? null, y: num(o[hKey]) ?? null };
}

/** Choisit la plus petite résolution d'au moins 320 px de large, sinon la plus grande disponible. */
export function pickThumb(candidates: Img[]): Img | undefined {
  const sorted = [...candidates].sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  return sorted.find((c) => (c.x ?? 0) >= THUMB_TARGET_WIDTH) ?? sorted.at(-1);
}

function previewThumb(data: JsonObject): Img | undefined {
  const first = obj(arr(obj(data["preview"])?.["images"])[0]);
  if (!first) return undefined;
  const resolutions = arr(first["resolutions"])
    .map((r) => img(r, "url", "width", "height"))
    .filter((r): r is Img => r !== undefined);
  const source = img(first["source"], "url", "width", "height");
  return pickThumb(resolutions.length > 0 ? resolutions : source ? [source] : []);
}

function media(kind: NormalizedMedia["kind"], full: Img, thumb: Img | undefined, description: string | null): NormalizedMedia {
  return {
    kind,
    sourceUrl: full.u,
    thumbUrl: thumb?.u ?? null,
    width: full.x,
    height: full.y,
    thumbWidth: thumb?.x ?? null,
    thumbHeight: thumb?.y ?? null,
    description,
  };
}

/** Extrait les médias d'une publication Reddit (appel avec raw_json=1 : URL non échappées). */
export function mapMedia(data: JsonObject): NormalizedMedia[] {
  // Galerie : plusieurs éléments, chacun avec sa légende éventuelle.
  if (bool(data["is_gallery"])) {
    const metadata = obj(data["media_metadata"]) ?? {};
    return arr(obj(data["gallery_data"])?.["items"]).flatMap((item): NormalizedMedia[] => {
      const it = obj(item);
      const id = str(it?.["media_id"]);
      const meta = id ? obj(metadata[id]) : undefined;
      if (!it || !meta || str(meta["status"]) !== "valid") return [];
      const caption = str(it["caption"])?.trim() || null;
      const s = obj(meta["s"]);
      const previews = arr(meta["p"]).map((p) => img(p)).filter((p): p is Img => p !== undefined);
      const thumb = pickThumb(previews);
      if (str(meta["e"]) === "AnimatedImage") {
        const mp4 = img(s, "mp4");
        const gif = img(s, "gif");
        const full = mp4 ?? gif;
        return full ? [media("gif", full, thumb, caption)] : [];
      }
      const full = img(s);
      return full ? [media("image", full, thumb, caption)] : [];
    });
  }

  const thumb = previewThumb(data);

  // Vidéo hébergée par Reddit. fallback_url ne contient pas la piste audio.
  const video = obj(obj(data["media"])?.["reddit_video"]) ?? obj(obj(data["secure_media"])?.["reddit_video"]);
  if (bool(data["is_video"]) && video) {
    const full = img(video, "fallback_url", "width", "height");
    return full ? [media("video", full, thumb, null)] : [];
  }

  // GIF converti en MP4 par Reddit.
  const variants = obj(obj(arr(obj(data["preview"])?.["images"])[0])?.["variants"]);
  const mp4 = img(obj(variants?.["mp4"])?.["source"], "url", "width", "height");
  if (mp4) return [media("gif", mp4, thumb, null)];

  // Image simple.
  const url = str(data["url_overridden_by_dest"]) ?? str(data["url"]);
  if (url && (str(data["post_hint"]) === "image" || /^https:\/\/i\.redd\.it\//.test(url))) {
    const source = img(obj(arr(obj(data["preview"])?.["images"])[0])?.["source"], "url", "width", "height");
    return [media("image", { u: url, x: source?.x ?? null, y: source?.y ?? null }, thumb, null)];
  }
  return [];
}

export function mapSubmission(child: Json, creatorId: string): NormalizedPost | null {
  const c = obj(child);
  const data = obj(c?.["data"]);
  if (!c || str(c["kind"]) !== "t3" || !data) return null;
  // Republication croisée (crosspost) : le contenu vient d'un autre compte (exigence 2.3b).
  if (str(data["crosspost_parent"]) || arr(data["crosspost_parent_list"]).length > 0) return null;
  const fullname = str(data["name"]);
  const id = str(data["id"]);
  const created = num(data["created_utc"]);
  const permalink = str(data["permalink"]);
  if (!fullname || !id || created === undefined || !permalink) return null;

  const selftext = str(data["selftext"]) ?? "";
  return {
    id: `reddit:${fullname}`,
    platform: "reddit",
    creatorId,
    nativeRef: fullname,
    nativeId: id,
    publishedAt: new Date(created * 1000).toISOString(),
    title: str(data["title"]) ?? null,
    text: selftext,
    sourceUrl: `https://www.reddit.com${permalink}`,
    media: mapMedia(data),
  };
}

/** Une publication renvoyée par /api/info est supprimée si l'auteur ou le contenu ont été retirés. */
export function isRemoved(data: JsonObject): boolean {
  if (str(data["author"]) === "[deleted]") return true;
  if (data["removed_by_category"] !== null && data["removed_by_category"] !== undefined) return true;
  const selftext = str(data["selftext"]);
  return selftext === "[deleted]" || selftext === "[removed]";
}

export function isPinned(child: Json): boolean {
  const data = obj(obj(child)?.["data"]);
  return bool(data?.["stickied"]) || bool(data?.["pinned"]);
}
