import { createConnectors } from "../connectors";
import type { Platform } from "../connectors/types";
import { Budget, countingDb } from "../lib/budget";
import { readConfig } from "../lib/config";
import { BudgetExhaustedError, NotFoundError, RateLimitError, errorMessage } from "../lib/errors";
import { log } from "../lib/log";
import { advanceCursor, creatorsToCollect, postExists, recordRun } from "../storage/db";
import { archivePost, fetchesNeeded, queriesNeeded } from "./archive";

export interface CollectionSummary {
  creators: number;
  archived: number;
  stoppedEarly: boolean;
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

    try {
      const { posts, reachedCursor } = await connectors[creator.platform].fetchSince(creator, creator.cursor);
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
        summary.archived++;
      }
      await recordRun(env.DB, creator.id, { now, success: true, error: null });
    } catch (e) {
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
