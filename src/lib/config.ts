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
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  };
}
