import { RateLimitError } from "../lib/errors";

/**
 * Lit les en-têtes de quota d'une réponse et lève RateLimitError sous le seuil.
 * Reddit : X-Ratelimit-Remaining / X-Ratelimit-Reset (secondes).
 * Mastodon : X-RateLimit-Remaining / X-RateLimit-Reset (horodatage ISO 8601).
 * Bluesky : RateLimit-Remaining / RateLimit-Reset (horodatage epoch en secondes).
 */
export function checkRateLimit(platform: string, res: Response, floor: number): void {
  if (res.status === 429) {
    throw new RateLimitError(platform, resetSeconds(res) ?? 60);
  }
  const remaining = headerNumber(res, "x-ratelimit-remaining") ?? headerNumber(res, "ratelimit-remaining");
  if (remaining !== undefined && remaining < floor) {
    throw new RateLimitError(platform, resetSeconds(res) ?? 60);
  }
}

function headerNumber(res: Response, name: string): number | undefined {
  const raw = res.headers.get(name);
  if (raw === null) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function resetSeconds(res: Response): number | undefined {
  const raw = res.headers.get("x-ratelimit-reset")?.trim();
  if (raw) {
    // Reddit : un nombre de secondes. Mastodon : un horodatage ISO 8601.
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.ceil(Number.parseFloat(raw));
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const bsky = headerNumber(res, "ratelimit-reset");
  if (bsky !== undefined) return Math.max(0, Math.ceil(bsky - Date.now() / 1000));
  const retry = headerNumber(res, "retry-after");
  return retry !== undefined ? Math.ceil(retry) : undefined;
}
