import { readConfig } from "../lib/config";
import { HttpError } from "../lib/errors";
import { arr, isObject, obj, str } from "../lib/json";
import { log } from "../lib/log";
import { postJsonKey } from "../storage/keys";
import { putJson } from "../storage/r2";

/**
 * Description d'un média par IA, à la demande (exigence 11). L'image, réduite à 1024 px au plus en JPEG par la liaison
 * Cloudflare Images, est envoyée à un modèle image-texte hébergé par Hugging Face (Inference Providers, API compatible
 * OpenAI). La description est conservée dans un champ séparé du texte alternatif du créateur, et indexée.
 */

export const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const MAX_SIDE = 1024;
/** Taille maximale de l'image envoyée quand elle ne peut pas être réduite (pas de liaison Images). */
const MAX_RAW_BYTES = 4 * 1024 * 1024;
const MAX_CHARS = 2000;

export const PROMPT =
  "Décris cette image en français, en deux à quatre phrases factuelles : le sujet, le lieu ou le décor, les couleurs et la lumière, " +
  "et tout texte visible. N'invente rien de ce qui n'est pas visible. Réponds par la description seule, sans préambule.";

export interface AiDescription {
  text: string;
  model: string;
  at: string;
}

interface Target {
  post_id: string;
  position: number;
  kind: string;
  r2_key: string | null;
  thumb_r2_key: string | null;
  mime_type: string | null;
  bytes: number | null;
  ai_description: string | null;
  ai_description_model: string | null;
  ai_description_at: string | null;
  r2_prefix: string;
}

/** Nettoie la réponse du modèle : raisonnement `<think>` retiré, espaces superflus, longueur bornée. */
export function cleanDescription(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").replace(/\s+/g, " ").trim();
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1).trimEnd()}…` : text;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** L'image à envoyer, en adresse `data:` : réduite et en JPEG par la liaison Images, sinon telle quelle si elle est petite. */
async function imageDataUrl(env: Env, key: string, mimeType: string | null): Promise<string> {
  const source = await env.MEDIA.get(key);
  if (!source) throw new HttpError(404, "Fichier du média introuvable");
  if (env.IMAGES) {
    try {
      const result = await env.IMAGES
        .input(source.body as ReadableStream<Uint8Array>)
        .transform({ width: MAX_SIDE, height: MAX_SIDE, fit: "scale-down" })
        .output({ format: "image/jpeg", quality: 80 });
      return `data:image/jpeg;base64,${toBase64(new Uint8Array(await result.response().arrayBuffer()))}`;
    } catch (e) {
      log.warn("réduction impossible avant description, envoi de l'image d'origine", { key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const again = await env.MEDIA.get(key);
  if (!again || again.size > MAX_RAW_BYTES) throw new HttpError(413, "Image trop volumineuse pour être décrite sans réduction");
  return `data:${mimeType ?? "image/jpeg"};base64,${toBase64(new Uint8Array(await again.arrayBuffer()))}`;
}

/** Fournisseurs essayés au plus, l'un après l'autre, quand le routeur refuse la requête sans en choisir un bon. */
const MAX_PROVIDERS = 4;

/** Résultat d'un appel : la description, ou le refus et sa raison. */
type Attempt = { ok: true; text: string } | { ok: false; status: number; detail: string };

/** En-têtes qui portent la raison d'un refus du routeur ou du fournisseur (aucun ne contient le jeton). */
const ERROR_HEADERS = ["x-error-message", "x-error-code", "x-error-type", "x-inference-provider"];

/** Un appel au routeur pour un modèle (éventuellement suffixé `:fournisseur`). */
async function callModel(token: string, model: string, dataUrl: string): Promise<Attempt> {
  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: dataUrl } }] }],
    }),
  });
  if (res.status === 401 || res.status === 403) throw new HttpError(502, "Jeton Hugging Face refusé : vérifiez HF_TOKEN et sa permission « Inference Providers »");
  if (res.status === 402) throw new HttpError(502, "Crédits Hugging Face épuisés pour ce mois");
  if (res.status === 429) throw new HttpError(429, "Quota Hugging Face atteint, réessayez plus tard");
  if (!res.ok) {
    // La raison donnée par Hugging Face ou le fournisseur, dans le corps ou dans les en-têtes.
    const fromBody = providerError(await res.text().catch(() => ""));
    const fromHeaders = ERROR_HEADERS.map((h) => (res.headers.get(h) ? `${h}: ${res.headers.get(h)}` : null)).filter(Boolean).join(" ; ");
    const detail = [fromBody, fromHeaders].filter(Boolean).join(" ; ");
    log.warn("description refusée par le modèle", { model, status: res.status, detail, headers: [...res.headers.keys()].join(",") });
    return { ok: false, status: res.status, detail };
  }
  const body: unknown = await res.json().catch(() => null);
  const message = obj(obj(arr(obj(isObject(body) ? body : null)?.["choices"])[0])?.["message"]);
  const content = message?.["content"];
  const text = typeof content === "string" ? content : arr(content).map((part) => str(obj(part)?.["text"]) ?? "").join(" ");
  const cleaned = cleanDescription(text);
  if (!cleaned) return { ok: false, status: 200, detail: "description vide" };
  return { ok: true, text: cleaned };
}

/**
 * Fournisseurs en service pour un modèle, d'après l'API publique de Hugging Face (`inferenceProviderMapping`, objet ou
 * liste selon la version), tâche conversationnelle seulement. Liste vide si l'API ne répond pas.
 */
export async function liveProviders(model: string): Promise<string[]> {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${model}?expand[]=inferenceProviderMapping`);
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const mapping = isObject(body) ? body["inferenceProviderMapping"] : undefined;
    const entries: { provider: string; status?: string; task?: string }[] = Array.isArray(mapping)
      ? mapping.map((m) => ({ provider: str(obj(m)?.["provider"]) ?? "", status: str(obj(m)?.["status"]), task: str(obj(m)?.["task"]) }))
      : isObject(mapping)
        ? Object.entries(mapping).map(([provider, m]) => ({ provider, status: str(obj(m)?.["status"]), task: str(obj(m)?.["task"]) }))
        : [];
    return entries.filter((e) => e.provider && e.status !== "error" && e.status !== "staging" && (!e.task || e.task === "conversational")).map((e) => e.provider);
  } catch {
    return [];
  }
}

