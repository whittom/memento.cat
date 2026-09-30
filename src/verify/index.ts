import { createConnectors } from "../connectors";
import { Budget } from "../lib/budget";
import { readConfig } from "../lib/config";
import { HttpError } from "../lib/errors";
import { countToVerify, getCreator, postsToVerify, recordChecks } from "../storage/db";

export interface VerifyProgress {
  startedAt: string;
  processed: number;
  deleted: number;
  remaining: number;
}

const BATCH = 25;

/**
 * Vérifie un lot de publications d'un créateur. Déclenché uniquement à la demande :
 * la galerie rappelle cette fonction avec le même startedAt jusqu'à remaining = 0.
 */
export async function verifyBatch(env: Env, creatorId: string, startedAt: string | null): Promise<VerifyProgress> {
  const creator = await getCreator(env.DB, creatorId);
  if (!creator || creator.state === "purging") throw new HttpError(404, "Créateur introuvable");

  const config = readConfig(env);
  const budget = new Budget(config.maxSubrequestsPerRun);
  const connector = createConnectors({ env, config, budget })[creator.platform];
  const session = startedAt ?? new Date().toISOString();

  const posts = await postsToVerify(env.DB, creatorId, session, BATCH);
  let deleted = 0;
  for (let i = 0; i < posts.length; i += connector.checkBatchSize) {
    const chunk = posts.slice(i, i + connector.checkBatchSize);
    const states = await connector.checkStates(chunk.map((p) => p.native_ref));
    const checks = chunk.map((p) => ({ id: p.id, deleted: states.get(p.native_ref) === "deleted" }));
    deleted += checks.filter((c) => c.deleted).length;
    await recordChecks(env.DB, checks, new Date().toISOString());
  }

  return { startedAt: session, processed: posts.length, deleted, remaining: await countToVerify(env.DB, creatorId, session) };
}
