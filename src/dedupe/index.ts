import { log } from "../lib/log";
import { isObject, type JsonObject } from "../lib/json";
import {
  dedupeCandidates,
  discardPosts,
  dependentsOf,
  getMedia,
  keyInUseElsewhere,
  linkMedia,
  unlinkMedia,
  type DedupeCandidate,
  type MediaRow,
  type OriginalOf,
} from "../storage/db";
import { postJsonKey } from "../storage/keys";
import { putJson } from "../storage/r2";
import { readConfig } from "../lib/config";
import { planOwnership, reassignBatch, type RedundantPost } from "./owner";
import { purgePosts } from "../purge";
import {
  CONFIRM_MAX_BITS,
  CONFIRM_MAX_PIXEL_DIFF,
  distance,
  fingerprintOf,
  fromHex,
  pixelCount,
  pixelDifference,
  pixelSampleOf,
  sameAspect,
  toHex,
  type Fingerprint,
  type PixelSample,
} from "./fingerprint";
import { mimeFromKey } from "./similar";

/**
 * Médias identiques (exigence 9) : relogement des doublons avant un effacement, rattrapage des doublons déjà
 * archivés, et ménage par créateur. Les copies identiques se reconnaissent par l'adresse ou l'empreinte MD5 et la
 * taille ; les quasi-doublons (exigence 9.11), par empreinte visuelle, calculée par la liaison Cloudflare Images.
 */

type Link = { postId: string; position: number };

/** Réécrit les médias donnés dans le post.json d'une publication (clés, mesures, lien). */
async function patchPostJson(
  bucket: R2Bucket,
  prefix: string,
  changes: { position: number; original: OriginalOf | null; r2Key?: string | null; thumbR2Key?: string | null }[],
): Promise<void> {
  const key = postJsonKey(prefix);
  const file = await bucket.get(key);
  if (!file) return;
  const data: unknown = await file.json();
  if (!isObject(data) || !Array.isArray(data["media"])) return;
  const media = data["media"] as unknown[];
  for (const c of changes) {
    const m = media[c.position];
    if (!isObject(m)) continue;
    const o: JsonObject = m;
    if (c.original) {
      Object.assign(o, {
        r2Key: c.original.r2_key,
        thumbR2Key: c.original.thumb_r2_key,
        mimeType: c.original.mime_type,
        bytes: c.original.bytes,
        etag: c.original.etag,
        width: c.original.width,
        height: c.original.height,
        thumbWidth: c.original.thumb_width,
        thumbHeight: c.original.thumb_height,
        downloaded: true,
        duplicateOf: { postId: c.original.post_id, position: c.original.position },
      });
    } else {
      o["duplicateOf"] = null;
      if (c.r2Key !== undefined) o["r2Key"] = c.r2Key;
      if (c.thumbR2Key !== undefined) o["thumbR2Key"] = c.thumbR2Key;
    }
  }
  await putJson(bucket, key, data);
}

async function copyObject(bucket: R2Bucket, from: string, to: string): Promise<boolean> {
  const src = await bucket.get(from);
  if (!src) return false;
  await bucket.put(to, src.body, { httpMetadata: src.httpMetadata });
  return true;
}

/** Clé d'un fichier recopié sous le préfixe d'une autre publication, même nom de fichier. */
const rehomedKey = (prefix: string, key: string): string => `${prefix}${key.slice(key.lastIndexOf("/") + 1)}`;

/**
 * Avant d'effacer des publications : leurs médias peuvent servir d'original à des doublons d'autres
 * publications. Pour chaque original concerné, le premier doublon reçoit une copie des fichiers sous son
 * propre préfixe et devient l'original ; les autres doublons lui sont reliés (exigence 9.5).
 */
