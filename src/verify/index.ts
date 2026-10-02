import { createConnectors } from "../connectors";
import type { Platform } from "../connectors/types";
import { Budget } from "../lib/budget";
import { readConfig } from "../lib/config";
import { HttpError } from "../lib/errors";
import { purgePosts } from "../purge";
import { countToVerify, getCreator, postsToVerify, recordChecks } from "../storage/db";

export interface VerifyProgress {
  startedAt: string;
  processed: number;
  /** Publications marquées « supprimées » et conservées (Bluesky, Mastodon). */
  deleted: number;
  /** Publications effacées définitivement de l'archive (Reddit). */
  purged: number;
  remaining: number;
}

const BATCH = 25;

/**
 * Plateformes dont les conditions imposent d'effacer un contenu supprimé à la source (exigence 5.5).
 * Les autres gardent la copie avec le statut « supprimé » (questions ouvertes Q2 et Q5).
 */
const PURGES_DELETED: readonly Platform[] = ["reddit"];

export const purgesDeletedContent = (platform: Platform): boolean => PURGES_DELETED.includes(platform);

/**
 * Vérifie un lot de publications d'un créateur. Déclenché uniquement à la demande :
 * la galerie rappelle cette fonction avec le même startedAt jusqu'à remaining = 0.
 * Une publication constatée supprimée est marquée (Bluesky, Mastodon) ou effacée (Reddit).
 */
export async function verifyBatch(env: Env, creatorId: string, startedAt: string | null): Promise<VerifyProgress> {
  const creator = await getCreator(env.DB, creatorId);
  if (!creator || creator.state === "purging") throw new HttpError(404, "Créateur introuvable");

  const config = readConfig(env);
  const budget = new Budget(config.maxSubrequestsPerRun);
  const connector = createConnectors({ env, config, budget })[creator.platform];
  const session = startedAt ?? new Date().toISOString();
  const purge = purgesDeletedContent(creator.platform);

  const posts = await postsToVerify(env.DB, creatorId, session, BATCH);
  let deleted = 0;
  let purged = 0;
  for (let i = 0; i < posts.length; i += connector.checkBatchSize) {
    const chunk = posts.slice(i, i + connector.checkBatchSize);
    const states = await connector.checkStates(chunk.map((p) => p.native_ref));
    const gone = chunk.filter((p) => states.get(p.native_ref) === "deleted");

    // Les publications encore en ligne sont d'abord marquées vérifiées, puis les retirées sont traitées.
    const toRecord = purge ? chunk.filter((p) => !gone.includes(p)) : chunk;
    await recordChecks(
      env.DB,
      toRecord.map((p) => ({ id: p.id, deleted: gone.includes(p) })),
      new Date().toISOString(),
    );
    if (purge) {
      await purgePosts(env, gone);
      purged += gone.length;
    } else {
      deleted += gone.length;
    }
  }

  return { startedAt: session, processed: posts.length, deleted, purged, remaining: await countToVerify(env.DB, creatorId, session) };
}
