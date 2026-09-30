/** Quota d'une plateforme atteint : on arrête d'appeler cette plateforme pour l'exécution en cours. */
export class RateLimitError extends Error {
  override name = "RateLimitError";
  constructor(readonly platform: string, readonly resetSeconds: number) {
    super(`Quota atteint pour ${platform}, réinitialisation dans ${resetSeconds} s`);
  }
}

/** Ressource introuvable sur la plateforme (créateur supprimé, publication absente). */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** Réponse inattendue d'une plateforme (statut HTTP, format). */
export class PlatformError extends Error {
  override name = "PlatformError";
  constructor(readonly platform: string, message: string, readonly status?: number) {
    super(`${platform} : ${message}`);
  }
}

/** Le budget de sous-requêtes de l'invocation est épuisé. */
export class BudgetExhaustedError extends Error {
  override name = "BudgetExhaustedError";
  constructor() {
    super("Budget de sous-requêtes épuisé pour cette exécution");
  }
}

/** Erreur destinée au client de l'API, avec un statut HTTP. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
