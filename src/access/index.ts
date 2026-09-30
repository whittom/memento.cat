import type { Config } from "../lib/config";
import { HttpError } from "../lib/errors";
import { arr, num, obj, str, type Json } from "../lib/json";

/**
 * Vérifie le jeton Cloudflare Access (JWT RS256) présent sur chaque requête.
 * Défense en profondeur : même si le Worker est joint par une route non protégée,
 * aucune donnée n'est servie sans jeton valide.
 */
export type KeyFinder = (teamDomain: string, kid: string | undefined) => Promise<JsonWebKey | undefined>;

export async function assertAccess(request: Request, config: Config, keyFinder: KeyFinder = findKey): Promise<void> {
  if (!config.requireAccess) return;
  if (!config.accessTeamDomain || !config.accessAud) {
    throw new HttpError(500, "Contrôle d'accès actif mais ACCESS_TEAM_DOMAIN ou ACCESS_AUD non configurés");
  }
  const token = request.headers.get("cf-access-jwt-assertion") ?? readCookie(request, "CF_Authorization");
  if (!token) throw new HttpError(403, "Accès réservé : connectez-vous via Cloudflare Access");

  const parts = token.split(".");
  const [h, p, s] = parts;
  if (parts.length !== 3 || !h || !p || !s) throw new HttpError(403, "Jeton d'accès mal formé");

  const header = obj(decodeJson(h));
  const payload = obj(decodeJson(p));
  if (str(header?.["alg"]) !== "RS256" || !payload) throw new HttpError(403, "Jeton d'accès non pris en charge");

  const jwk = await keyFinder(config.accessTeamDomain, str(header?.["kid"]));
  if (!jwk) throw new HttpError(403, "Clé de signature inconnue");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) throw new HttpError(403, "Signature du jeton invalide");

  const aud = payload["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.accessAud)) throw new HttpError(403, "Jeton destiné à une autre application");
  const exp = num(payload["exp"]);
  if (exp === undefined || exp * 1000 < Date.now()) throw new HttpError(403, "Jeton expiré");
  if (str(payload["iss"]) !== `https://${config.accessTeamDomain}`) throw new HttpError(403, "Émetteur du jeton inattendu");
}

async function findKey(teamDomain: string, kid: string | undefined): Promise<JsonWebKey | undefined> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const cache = caches.default;
  let res = await cache.match(url);
  if (!res) {
    const fresh = await fetch(url);
    if (!fresh.ok) throw new HttpError(503, "Clés Cloudflare Access indisponibles");
    res = new Response(fresh.body, fresh);
    res.headers.set("cache-control", "max-age=3600");
    await cache.put(url, res.clone());
  }
  const keys = arr(obj((await res.json()))?.["keys"]);
  const match = keys.map((k) => obj(k)).find((k) => str(k?.["kid"]) === kid);
  return match as JsonWebKey | undefined;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function base64UrlBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodeJson(input: string): Json | undefined {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(input))) as Json;
  } catch {
    return undefined;
  }
}
