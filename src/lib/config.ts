export interface Config {
  requireAccess: boolean;
  accessTeamDomain: string;
  accessAud: string;
  maxSubrequestsPerRun: number;
  maxQueriesPerRun: number;
  maxPagesPerCreator: number;
  maxMediaBytes: number;
  rateLimitFloor: number;
  redditUserAgent: string;
  /** User-Agent envoyé aux serveurs Mastodon : il identifie l'installation auprès de leurs administrateurs. */
  mastodonUserAgent: string;
  /** Écart d'empreinte maximal (bits sur 256) pour relier un quasi-doublon ; 0 désactive la reconnaissance visuelle. */
  visualDedupeThreshold: number;
  /** Maintenance planifiée des doublons (empreintes, liens, réorientation ; jamais de suppression). */
  autoDedupe: boolean;
  /** Modèle image-texte de Hugging Face pour la description par IA (exigence 11). */
  hfVisionModel: string;
}

/** Modèle par défaut de la description par IA : vision-langage, servi par DeepInfra via le routeur Hugging Face (moins coûteux que le précédent). */
export const DEFAULT_HF_VISION_MODEL = "google/gemma-4-26B-A4B-it:deepinfra";

/** Valeur neutre : chaque installation devrait la remplacer par un nom qui la désigne (MASTODON_USER_AGENT). */
export const DEFAULT_MASTODON_USER_AGENT = "memento (archive personnelle en lecture seule)";

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Seuil des quasi-doublons : 6 par défaut (calibré sur l'archive de memento-local), 0 désactive, 32 au plus. */
function threshold(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 32) : 6;
}

/** Lit la configuration à partir des variables d'environnement, avec des valeurs par défaut sûres. */
export function readConfig(env: Env): Config {
  return {
    requireAccess: (env.REQUIRE_ACCESS ?? "true") !== "false",
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN ?? "",
    accessAud: env.ACCESS_AUD ?? "",
    maxSubrequestsPerRun: int(env.MAX_SUBREQUESTS_PER_RUN, 45),
    maxQueriesPerRun: int(env.MAX_QUERIES_PER_RUN, 40),
    maxPagesPerCreator: int(env.MAX_PAGES_PER_CREATOR, 3),
    maxMediaBytes: int(env.MAX_MEDIA_BYTES, 100 * 1024 * 1024),
    rateLimitFloor: int(env.RATE_LIMIT_FLOOR, 10),
    redditUserAgent: env.REDDIT_USER_AGENT ?? "",
    mastodonUserAgent: env.MASTODON_USER_AGENT || DEFAULT_MASTODON_USER_AGENT,
    visualDedupeThreshold: threshold(env.VISUAL_DEDUPE_THRESHOLD),
    autoDedupe: (env.AUTO_DEDUPE ?? "true") !== "false",
    hfVisionModel: env.HF_VISION_MODEL?.trim() || DEFAULT_HF_VISION_MODEL,
  };
}
