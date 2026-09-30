import { HttpError } from "../lib/errors";
import { isObject, type JsonObject } from "../lib/json";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** Lit un corps JSON borné. Exige application/json (protège contre les envois de formulaires intersites). */
export async function readBody(request: Request, maxBytes = 16 * 1024): Promise<JsonObject> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new HttpError(415, "Corps JSON attendu (Content-Type: application/json)");
  const length = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (length > maxBytes) throw new HttpError(413, "Corps de requête trop volumineux");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Corps de requête trop volumineux");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON invalide");
  }
  if (!isObject(parsed)) throw new HttpError(400, "Objet JSON attendu");
  return parsed;
}

export function encodeCursor(publishedAt: string, id: string): string {
  return btoa(JSON.stringify([publishedAt, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(raw: string | null): { publishedAt: string; id: string } | undefined {
  if (!raw) return undefined;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const value: unknown = JSON.parse(atob(b64));
    if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string") {
      return { publishedAt: value[0], id: value[1] };
    }
  } catch {
    // curseur invalide : ignoré ci-dessous
  }
  throw new HttpError(400, "Curseur de pagination invalide");
}

/** "AAAA-MM-JJ" → début de journée UTC (ISO). endOfDay = début du jour suivant. */
export function parseDay(raw: string | null, endOfDay = false): string | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpError(400, `Date invalide : ${raw} (format AAAA-MM-JJ)`);
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Date invalide : ${raw}`);
  if (endOfDay) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}
