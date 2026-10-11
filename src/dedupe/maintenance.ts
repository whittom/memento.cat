import { readConfig } from "../lib/config";
import { errorMessage } from "../lib/errors";
import { log } from "../lib/log";
import { DEDUPE_BATCH, applyLinkForMaintenance, fingerprintBatch, planCreatorDuplicates } from "./index";
import { planOwnership, reassignBatch } from "./owner";

/**
 * Maintenance planifiée des doublons (exigences 9.15 et 9.17), sur son propre déclencheur Cron : chaque invocation a
 * ses propres limites (50 requêtes D1), indépendantes de la collecte. Un créateur à la fois, du moins récemment
 * vérifié au plus récemment ; une seule étape par invocation :
 * 1. calculer un petit lot d'empreintes manquantes (l'archive existante) ;
 * 2. sinon, relier quelques doublons ;
 * 3. sinon, donner des groupes à leur fiche publiée la première ;
 * 4. sinon, noter le créateur comme vérifié, pour passer au suivant.
 * Elle ne supprime jamais de fiche : la suppression reste au bouton « Supprimer les doublons… » (9.17).
 */

/** Déclencheur Cron de la maintenance (distinct de celui de la collecte, toutes les 15 minutes). */
export const MAINTENANCE_CRON = "7,37 * * * *";

/** Empreintes par invocation : chacune est une transformation Images (quota mensuel partagé avec les miniatures). */
export const MAINTENANCE_FINGERPRINTS = 10;

export interface MaintenanceStep {
  creator: string | null;
  step: "désactivée" | "aucun créateur" | "empreintes" | "liens" | "réorientation" | "vérifié";
  count: number;
}

export async function runMaintenance(env: Env, now = new Date().toISOString()): Promise<MaintenanceStep> {
  const config = readConfig(env);
  if (!config.autoDedupe || config.visualDedupeThreshold === 0 || !env.IMAGES) {
    return { creator: null, step: "désactivée", count: 0 };
  }
  const creator = await env.DB
    .prepare(
      `SELECT id FROM creators WHERE state IN ('active', 'paused')
       ORDER BY dedupe_checked_at IS NOT NULL, dedupe_checked_at, id LIMIT 1`,
    )
    .first<{ id: string }>();
  if (!creator) return { creator: null, step: "aucun créateur", count: 0 };
  const id = creator.id;

  try {
    const prints = await fingerprintBatch(env, id, MAINTENANCE_FINGERPRINTS);
    if (prints.computed > 0) return done({ creator: id, step: "empreintes", count: prints.computed });

    const plan = await planCreatorDuplicates(env, id, config.visualDedupeThreshold);
    if (plan.length > 0) {
      let linked = 0;
      for (const link of plan.slice(0, DEDUPE_BATCH)) if (await applyLinkForMaintenance(env, link)) linked++;
      if (linked > 0) return done({ creator: id, step: "liens", count: linked });
    }

    const { moves } = await planOwnership(env.DB, id, []);
    if (moves > 0) {
      const r = await reassignBatch(env, id, 30);
      if (r.moved > 0) return done({ creator: id, step: "réorientation", count: r.moved });
    }

    await env.DB.prepare("UPDATE creators SET dedupe_checked_at = ? WHERE id = ?").bind(now, id).run();
    return done({ creator: id, step: "vérifié", count: 0 });
  } catch (e) {
    // Une erreur ne doit pas bloquer la rotation : le créateur est noté vérifié et sera repris au tour suivant.
    log.error("maintenance des doublons interrompue", { creator: id, error: errorMessage(e) });
    await env.DB.prepare("UPDATE creators SET dedupe_checked_at = ? WHERE id = ?").bind(now, id).run();
    return { creator: id, step: "vérifié", count: 0 };
  }
}

function done(step: MaintenanceStep): MaintenanceStep {
  log.info("maintenance des doublons", { ...step });
  return step;
}