export async function rehomeDependents(env: Env, postIds: string[]): Promise<void> {
  const dependents = await dependentsOf(env.DB, postIds);
  if (dependents.length === 0) return;

  const groups = new Map<string, typeof dependents>();
  for (const d of dependents) {
    const k = `${d.duplicate_post_id}#${d.duplicate_position}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }

  for (const group of groups.values()) {
    const [heir, ...others] = group;
    if (!heir?.duplicate_post_id || heir.duplicate_position === null) continue;
    const original = await getMedia(env.DB, heir.duplicate_post_id, heir.duplicate_position);
    const heirPost = await env.DB.prepare("SELECT r2_prefix FROM posts WHERE id = ?").bind(heir.post_id).first<{ r2_prefix: string }>();
    if (!original?.r2_key || !heirPost) {
      await unlinkMedia(env.DB, group);
      continue;
    }
    const r2Key = rehomedKey(heirPost.r2_prefix, original.r2_key);
    if (!(await copyObject(env.MEDIA, original.r2_key, r2Key))) {
      await unlinkMedia(env.DB, group);
      continue;
    }
    const thumbR2Key = original.thumb_r2_key ? rehomedKey(heirPost.r2_prefix, original.thumb_r2_key) : null;
    if (original.thumb_r2_key && thumbR2Key) await copyObject(env.MEDIA, original.thumb_r2_key, thumbR2Key);

    await env.DB
      .prepare("UPDATE media SET r2_key = ?, thumb_r2_key = ?, duplicate_post_id = NULL, duplicate_position = NULL WHERE post_id = ? AND position = ?")
      .bind(r2Key, thumbR2Key, heir.post_id, heir.position)
      .run();
    await patchPostJson(env.MEDIA, heirPost.r2_prefix, [{ position: heir.position, original: null, r2Key, thumbR2Key }]);

    const newOriginal: OriginalOf = { ...original, post_id: heir.post_id, position: heir.position, r2_key: r2Key, thumb_r2_key: thumbR2Key };
    for (const o of others) {
      await linkMedia(env.DB, o.post_id, o.position, newOriginal);
      const p = await env.DB.prepare("SELECT r2_prefix FROM posts WHERE id = ?").bind(o.post_id).first<{ r2_prefix: string }>();
      if (p) await patchPostJson(env.MEDIA, p.r2_prefix, [{ position: o.position, original: newOriginal }]);
    }
    log.info("doublons relogés avant effacement", { original: `${original.post_id}#${original.position}`, heir: `${heir.post_id}#${heir.position}`, others: others.length });
  }
}

// ---------- Rattrapage (exigence 9.9) ----------

export interface DuplicateLink {
  creatorId: string;
  duplicate: Link;
  original: Link;
  bytes: number;
  /** « contenu » : mêmes octets ; « visuel » : même image, encodage différent (exigence 9.11). */
  reason: "contenu" | "visuel";
  /** Bits d'écart entre les empreintes (0 pour le contenu). */
  distance: number;
}

/**
 * Plan du rattrapage : au sein de chaque créateur, les médias de même genre, même empreinte et même taille
 * sont reliés au premier archivé dont le fichier existe dans R2. Jamais de chaîne : on ne relie qu'à un original.
 */
export async function planDuplicates(env: Env, creatorId?: string): Promise<DuplicateLink[]> {
  const candidates = await dedupeCandidates(env.DB, creatorId);
  const originals = new Map<string, DedupeCandidate>();
  const links: DuplicateLink[] = [];
  for (const c of candidates) {
    const k = `${c.creator_id}|${c.kind}|${c.etag}|${c.bytes}`;
    const original = originals.get(k);
    if (!original) {
      const head = await env.MEDIA.head(c.r2_key);
      if (head && head.size === c.bytes) originals.set(k, c);
      continue;
    }
    links.push({
      creatorId: c.creator_id,
      duplicate: { postId: c.post_id, position: c.position },
      original: { postId: original.post_id, position: original.position },
      bytes: c.bytes,
      reason: "contenu",
      distance: 0,
    });
  }
  return links;
}

/**
 * Doublons reliés par appel. Un lien coûte jusqu'à huit requêtes D1 (deux lectures de médias, le préfixe, la mise à
 * jour, les doublons déjà reliés au média, deux vérifications de fichiers), plus une par doublon déjà relié qui
 * change d'original : 4 liens tiennent sous les 50 requêtes du plan gratuit, plan compris.
 */
export const DEDUPE_BATCH = 4;

/**
 * Relie un média à son original, dans cet ordre : post.json, ligne D1, doublons qui lui étaient déjà reliés (ils
 * passent à l'original, pour ne jamais créer de chaîne), puis suppression des anciens fichiers qui ne servent plus à
 * aucune ligne. Une interruption laisse au pire un fichier orphelin ou un doublon non relié : le plan suivant reprend.
 */