/**
 * Appelle le modèle ; traduit ses erreurs en messages explicites (exigence 11.6). Si le routeur refuse la requête (400,
 * 404, 422) et que le modèle n'impose pas de fournisseur (`modèle:fournisseur`), essaie les fournisseurs en service l'un
 * après l'autre. Rend la description et le modèle effectivement utilisé.
 */
async function askModel(env: Env, model: string, dataUrl: string): Promise<{ text: string; model: string }> {
  const token = env.HF_TOKEN;
  if (!token) throw new HttpError(503, "Description par IA non configurée : ajoutez le secret HF_TOKEN au Worker");

  const first = await callModel(token, model, dataUrl);
  if (first.ok) return { text: first.text, model };
  const failures = [`${model} : HTTP ${first.status}${first.detail ? ` (${first.detail})` : ""}`];

  const retryable = [400, 404, 422].includes(first.status) && !model.includes(":");
  if (retryable) {
    for (const provider of (await liveProviders(model)).slice(0, MAX_PROVIDERS)) {
      const named = `${model}:${provider}`;
      const attempt = await callModel(token, named, dataUrl);
      if (attempt.ok) {
        log.info("description obtenue avec un fournisseur imposé", { model: named });
        return { text: attempt.text, model: named };
      }
      failures.push(`${provider} : HTTP ${attempt.status}${attempt.detail ? ` (${attempt.detail})` : ""}`);
    }
  }
  const summary = failures.join(" ; ");
  throw new HttpError(502, `Le modèle a refusé la requête. ${summary.length > 600 ? `${summary.slice(0, 599)}…` : summary}`);
}


