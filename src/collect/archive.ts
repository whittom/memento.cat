import type { NormalizedPost } from "../connectors/types";
import type { Budget } from "../lib/budget";
import type { Config } from "../lib/config";
import { BudgetExhaustedError, errorMessage } from "../lib/errors";
import { log } from "../lib/log";
import { findOriginal, insertPost, type MediaInsert, type OriginalOf } from "../storage/db";
import { extensionFor, mediaKey, postJsonKey, postPrefix, thumbKey } from "../storage/keys";
import { putJson, storeRemoteFile } from "../storage/r2";
import { makeThumbnail } from "../storage/thumbnail";
import { canAnalyse, dimensionsOf, fingerprintOf, toHex, type ImageSource } from "../dedupe/fingerprint";
import { findSimilarOriginal } from "../dedupe/similar";
import { groupRoot, reassignRoot } from "../dedupe/owner";

const MAX_THUMB_BYTES = 5 * 1024 * 1024;

/** Nombre de sous-requêtes qu'exige l'archivage d'une publication. */
export function fetchesNeeded(post: NormalizedPost): number {
  return post.media.reduce((n, m) => n + 1 + (m.thumbUrl ? 1 : 0), 0);
}

/**
 * Requêtes D1 : existence, insertion (3 + une par média), reconnaissance des doublons (au plus quatre par média :
 * adresse, miniature, contenu, fichier), curseur, plus une réserve pour le bilan du créateur. La réorientation d'un
 * groupe (9.14) n'est faite que s'il reste du budget.
 */
export function queriesNeeded(post: NormalizedPost): number {
  return 1 + 3 + post.media.length * 5 + 1 + 1;
}

/** La ligne d'un doublon : elle se sert des fichiers et des mesures de l'original et garde le lien (exigence 9.2). */
function linkedTo(row: MediaInsert, original: OriginalOf): MediaInsert {
  return {
    ...row,
    mime_type: original.mime_type,
    r2_key: original.r2_key,
    etag: original.etag,
    bytes: original.bytes,
    width: original.width,
    height: original.height,
    thumb_r2_key: original.thumb_r2_key,
    thumb_width: original.thumb_width,
    thumb_height: original.thumb_height,
    downloaded: 1,
    duplicate_post_id: original.post_id,
    duplicate_position: original.position,
  };
}

/**
 * Archive une publication : médias et miniatures dans R2, puis post.json (source de vérité), puis l'index D1. Un média
 * en échec est enregistré comme « non téléchargé ». Un média identique à un original du même créateur n'a pas de fichier
 * propre : sa ligne est liée à l'original (exigence 9). Reconnaissance, dans l'ordre :
 * 1. même adresse : rien n'est téléchargé ;
 * 2. miniature de la plateforme qui ressemble à un original d'au moins autant de pixels : le fichier complet n'est pas
 *    téléchargé (9.16 ; seule voie pour une vidéo, 9.18) ;
 * 3. même contenu (MD5 et taille), puis même image par empreinte du fichier (9.11).
 * Enfin, un groupe dont l'original a été publié après cette publication lui est donné (9.14).
 */
