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
 * Reconnaissance visuelle à l'archivage (exigence 9.11, reprise de L10.11 et L10.13 de memento-local) : une image
 * nouvellement téléchargée, qui n'est pas identique octet pour octet à un média du créateur, est comparée à ses
 * originaux par empreinte, puis, pour une paire douteuse, pixel à pixel.
 */

/**
 * Seconds regards au plus par image archivée : chacun coûte deux transformations Images. Borne le coût d'une image
 * qui ressemble vaguement à beaucoup d'autres.
 */
export const MAX_CONFIRMATIONS = 3;

type Row = OriginalOf & { fingerprint: string | null; kind?: string };

/**
 * Original visuellement identique à `print` : même créateur, écart d'au plus `threshold` bits (ou d'au plus
 * CONFIRM_MAX_BITS si le second regard le confirme), même rapport largeur/hauteur, et au moins autant de pixels que
 * la nouvelle image (sinon on garderait la moins bonne : le ménage depuis la page Créateurs retiendra la meilleure).
 * Le plus proche l'emporte. Seuls les originaux qui ont déjà une empreinte sont comparés : celles de l'archive
 * existante se calculent depuis la page Créateurs. Une requête D1.
 */
export async function findSimilarOriginal(
  db: D1Database,
  creatorId: string,
  print: Fingerprint,
  dims: Dimensions,
  threshold: number,
  pending: MediaInsert[],
  /** Le nouveau fichier, pour le second regard. */
  mine: ImageSource,
): Promise<{ original: OriginalOf; bits: number } | null> {
  const { results } = await db
    .prepare(
      `SELECT m.post_id, m.position, m.mime_type, m.r2_key, m.etag, m.bytes, m.width, m.height,
              m.thumb_r2_key, m.thumb_width, m.thumb_height, m.fingerprint
       FROM media m JOIN posts p ON p.id = m.post_id
       WHERE p.creator_id = ? AND m.kind = 'image' AND m.downloaded = 1
         AND m.r2_key IS NOT NULL AND m.duplicate_post_id IS NULL AND length(m.fingerprint) = 64`,
    )
    .bind(creatorId)
    .all<Row>();

  const local: Row[] = pending
    .filter((m) => m.kind === "image" && m.downloaded === 1 && m.r2_key !== null && (m.duplicate_post_id ?? null) === null && m.fingerprint)
    .map((m) => ({ ...m, fingerprint: m.fingerprint ?? null }));

  let own: PixelSample | null | undefined;
  let confirmations = 0;
  const confirmed = async (row: Row): Promise<boolean> => {
    if (!row.r2_key || confirmations >= MAX_CONFIRMATIONS) return false;
    confirmations++;
    if (own === undefined) own = await pixelSampleOf(mine);
    const theirs = own ? await pixelSampleOf({ ...mine, key: row.r2_key, mimeType: row.mime_type, bytes: row.bytes }) : null;
    return !!own && !!theirs && pixelDifference(own, theirs) <= CONFIRM_MAX_PIXEL_DIFF;
  };

  // Les plus proches d'abord : le second regard, limité, porte sur les meilleurs candidats.
  const candidates = [...local, ...results]
    .map((row) => ({ row, other: fromHex(row.fingerprint) }))
    .filter((c): c is { row: Row; other: Fingerprint } => !!c.other && sameAspect(dims, c.row) && pixelCount(c.row) >= pixelCount(dims))
    .map((c) => ({ row: c.row, bits: distance(print, c.other) }))
    .sort((a, b) => a.bits - b.bits);

  for (const { row, bits } of candidates) {
    if (bits <= threshold) return { original: row, bits };
    if (bits > CONFIRM_MAX_BITS) return null;
    if (await confirmed(row)) return { original: row, bits };
  }
  return null;
}