async function applyLink(env: Env, link: DuplicateLink): Promise<boolean> {
  const original = await getMedia(env.DB, link.original.postId, link.original.position);
  const old = await getMedia(env.DB, link.duplicate.postId, link.duplicate.position);
  const post = await env.DB.prepare("SELECT r2_prefix FROM posts WHERE id = ?").bind(link.duplicate.postId).first<{ r2_prefix: string }>();
  if (!original?.r2_key || original.duplicate_post_id || !old || !post) return false;

  await patchPostJson(env.MEDIA, post.r2_prefix, [{ position: link.duplicate.position, original }]);
  await linkMedia(env.DB, link.duplicate.postId, link.duplicate.position, original);

  const { results: dependents } = await env.DB
    .prepare(
      `SELECT m.post_id, m.position, p.r2_prefix FROM media m JOIN posts p ON p.id = m.post_id
       WHERE m.duplicate_post_id = ? AND m.duplicate_position = ?`,
    )
    .bind(link.duplicate.postId, link.duplicate.position)
    .all<{ post_id: string; position: number; r2_prefix: string }>();
  for (const d of dependents) {
    await patchPostJson(env.MEDIA, d.r2_prefix, [{ position: d.position, original }]);
    await linkMedia(env.DB, d.post_id, d.position, original);
  }

  const obsolete: string[] = [];
  for (const key of [old.r2_key, old.thumb_r2_key]) {
    if (key && key !== original.r2_key && key !== original.thumb_r2_key && !(await keyInUseElsewhere(env.DB, key, link.duplicate.postId))) {
      obsolete.push(key);
    }
  }
  if (obsolete.length > 0) await env.MEDIA.delete(obsolete);
  log.info("média identique relié (ménage)", {
    post: link.duplicate.postId,
    position: link.duplicate.position,
    original: `${link.original.postId}#${link.original.position}`,
    par: link.reason,
    ecart: link.distance,
    relies: dependents.length,
  });
  return true;
}

/** Relie un média pendant la maintenance planifiée (même règle que le ménage). */
export const applyLinkForMaintenance = (env: Env, link: DuplicateLink): Promise<boolean> => applyLink(env, link);

export interface DedupeProgress {
  /** Doublons trouvés (avant ce lot). */
  found: number;
  /** Octets que libère le rattrapage complet. */
  bytes: number;
  linked: number;
  remaining: number;
  examples: DuplicateLink[];
}

/**
 * Un appel du rattrapage par le contenu, tous créateurs confondus (`POST /api/admin/dedupe`). Sans `apply`, simule :
 * rien n'est écrit. Avec `apply`, relie au plus DEDUPE_BATCH doublons (le plan est recalculé à chaque appel).
 */
export async function dedupeBatch(env: Env, opts: { apply: boolean; creatorId?: string }): Promise<DedupeProgress> {
  const plan = await planDuplicates(env, opts.creatorId);
  const progress: DedupeProgress = {
    found: plan.length,
    bytes: plan.reduce((n, l) => n + l.bytes, 0),
    linked: 0,
    remaining: plan.length,
    examples: plan.slice(0, 10),
  };
  if (!opts.apply) return progress;
  for (const link of plan.slice(0, DEDUPE_BATCH)) if (await applyLink(env, link)) progress.linked++;
  progress.remaining = plan.length - progress.linked;
  return progress;
}

// ---------- Quasi-doublons d'un créateur (exigence 9.11) ----------

/** Empreintes calculées par appel : chacune coûte une lecture R2, une transformation Images et une requête D1. */
export const FINGERPRINT_BATCH = 15;
/** Seconds regards par plan : chacun coûte au plus deux transformations Images. */
export const MAX_PLAN_CONFIRMATIONS = 30;

/**
 * Calcule et conserve les empreintes manquantes d'un créateur, par lot ; renvoie le nombre qui reste. Image : empreinte
 * du fichier ; vidéo : empreinte de sa miniature (9.18), chaîne vide si elle n'en a pas.
 */