export async function archivePost(
  env: Env,
  db: D1Database,
  budget: Budget,
  config: Config,
  post: NormalizedPost,
  creator: { handle: string; displayName: string | null },
  capturedAt: string,
): Promise<void> {
  const prefix = postPrefix(post);
  const rows: MediaInsert[] = [];
  const visual = config.visualDedupeThreshold > 0 && !!env.IMAGES;

  for (const [position, m] of post.media.entries()) {
    const row: MediaInsert = {
      post_id: post.id,
      position,
      kind: m.kind,
      mime_type: null,
      r2_key: null,
      etag: null,
      bytes: null,
      width: m.width,
      height: m.height,
      thumb_r2_key: null,
      thumb_width: m.thumbWidth,
      thumb_height: m.thumbHeight,
      description: m.description,
      source_url: m.sourceUrl,
      downloaded: 0,
    };

    const identical = (original: OriginalOf, how: "adresse" | "contenu" | "miniature" | "visuel", bits?: number): void => {
      log.info("média identique", { post: post.id, position, original: `${original.post_id}#${original.position}`, par: how, ecart: bits });
      rows.push(linkedTo(row, original));
    };

    // 1. Même adresse qu'un original : rien à télécharger, ni le média ni sa miniature.
    const bySource = await findOriginal(db, post.creatorId, { kind: m.kind, sourceUrl: m.sourceUrl }, rows);
    if (bySource) {
      identical(bySource, "adresse");
      continue;
    }

    // La miniature fournie par la plateforme est téléchargée d'abord : elle sert à reconnaître le média sans lui.
    let thumb: { key: string; mimeType: string | null; bytes: number | null } | null = null;
    if (m.thumbUrl) {
      const thumbUrl = m.thumbUrl;
      try {
        const t = await storeRemoteFile(env.MEDIA, budget, thumbUrl, MAX_THUMB_BYTES, (mime) =>
          thumbKey(prefix, position, extensionFor(mime, thumbUrl, "image")),
        );
        if (t.stored) thumb = { key: t.key, mimeType: t.mimeType, bytes: t.bytes };
      } catch (e) {
        if (e instanceof BudgetExhaustedError) throw e;
        log.warn("échec du téléchargement d'une miniature", { post: post.id, position, error: errorMessage(e) });
      }
    }
    const dropThumb = async () => {
      if (thumb) await env.MEDIA.delete(thumb.key);
    };

    // 2. La miniature ressemble à un original : le fichier complet n'est pas téléchargé (9.16, 9.18).
    let thumbPrint: string | null = null;
    const kind = m.kind === "video" ? "video" : m.kind === "image" ? "image" : null;
    if (visual && kind && thumb && m.width && m.height) {
      const source: ImageSource = { images: env.IMAGES, bucket: env.MEDIA, key: thumb.key, mimeType: thumb.mimeType, bytes: thumb.bytes };
      const print = canAnalyse(source) ? await fingerprintOf(source) : null;
      if (print) {
        const similar = await findSimilarOriginal(db, post.creatorId, kind, print, { width: m.width, height: m.height }, config.visualDedupeThreshold, rows, source);
        if (similar) {
          await dropThumb();
          identical(similar.original, "miniature", similar.bits);
          continue;
        }
        thumbPrint = toHex(print);
      }
    }

    try {
      const full = await storeRemoteFile(env.MEDIA, budget, m.sourceUrl, config.maxMediaBytes, (mime) =>
        mediaKey(prefix, position, extensionFor(mime, m.sourceUrl, m.kind)),
      );
      row.mime_type = full.mimeType;
      row.bytes = full.bytes;
      if (full.stored) {
        // 3a. Même contenu qu'un original (téléversé sous une autre adresse) : on ne garde pas le second fichier.
        const byContent = await findOriginal(db, post.creatorId, { kind: m.kind, sourceUrl: m.sourceUrl, etag: full.etag, bytes: full.bytes }, rows);
        if (byContent) {
          await env.MEDIA.delete(full.key);
          await dropThumb();
          identical(byContent, "contenu");
          continue;
        }
        // 3b. Même image, autre encodage (9.11) : reconnue par empreinte du fichier, puis au besoin pixel à pixel.
        const source: ImageSource = { images: env.IMAGES, bucket: env.MEDIA, key: full.key, mimeType: full.mimeType, bytes: full.bytes };
        if (m.kind === "image" && visual && canAnalyse(source)) {
          const dims = row.width && row.height ? { width: row.width, height: row.height } : await dimensionsOf(source);
          if (dims) {
            row.width = dims.width;
            row.height = dims.height;
          }
          const print = await fingerprintOf(source);
          const similar = print && dims ? await findSimilarOriginal(db, post.creatorId, "image", print, dims, config.visualDedupeThreshold, rows, source) : null;
          if (similar) {
            await env.MEDIA.delete(full.key);
            await dropThumb();
            identical(similar.original, "visuel", similar.bits);
            continue;
          }
          row.fingerprint = print ? toHex(print) : "";
        } else if (m.kind === "video" && visual) {
          // Une vidéo est reconnue par sa miniature (9.18) ; sans miniature lisible, elle n'est jamais comparée.
          row.fingerprint = thumbPrint ?? "";
        }
        row.r2_key = full.key;
        row.etag = full.etag;
        row.downloaded = 1;
      } else {
        log.warn("média non stocké", { post: post.id, position, reason: full.reason });
      }
    } catch (e) {
      if (e instanceof BudgetExhaustedError) throw e;
      log.warn("échec du téléchargement d'un média", { post: post.id, position, error: errorMessage(e) });
    }

    if (thumb) row.thumb_r2_key = thumb.key;

    // Une image sans miniature en reçoit une, fabriquée (exigence 10) ; un doublon se sert de celle de l'original.
    if (row.kind === "image" && row.downloaded === 1 && row.r2_key && row.thumb_r2_key === null) {
      const made = await makeThumbnail(env.IMAGES, env.MEDIA, row.r2_key, row.mime_type, row.bytes);
      if (made) {
        const key = thumbKey(prefix, position, "webp");
        await env.MEDIA.put(key, made.bytes, { httpMetadata: { contentType: "image/webp" } });
        row.thumb_r2_key = key;
        row.thumb_width = made.width;
        row.thumb_height = made.height;
      }
    }
    rows.push(row);
  }

  await putJson(env.MEDIA, postJsonKey(prefix), {
    ...post,
    creator: { handle: creator.handle, displayName: creator.displayName },
    capturedAt,
    status: "active",
    media: post.media.map((m, i) => ({
      ...m,
      r2Key: rows[i]?.r2_key ?? null,
      thumbR2Key: rows[i]?.thumb_r2_key ?? null,
      mimeType: rows[i]?.mime_type ?? null,
      bytes: rows[i]?.bytes ?? null,
      etag: rows[i]?.etag ?? null,
      downloaded: rows[i]?.downloaded === 1,
      duplicateOf: rows[i]?.duplicate_post_id ? { postId: rows[i]?.duplicate_post_id, position: rows[i]?.duplicate_position ?? 0 } : null,
    })),
  });

  await insertPost(db, post, prefix, rows, capturedAt);
  await claimFirstOccurrence(env, db, budget, post, rows);
}

