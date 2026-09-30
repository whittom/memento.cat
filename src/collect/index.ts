import { createConnectors } from "../connectors";
import type { Connector, Platform } from "../connectors/types";
import { Budget, countingDb } from "../lib/budget";
import { readConfig, type Config } from "../lib/config";
import { BudgetExhaustedError, HttpError, NotFoundError, PlatformError, RateLimitError, errorMessage } from "../lib/errors";
import { log } from "../lib/log";
import { advanceCursor, creatorsToCollect, getCreator, postExists, recordRun, type CreatorRow } from "../storage/db";
import { archivePost, fetchesNeeded, queriesNeeded } from "./archive";

export interface CollectionSummary {
  creators: number;
  archived: number;
  stoppedEarly: boolean;
}

export interface CreatorCollection {
  archived: number;
  /** Faux si la limite de pages a été atteinte avant de rejoindre le curseur. */
  reachedCursor: boolean;
}

/**
 * Collecte un créateur : récupère les publications postérieures au curseur, archive les nouvelles
 * et fait avancer le curseur publication par publication. Lève BudgetExhaustedError si le budget
 * est épuisé en cours de route (le curseur reste valide, la suite viendra au passage suivant) ;
 * tally comptabilise alors quand même les publications déjà archivées.
 */
export async function collectCreator(
  env: Env,
  db: D1Database,
  budget: Budget,
  config: Config,
  connector: Pick<Connector, "fetchSince">,
  creator: CreatorRow,
  now: string,
  tally: { archived: number } = { archived: 0 },
): Promise<CreatorCollection> {
  const { posts, reachedCursor } = await connector.fetchSince(creator, creator.cursor);
  if (!reachedCursor) {
    log.warn("limite de pages atteinte avant le curseur : des publications intermédiaires peuvent manquer", {
      creator: creator.id,
    });
  }

  for (const post of posts) {
    if (await postExists(db, post.id)) {
      await advanceCursor(db, creator.id, post.publishedAt);
      continue;
    }
    if (!budget.has(fetchesNeeded(post), queriesNeeded(post))) throw new BudgetExhaustedError();
    await archivePost(env, db, budget, config, post, { handle: creator.handle, displayName: creator.display_name }, now);
    await advanceCursor(db, creator.id, post.publishedAt);
    tally.archived++;
  }
  await recordRun(env.DB, creator.id, { now, success: true, error: null });
  return { archived: tally.archived, reachedCursor };
}

/**
 * Collecte planifiée. Les créateurs sont traités du moins récemment au plus récemment passé ;
 * le curseur avance publication par publication, ce qui permet de s'arrêter à tout moment
 * (budget, quota) et de reprendre au passage suivant sans perte.
 */
export async function runCollection(env: Env): Promise<CollectionSummary> {
  const config = readConfig(env);
  const budget = new Budget(config.maxSubrequestsPerRun, config.maxQueriesPerRun);
  const db = countingDb(env.DB, budget);
  const connectors = createConnectors({ env, config, budget });
  const blocked = new Set<Platform>();
  const summary: CollectionSummary = { creators: 0, archived: 0, stoppedEarly: false };

  for (const creator of await creatorsToCollect(db)) {
    if (blocked.has(creator.platform)) continue;
    if (!budget.has(2, 3)) {
      summary.stoppedEarly = true;
      break;
    }
    summary.creators++;
    const now = new Date().toISOString();

    const tally = { archived: 0 };
    try {
      await collectCreator(env, db, budget, config, connectors[creator.platform], creator, now, tally);
      summary.archived += tally.archived;
    } catch (e) {
      summary.archived += tally.archived;
      if (e instanceof BudgetExhaustedError) {
        // Arrêt normal : la suite au prochain passage.
        await recordRun(env.DB, creator.id, { now, success: false, error: null });
        summary.stoppedEarly = true;
        break;
      }
      if (e instanceof RateLimitError) {
        blocked.add(creator.platform);
        log.warn("quota atteint", { platform: creator.platform, resetSeconds: e.resetSeconds });
      } else if (e instanceof NotFoundError) {
        log.warn("créateur introuvable sur la plateforme", { creator: creator.id });
      } else {
        log.error("échec de la collecte", { creator: creator.id, error: errorMessage(e) });
      }
      await recordRun(env.DB, creator.id, { now, success: false, error: errorMessage(e) });
    }
  }

  log.info("collecte terminée", { ...summary, subrequestsLeft: budget.remaining });
  return summary;
}

export interface SyncProgress {
  archived: number;
  /** Vrai lorsque le curseur est rejoint sans épuisement du budget : inutile de relancer. */
  done: boolean;
}

/**
 * Synchronisation manuelle d'un créateur actif, avec un budget neuf. La galerie rappelle cette
 * fonction tant que done est faux : chaque appel reprend au curseur laissé par le précédent.
 */
export async function syncCreator(env: Env, creatorId: string): Promise<SyncProgress> {
  const creator = await getCreator(env.DB, creatorId);
  if (!creator || creator.state === "purging") throw new HttpError(404, "Créateur introuvable");
  if (creator.state === "deleted") throw new HttpError(409, "Restaurez d'abord ce créateur depuis la corbeille");
  if (creator.state !== "active") throw new HttpError(409, "La synchronisation est désactivée pour ce créateur : réactivez-la d'abord");

  const config = readConfig(env);
  const budget = new Budget(config.maxSubrequestsPerRun, config.maxQueriesPerRun);
  const db = countingDb(env.DB, budget);
  const connector = createConnectors({ env, config, budget })[creator.platform];
  const now = new Date().toISOString();
  const tally = { archived: 0 };

  try {
    const { archived, reachedCursor } = await collectCreator(env, db, budget, config, connector, creator, now, tally);
    return { archived, done: reachedCursor };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) {
      await recordRun(env.DB, creator.id, { now, success: false, error: null });
      return { archived: tally.archived, done: false };
    }
    await recordRun(env.DB, creator.id, { now, success: false, error: errorMessage(e) });
    if (e instanceof RateLimitError) throw new HttpError(429, `Quota atteint, réessayez dans ${e.resetSeconds} s`);
    if (e instanceof NotFoundError) throw new HttpError(404, e.message);
    if (e instanceof PlatformError) throw new HttpError(502, e.message);
    throw e;
  }
}