export async function fingerprintBatch(env: Env, creatorId: string, limit = FINGERPRINT_BATCH): Promise<{ computed: number; remaining: number }> {
  const missing = `FROM media m JOIN posts p ON p.id = m.post_id
     WHERE p.creator_id = ? AND m.kind IN ('image', 'video') AND m.downloaded = 1 AND m.r2_key IS NOT NULL
       AND m.duplicate_post_id IS NULL AND m.fingerprint IS NULL`;
  const { results } = await env.DB
    .prepare(`SELECT m.post_id, m.position, m.kind, m.r2_key, m.thumb_r2_key, m.mime_type, m.bytes ${missing} LIMIT ?`)
    .bind(creatorId, limit)
    .all<{ post_id: string; position: number; kind: string; r2_key: string; thumb_r2_key: string | null; mime_type: string | null; bytes: number | null }>();
  for (const row of results) {
    const video = row.kind === "video";
    const key = video ? row.thumb_r2_key : row.r2_key;
    const print = key
      ? await fingerprintOf({ images: env.IMAGES, bucket: env.MEDIA, key, mimeType: video ? mimeFromKey(key) : row.mime_type, bytes: video ? null : row.bytes })
      : null;
    await env.DB
      .prepare("UPDATE media SET fingerprint = ? WHERE post_id = ? AND position = ?")
      .bind(print ? toHex(print) : "", row.post_id, row.position)
      .run();
  }
  if (results.length < limit) return { computed: results.length, remaining: 0 };
  const left = await env.DB.prepare(`SELECT COUNT(*) AS n ${missing}`).bind(creatorId).first<{ n: number }>();
  return { computed: results.length, remaining: left?.n ?? 0 };
}

type Candidate = Pick<MediaRow, "post_id" | "position" | "kind" | "r2_key" | "thumb_r2_key" | "etag" | "bytes" | "mime_type" | "width" | "height" | "fingerprint">;

/**
 * Plan complet d'un créateur (exigences 9.9 et 9.11).
 * 1. Même contenu : le premier archivé dont le fichier existe est l'original.
 * 2. Même image, autre encodage : parmi les originaux restants, la meilleure image de chaque groupe (le plus de pixels,
 *    puis d'octets, puis la plus ancienne) devient l'original. Une image est reliée si l'écart d'empreinte est d'au plus
 *    `threshold` bits, ou d'au plus CONFIRM_MAX_BITS et que le second regard pixel à pixel le confirme. Chaque image
 *    n'est comparée qu'aux originaux de groupe : jamais de chaîne.
 * Une requête D1, une opération R2 par groupe de copies, et les seconds regards (liaison Images).
 */