/** Requêtes D1 réservées à la réorientation d'un groupe pendant la collecte (environ cinq plus une par membre). */
const CLAIM_QUERIES = 12;

/**
 * Première occurrence dès l'archivage (9.14) : un média de cette publication relié à un original publié **après** elle
 * prend le groupe. Seulement si le budget de l'exécution le permet ; sinon le ménage s'en chargera (9.12).
 */
async function claimFirstOccurrence(env: Env, db: D1Database, budget: Budget, post: NormalizedPost, rows: MediaInsert[]): Promise<void> {
  const originals = new Map<string, { postId: string; position: number }>();
  for (const r of rows) {
    if (r.duplicate_post_id && r.duplicate_post_id !== post.id) {
      originals.set(`${r.duplicate_post_id}#${r.duplicate_position ?? 0}`, { postId: r.duplicate_post_id, position: r.duplicate_position ?? 0 });
    }
  }
  for (const o of originals.values()) {
    if (!budget.has(0, CLAIM_QUERIES)) return;
    const root = await groupRoot(db, o.postId, o.position);
    if (!root || root.published_at <= post.publishedAt) continue;
    try {
      await reassignRoot(env, db, root);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) return;
      log.warn("réorientation à l'archivage impossible", { post: post.id, original: `${o.postId}#${o.position}`, error: errorMessage(e) });
    }
  }
}
