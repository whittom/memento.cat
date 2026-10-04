import { log } from "../lib/log";

/**
 * Miniature d'une image (exigence 10, conception « Miniatures fabriquées ») : l'image réduite pour tenir
 * dans 480 × 480 px, proportions conservées, jamais agrandie, en WebP. Les tuiles de la galerie la chargent
 * à la place de l'original. Fabriquée par la liaison Cloudflare Images (`env.IMAGES`) : le décodage se fait
 * hors du Worker, qui ne dépense presque pas de temps processeur.
 */
export const THUMB_SIDE = 480;
const QUALITY = 78;
/** Taille maximale d'une image acceptée par la liaison Images. */
export const MAX_THUMB_SOURCE_BYTES = 20 * 1024 * 1024;

export interface Thumbnail {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * La miniature d'une image de R2, ou null si la liaison est absente, si le fichier n'existe pas, s'il est
 * trop gros, s'il n'est pas une image ou est illisible, ou si le quota de transformations est atteint.
 * Jamais d'exception : une miniature manquante n'empêche pas l'archivage (la tuile affiche l'original).
 */
export async function makeThumbnail(
  images: ImagesBinding | undefined,
  bucket: R2Bucket,
  key: string,
  mimeType: string | null,
  bytes: number | null,
): Promise<Thumbnail | null> {
  if (!images || !mimeType?.startsWith("image/") || mimeType === "image/svg+xml") return null;
  if (bytes !== null && bytes > MAX_THUMB_SOURCE_BYTES) return null;
  try {
    const source = await bucket.get(key);
    if (!source) return null;
    const result = await images
      .input(source.body as ReadableStream<Uint8Array>)
      .transform({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "scale-down" })
      .output({ format: "image/webp", quality: QUALITY });
    const out = new Uint8Array(await result.response().arrayBuffer());
    const info = await images.info(new Response(out).body as ReadableStream<Uint8Array>);
    if (!("width" in info) || info.width <= 0 || info.height <= 0) return null;
    return { bytes: out, width: info.width, height: info.height };
  } catch (e) {
    log.warn("miniature impossible à fabriquer", { key, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
