import type { NormalizedPost } from "../connectors/types";
import type { Budget } from "../lib/budget";
import type { Config } from "../lib/config";
import { BudgetExhaustedError, errorMessage } from "../lib/errors";
import { log } from "../lib/log";
import { insertPost, type MediaInsert } from "../storage/db";
import { extensionFor, mediaKey, postJsonKey, postPrefix, thumbKey } from "../storage/keys";
import { putJson, storeRemoteFile } from "../storage/r2";

const MAX_THUMB_BYTES = 5 * 1024 * 1024;

/** Nombre de sous-requêtes qu'exige l'archivage d'une publication. */
export function fetchesNeeded(post: NormalizedPost): number {
  return post.media.reduce((n, m) => n + 1 + (m.thumbUrl ? 1 : 0), 0);
}

/** Requêtes D1 : existence, insertion (3 + une par média), curseur, plus une réserve pour le bilan du créateur. */
export function queriesNeeded(post: NormalizedPost): number {
  return 1 + 3 + post.media.length + 1 + 1;
}

/**
 * Archive une publication : médias et miniatures dans R2, puis post.json (source de vérité),
 * puis l'index D1. Un média en échec est enregistré comme « non téléchargé ».
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

    try {
      const full = await storeRemoteFile(env.MEDIA, budget, m.sourceUrl, config.maxMediaBytes, (mime) =>
        mediaKey(prefix, position, extensionFor(mime, m.sourceUrl, m.kind)),
      );
      row.mime_type = full.mimeType;
      row.bytes = full.bytes;
      if (full.stored) {
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

    if (m.thumbUrl) {
      const thumbUrl = m.thumbUrl;
      try {
        const thumb = await storeRemoteFile(env.MEDIA, budget, thumbUrl, MAX_THUMB_BYTES, (mime) =>
          thumbKey(prefix, position, extensionFor(mime, thumbUrl, "image")),
        );
        if (thumb.stored) row.thumb_r2_key = thumb.key;
      } catch (e) {
        if (e instanceof BudgetExhaustedError) throw e;
        log.warn("échec du téléchargement d'une miniature", { post: post.id, position, error: errorMessage(e) });
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
    })),
  });

  await insertPost(db, post, prefix, rows, capturedAt);
}
