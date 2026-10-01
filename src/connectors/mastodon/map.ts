import { arr, num, obj, str, type Json } from "../../lib/json";
import type { NormalizedMedia, NormalizedPost } from "../types";

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".test", ".invalid", ".example"];

/**
 * Vrai pour un nom d'hôte public plausible : étiquettes DNS valides, au moins un point, extension
 * non numérique (écarte les adresses IP) et pas de suffixe réservé. Pas de port ni de chemin.
 */
export function isPublicHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host !== host.toLowerCase()) return false;
  if (host.startsWith("[") || host.includes(":") || host.includes("/") || host.includes("@")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  if (/^\d+$/.test(labels.at(-1) ?? "")) return false;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return true;
}

/** Accepte `nom@serveur`, `@nom@serveur`, `https://serveur/@nom` et `https://serveur/users/nom`. */
export function parseHandle(input: string): { user: string; host: string } | undefined {
  let text = input.trim();
  let user: string | undefined;
  let host: string | undefined;

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      host = url.hostname.toLowerCase();
      const m = /^\/(?:@|users\/)([^/@]+)/.exec(url.pathname);
      user = m?.[1];
    } catch {
      return undefined;
    }
  } else {
    text = text.replace(/^@/, "");
    const at = text.lastIndexOf("@");
    if (at > 0) {
      user = text.slice(0, at);
      host = text.slice(at + 1).toLowerCase();
    }
  }

  if (!user || !host || !/^[\w.-]{1,100}$/.test(user) || !isPublicHostname(host)) return undefined;
  return { user, host };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Convertit le HTML d'un message Mastodon en texte brut (paragraphes et retours à la ligne conservés). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<span class="invisible">[\s\S]*?<\/span>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

function dimension(meta: Json | undefined, key: "width" | "height"): number | null {
  return num(obj(meta)?.[key]) ?? null;
}

/** Pièces jointes prises en charge : image, vidéo et gifv (boucle sans son, traitée comme GIF). */
export function mapAttachments(attachments: Json | undefined): NormalizedMedia[] {
  return arr(attachments).flatMap((a): NormalizedMedia[] => {
    const att = obj(a);
    const type = str(att?.["type"]);
    const url = str(att?.["url"]);
    if (!att || !url) return [];
    const kind = type === "image" ? "image" : type === "video" ? "video" : type === "gifv" ? "gif" : undefined;
    if (!kind) return [];
    const meta = obj(att["meta"]);
    const original = obj(meta?.["original"]);
    const small = obj(meta?.["small"]);
    const description = str(att["description"])?.trim();
    return [{
      kind,
      sourceUrl: url,
      thumbUrl: str(att["preview_url"]) ?? null,
      width: dimension(original, "width"),
      height: dimension(original, "height"),
      thumbWidth: dimension(small, "width"),
      thumbHeight: dimension(small, "height"),
      description: description ? description : null,
    }];
  });
}

/**
 * Convertit un message de GET /api/v1/accounts/:id/statuses en publication normalisée.
 * Renvoie null pour les republications, les messages d'un autre compte et les messages non publics.
 */
export function mapStatus(status: Json, host: string, accountId: string): NormalizedPost | null {
  const s = obj(status);
  if (!s) return null;
  if (s["reblog"] !== null && s["reblog"] !== undefined) return null;
  const visibility = str(s["visibility"]);
  if (visibility === "private" || visibility === "direct") return null;
  if (str(obj(s["account"])?.["id"]) !== accountId) return null;

  const id = str(s["id"]);
  const created = str(s["created_at"]);
  const at = created ? Date.parse(created) : Number.NaN;
  if (!id || !/^\d+$/.test(id) || !Number.isFinite(at)) return null;

  const warning = str(s["spoiler_text"])?.trim();
  return {
    id: `mastodon:${host}:${id}`,
    platform: "mastodon",
    creatorId: `mastodon:${host}:${accountId}`,
    nativeRef: `https://${host}/api/v1/statuses/${id}`,
    nativeId: id,
    publishedAt: new Date(at).toISOString(),
    title: warning ? warning : null,
    text: htmlToText(str(s["content"]) ?? ""),
    sourceUrl: str(s["url"]) ?? str(s["uri"]) ?? `https://${host}/web/statuses/${id}`,
    media: mapAttachments(s["media_attachments"]),
  };
}