/** Message d'erreur d'une réponse du routeur Hugging Face (`{ error: "…" }` ou `{ error: { message } }`), borné à 300 caractères. */
export function providerError(body: string): string {
  let message = body;
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isObject(parsed) ? parsed["error"] : undefined;
    message = typeof error === "string" ? error : (str(obj(isObject(error) ? error : null)?.["message"]) ?? body);
  } catch {
    // corps non JSON : gardé tel quel
  }
  const text = message.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/** La description conservée d'un média, ou null. */
const stored = (t: Target): AiDescription | null =>
  t.ai_description && t.ai_description_model && t.ai_description_at ? { text: t.ai_description, model: t.ai_description_model, at: t.ai_description_at } : null;

/**
 * Décrit un média et conserve la description (post.json, base, index de recherche). Sans `regenerate`, une description
 * déjà conservée est rendue telle quelle, sans appel au modèle.
 */
export async function describeMedia(env: Env, postId: string, position: number, regenerate: boolean, now = new Date().toISOString()): Promise<AiDescription> {
  const target = await env.DB
    .prepare(
      `SELECT m.post_id, m.position, m.kind, m.r2_key, m.thumb_r2_key, m.mime_type, m.bytes,
              m.ai_description, m.ai_description_model, m.ai_description_at, p.r2_prefix
       FROM media m JOIN posts p ON p.id = m.post_id JOIN creators c ON c.id = p.creator_id
       WHERE m.post_id = ? AND m.position = ? AND c.state IN ('active', 'paused')`,
    )
    .bind(postId, position)
    .first<Target>();
  if (!target) throw new HttpError(404, "Média introuvable");
  const kept = stored(target);
  if (kept && !regenerate) return kept;

  // Une vidéo se décrit par sa miniature (11.5) ; une image, par son fichier (ou sa miniature s'il n'a pas été téléchargé).
  const key = target.kind === "video" ? target.thumb_r2_key : (target.r2_key ?? target.thumb_r2_key);
  if (!key) throw new HttpError(409, "Aucune image à décrire pour ce média");
  const mime = target.kind === "video" || !target.r2_key ? null : target.mime_type;

  const answer = await askModel(env, readConfig(env).hfVisionModel, await imageDataUrl(env, key, mime));
  const { text, model } = answer;
  const description: AiDescription = { text, model, at: now };

  // post.json d'abord (source de vérité), puis la base et l'index de recherche.
  const jsonKey = postJsonKey(target.r2_prefix);
  const file = await env.MEDIA.get(jsonKey);
  const saved: unknown = file ? await file.json() : null;
  if (isObject(saved) && Array.isArray(saved["media"])) {
    const entry: unknown = (saved["media"] as unknown[])[position];
    if (isObject(entry)) {
      entry["aiDescription"] = { ...description };
      await putJson(env.MEDIA, jsonKey, saved);
    }
  }
  await env.DB.batch([
    env.DB
      .prepare("UPDATE media SET ai_description = ?, ai_description_model = ?, ai_description_at = ? WHERE post_id = ? AND position = ?")
      .bind(text, model, now, postId, position),
    ...refreshSearchIndex(env.DB, postId),
  ]);
  log.info("média décrit par IA", { post: postId, position, model, caracteres: text.length });
  return description;
}

/** Réécrit l'entrée de recherche d'une publication, descriptions IA comprises (11.3). */
export function refreshSearchIndex(db: D1Database, postId: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM posts_fts WHERE post_id = ?").bind(postId),
    db
      .prepare(
        `INSERT INTO posts_fts (post_id, title, text, media_descriptions)
         SELECT p.id, COALESCE(p.title, ''), p.text,
                COALESCE((SELECT group_concat(COALESCE(m.description, '') || ' ' || COALESCE(m.ai_description, ''), char(10))
                          FROM media m WHERE m.post_id = p.id), '')
         FROM posts p WHERE p.id = ?`,
      )
      .bind(postId),
  ];
}
