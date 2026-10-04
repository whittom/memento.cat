import { log } from "../lib/log";
import { isObject, type JsonObject } from "../lib/json";
import {
  dedupeCandidates,
  dependentsOf,
  getMedia,
  keyInUseElsewhere,
  linkMedia,
  unlinkMedia,
  type DedupeCandidate,
  type OriginalOf,
} from "../storage/db";
import { postJsonKey } from "../storage/keys";
import { putJson } from "../storage/r2";

/**
 * Médias identiques (exigence 9) : relogement des doublons avant un effacement, et rattrapage des
 * doublons déjà archivés. Tout passe par les liaisons D1 et R2 du Worker : aucune sous-requête externe,
 * aucun décodage d'image (la reconnaissance est exacte : adresse, ou empreinte MD5 et taille).
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
    });
  }
  return links;
}

/** Doublons reliés par appel : chacun coûte environ quatre requêtes D1 et quatre opérations R2. */
export const DEDUPE_BATCH = 8;

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
 * Un appel du rattrapage. Sans `apply`, simule : rien n'est écrit. Avec `apply`, relie au plus DEDUPE_BATCH
 * doublons, dans cet ordre : post.json, ligne D1, puis suppression des anciens fichiers qui ne servent plus
 * à aucune ligne. Une interruption laisse au pire un fichier orphelin ou un doublon non relié : l'appel suivant
 * reprend (le plan est recalculé à chaque fois).
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

  for (const link of plan.slice(0, DEDUPE_BATCH)) {
    const original = await getMedia(env.DB, link.original.postId, link.original.position);
    const old = await getMedia(env.DB, link.duplicate.postId, link.duplicate.position);
    const post = await env.DB.prepare("SELECT r2_prefix FROM posts WHERE id = ?").bind(link.duplicate.postId).first<{ r2_prefix: string }>();
    if (!original?.r2_key || !old || !post) continue;

    await patchPostJson(env.MEDIA, post.r2_prefix, [{ position: link.duplicate.position, original }]);
    await linkMedia(env.DB, link.duplicate.postId, link.duplicate.position, original);
    const obsolete: string[] = [];
    for (const key of [old.r2_key, old.thumb_r2_key]) {
      if (key && key !== original.r2_key && key !== original.thumb_r2_key && !(await keyInUseElsewhere(env.DB, key, link.duplicate.postId))) {
        obsolete.push(key);
      }
    }
    if (obsolete.length > 0) await env.MEDIA.delete(obsolete);
    log.info("média identique relié (rattrapage)", { post: link.duplicate.postId, position: link.duplicate.position, original: `${link.original.postId}#${link.original.position}` });
    progress.linked++;
  }
  progress.remaining = plan.length - progress.linked;
  return progress;
}