export async function planCreatorDuplicates(env: Env, creatorId: string, threshold: number): Promise<DuplicateLink[]> {
  const { results: rows } = await env.DB
    .prepare(
      `SELECT m.post_id, m.position, m.kind, m.r2_key, m.thumb_r2_key, m.etag, m.bytes, m.mime_type, m.width, m.height, m.fingerprint
       FROM media m JOIN posts p ON p.id = m.post_id
       WHERE p.creator_id = ? AND m.downloaded = 1 AND m.r2_key IS NOT NULL AND m.duplicate_post_id IS NULL
       ORDER BY p.rowid, m.position`,
    )
    .bind(creatorId)
    .all<Candidate>();
  const linkOf = (c: Candidate, o: Candidate, reason: DuplicateLink["reason"], bits: number): DuplicateLink => ({
    creatorId,
    duplicate: { postId: c.post_id, position: c.position },
    original: { postId: o.post_id, position: o.position },
    bytes: c.bytes ?? 0,
    reason,
    distance: bits,
  });

  // 1. Même contenu. Le fichier d'un original n'est vérifié que s'il a des copies.
  const groups = new Map<string, Candidate[]>();
  for (const r of rows) {
    const k = r.etag !== null && r.bytes !== null ? `${r.kind}|${r.etag}|${r.bytes}` : `seul|${r.post_id}|${r.position}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const unique: Candidate[] = [];
  const exact: { link: DuplicateLink; of: Candidate }[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      unique.push(g[0]!);
      continue;
    }
    let head: Candidate | undefined;
    for (const c of g) {
      if (!head) {
        const stored = c.r2_key ? await env.MEDIA.head(c.r2_key) : null;
        if (stored && stored.size === c.bytes) {
          head = c;
          unique.push(c);
        }
        continue;
      }
      exact.push({ link: linkOf(c, head, "contenu", 0), of: head });
    }
  }

  // 2. Même image, autre encodage.
  const visual: DuplicateLink[] = [];
  if (threshold > 0 && env.IMAGES) {
    const prints = new Map<Candidate, Fingerprint>();
    for (const c of unique) {
      const print = c.kind === "image" || c.kind === "video" ? fromHex(c.fingerprint) : null;
      if (print) prints.set(c, print);
    }
    const order = (c: Candidate) => rows.indexOf(c);
    const ranked = [...prints.keys()].sort((a, b) => pixelCount(b) - pixelCount(a) || (b.bytes ?? 0) - (a.bytes ?? 0) || order(a) - order(b));
    const samples = new Map<Candidate, PixelSample | null>();
    let confirmations = 0;
    const sampleOf = async (c: Candidate) => {
      if (!samples.has(c)) {
        // Une vidéo se compare par sa miniature (9.18).
        const key = (c.kind === "video" ? c.thumb_r2_key : c.r2_key) ?? "";
        const video = c.kind === "video";
        samples.set(c, await pixelSampleOf({ images: env.IMAGES, bucket: env.MEDIA, key, mimeType: video ? mimeFromKey(key) : c.mime_type, bytes: video ? null : c.bytes }));
      }
      return samples.get(c) ?? null;
    };
    const confirmed = async (a: Candidate, b: Candidate) => {
      if (confirmations >= MAX_PLAN_CONFIRMATIONS) return false;
      confirmations++;
      const x = await sampleOf(a);
      const y = x ? await sampleOf(b) : null;
      return !!x && !!y && pixelDifference(x, y) <= CONFIRM_MAX_PIXEL_DIFF;
    };
    const heads: Candidate[] = [];
    for (const c of ranked) {
      const print = prints.get(c);
      if (!print) continue;
      const near: { head: Candidate; bits: number }[] = [];
      for (const h of heads) {
        const other = prints.get(h);
        if (other && h.kind === c.kind && sameAspect(c, h)) near.push({ head: h, bits: distance(print, other) });
      }
      near.sort((a, b) => a.bits - b.bits);
      let match: { head: Candidate; bits: number } | null = null;
      for (const n of near) {
        // Vidéo : écart d'au plus le seuil et second regard toujours exigé (9.18).
        if (n.bits > (c.kind === "video" ? threshold : CONFIRM_MAX_BITS)) break;
        if ((c.kind === "image" && n.bits <= threshold) || (await confirmed(c, n.head))) {
          match = n;
          break;
        }
      }
      if (match) {
        const head = match.head;
        visual.push(linkOf(c, head, "visuel", match.bits));
        // Les copies exactes de c rejoignent l'original du groupe.
        for (const e of exact) if (e.of === c) e.link.original = { postId: head.post_id, position: head.position };
      } else {
        heads.push(c);
      }
    }
  }
  return [...exact.map((e) => e.link), ...visual];
}


// ---------- Ménage d'un créateur depuis la page Créateurs (exigence 9.10) ----------

export { planOwnership, reassignBatch, type RedundantPost } from "./owner";

/** Fiches supprimées par appel : chacune coûte une liste R2, une vérification par fichier et environ cinq requêtes D1. */
export const REDUNDANT_BATCH = 3;

/** Supprime ces fiches (fichiers propres, index, publication). Une fiche dont un fichier sert encore à une autre est laissée. */
export async function deleteRedundantPosts(env: Env, posts: RedundantPost[], creatorId?: string): Promise<{ deleted: number; kept: number }> {
  const safe: RedundantPost[] = [];
  for (const post of posts) {
    const own = (await env.MEDIA.list({ prefix: post.prefix, limit: 100 })).objects.map((o) => o.key);
    let shared = false;
    for (const key of own) if (!key.endsWith("post.json") && (await keyInUseElsewhere(env.DB, key, post.id))) shared = true;
    if (shared) log.warn("fiche en double conservée : un de ses fichiers sert à une autre fiche", { post: post.id });
    else safe.push(post);
  }
  // Les médias d'une fiche superflue sont tous des doublons : aucun autre média n'en dépend, pas de relogement.
  // Retenues d'abord : une collecte qui les retrouverait ne les archivera plus (exigence 9.13).
  if (creatorId) await discardPosts(env.DB, creatorId, safe.map((p) => p.id), new Date().toISOString());
  await purgePosts(env, safe.map((p) => ({ id: p.id, r2_prefix: p.prefix })), { rehome: false });
  for (const post of safe) log.info("fiche en double supprimée", { post: post.id });
  return { deleted: safe.length, kept: posts.length - safe.length };
}

export interface CreatorDedupe {
  /** Empreintes visuelles encore à calculer avant de pouvoir chiffrer le plan (la galerie rappelle en attendant). */
  pendingFingerprints: number;
  /** Médias encore à relier à un original. */
  count: number;
  /** Dont quasi-doublons (même image, autre encodage). */
  visualCount: number;
  freeableBytes: number;
  /** Groupes dont le média passera à la fiche publiée la première (exigence 9.12). */
  moves: number;
  /** Fiches dont tous les médias sont (ou seront) des doublons. */
  postCount: number;
  linked: number;
  reassigned: number;
  deletedPosts: number;
  /** Vrai quand il ne reste rien à faire : la galerie arrête alors ses appels. */
  done: boolean;
}

/**
 * Ménage des doublons d'un créateur, par lots (exigences 9.10 à 9.12). Chaque appel, simulation comprise, calcule
 * d'abord au plus FINGERPRINT_BATCH empreintes manquantes : tant qu'il en reste, il ne renvoie que leur nombre. Puis,
 * sans `apply`, il chiffre le plan ; avec `apply`, il fait une étape à la fois, dans cet ordre : relier au plus
 * DEDUPE_BATCH médias ; donner des groupes à leur fiche publiée la première ; supprimer au plus REDUNDANT_BATCH fiches
 * entièrement en double. La galerie rappelle jusqu'à la fin.
 */
export async function dedupeCreator(env: Env, creatorId: string, apply: boolean): Promise<CreatorDedupe> {
  const threshold = readConfig(env).visualDedupeThreshold;
  const out: CreatorDedupe = {
    pendingFingerprints: 0, count: 0, visualCount: 0, freeableBytes: 0, moves: 0, postCount: 0, linked: 0, reassigned: 0, deletedPosts: 0, done: false,
  };

  if (threshold > 0 && env.IMAGES) {
    const prints = await fingerprintBatch(env, creatorId);
    if (prints.remaining > 0) {
      out.pendingFingerprints = prints.remaining;
      return out;
    }
  }

  const plan = await planCreatorDuplicates(env, creatorId, threshold);
  const { redundant, moves } = await planOwnership(env.DB, creatorId, plan);
  out.count = plan.length;
  out.visualCount = plan.filter((l) => l.reason === "visuel").length;
  out.freeableBytes = plan.reduce((n, l) => n + l.bytes, 0);
  out.moves = moves;
  out.postCount = redundant.length;
  out.done = plan.length === 0 && moves === 0 && redundant.length === 0;
  if (!apply || out.done) return out;

  if (plan.length > 0) {
    for (const link of plan.slice(0, DEDUPE_BATCH)) if (await applyLink(env, link)) out.linked++;
    // Rien relié alors qu'il en restait : on s'arrête plutôt que de boucler.
    out.done = out.linked === 0;
  } else if (moves > 0 && (out.reassigned = (await reassignBatch(env, creatorId)).moved) > 0) {
    // Un lot de groupes a changé de fiche : l'appel suivant reprendra (réorientation, puis suppression).
  } else {
    // Plus rien à réorienter (ou un groupe impossible à déplacer) : les fiches entièrement en double partent.
    const r = await deleteRedundantPosts(env, redundant.slice(0, REDUNDANT_BATCH), creatorId);
    out.deletedPosts = r.deleted;
    out.done = redundant.length <= REDUNDANT_BATCH || r.deleted === 0;
  }
  log.info("ménage des doublons", { creator: creatorId, relies: out.linked, reorientes: out.reassigned, fiches: out.deletedPosts });
  return out;
}
