import type { MediaInsert, OriginalOf } from "../storage/db";
import {
  CONFIRM_MAX_BITS,
  CONFIRM_MAX_PIXEL_DIFF,
  distance,
  fromHex,
  pixelCount,
  pixelDifference,
  pixelSampleOf,
  sameAspect,
  type Dimensions,
  type Fingerprint,
  type ImageSource,
  type PixelSample,
} from "./fingerprint";

/**
 * Reconnaissance visuelle à l'archivage (exigences 9.11, 9.16 et 9.18, reprise de L10.11 et L10.13 de memento-local) :
 * un média nouvellement archivé, qui n'est pas identique octet pour octet à un média du créateur, est comparé à ses
 * originaux de même genre par empreinte, puis, pour une paire douteuse, pixel à pixel.
 * - Image : empreinte du fichier (ou de la miniature de la plateforme, avant téléchargement, 9.16).
 * - Vidéo : empreinte de sa miniature (9.18) ; règle plus stricte, faute d'autre indice : écart d'au plus le seuil
 *   **et** second regard toujours exigé.
 */

/**
 * Seconds regards au plus par média archivé : chacun coûte deux transformations Images. Borne le coût d'un média
 * qui ressemble vaguement à beaucoup d'autres.
 */
export const MAX_CONFIRMATIONS = 3;

type Row = OriginalOf & { fingerprint: string | null };

export type VisualKind = "image" | "video";

/** Fichier comparé pixel à pixel pour un original : l'image elle-même, ou la miniature d'une vidéo. */
const sampleKeyOf = (kind: VisualKind, row: Pick<OriginalOf, "r2_key" | "thumb_r2_key">) => (kind === "video" ? row.thumb_r2_key : row.r2_key);

/** Type d'image déduit de l'extension d'une miniature (le type d'une miniature n'est pas conservé en base). */
export const mimeFromKey = (key: string): string => {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "avif" ? "image/avif" : ext === "gif" ? "image/gif" : "image/jpeg";
};

/**
 * Original visuellement identique : même créateur, même genre, écart d'au plus `threshold` bits (ou d'au plus
 * CONFIRM_MAX_BITS si le second regard le confirme, images seulement), même rapport largeur/hauteur, et au moins
 * autant de pixels que le nouveau média (sinon on garderait le moins bon : le ménage retiendra le meilleur). Le plus
 * proche l'emporte. Seuls les originaux qui ont déjà une empreinte sont comparés (9.15). Une requête D1.
 */
export async function findSimilarOriginal(
  db: D1Database,
  creatorId: string,
  kind: VisualKind,
  print: Fingerprint,
  dims: Dimensions,
  threshold: number,
  pending: MediaInsert[],
  /** L'image comparée pixel à pixel : le nouveau fichier, ou la miniature (vidéo, ou image avant téléchargement). */
  mine: ImageSource,
): Promise<{ original: OriginalOf; bits: number } | null> {
  const { results } = await db
    .prepare(
      `SELECT m.post_id, m.position, m.mime_type, m.r2_key, m.etag, m.bytes, m.width, m.height,
              m.thumb_r2_key, m.thumb_width, m.thumb_height, m.fingerprint
       FROM media m JOIN posts p ON p.id = m.post_id
       WHERE p.creator_id = ? AND m.kind = ? AND m.downloaded = 1
         AND m.r2_key IS NOT NULL AND m.duplicate_post_id IS NULL AND length(m.fingerprint) = 64`,
    )
    .bind(creatorId, kind)
    .all<Row>();

  const local: Row[] = pending
    .filter((m) => m.kind === kind && m.downloaded === 1 && m.r2_key !== null && (m.duplicate_post_id ?? null) === null && m.fingerprint)
    .map((m) => ({ ...m, fingerprint: m.fingerprint ?? null }));

  let own: PixelSample | null | undefined;
  let confirmations = 0;
  const confirmed = async (row: Row): Promise<boolean> => {
    const key = sampleKeyOf(kind, row);
    if (!key || confirmations >= MAX_CONFIRMATIONS) return false;
    confirmations++;
    if (own === undefined) own = await pixelSampleOf(mine);
    const mimeType = kind === "video" ? mimeFromKey(key) : row.mime_type;
    const theirs = own ? await pixelSampleOf({ ...mine, key, mimeType, bytes: kind === "video" ? null : row.bytes }) : null;
    return !!own && !!theirs && pixelDifference(own, theirs) <= CONFIRM_MAX_PIXEL_DIFF;
  };

  // Les plus proches d'abord : le second regard, limité, porte sur les meilleurs candidats.
  const candidates = [...local, ...results]
    .map((row) => ({ row, other: fromHex(row.fingerprint) }))
    .filter((c): c is { row: Row; other: Fingerprint } => !!c.other && sameAspect(dims, c.row) && pixelCount(c.row) >= pixelCount(dims))
    .map((c) => ({ row: c.row, bits: distance(print, c.other) }))
    .sort((a, b) => a.bits - b.bits);

  const widest = kind === "video" ? threshold : CONFIRM_MAX_BITS;
  for (const { row, bits } of candidates) {
    if (bits > widest) return null;
    if (kind === "image" && bits <= threshold) return { original: row, bits };
    if (await confirmed(row)) return { original: row, bits };
  }
  return null;
}
