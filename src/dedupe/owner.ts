import { log } from "../lib/log";
import { isObject } from "../lib/json";
import { keyInUseElsewhere } from "../storage/db";
import { mediaKey, postJsonKey, thumbKey } from "../storage/keys";
import { putJson } from "../storage/r2";

/**
 * Première occurrence (exigence 9.12, reprise de L10.14 de memento-local, commit 4da3d16) : dans un groupe de médias
 * identiques ou quasi identiques, la fiche **publiée la première** garde le média ; les autres y sont reliées. Le
 * fichier, lui, ne change pas : c'est celui que le ménage a retenu (le meilleur des quasi-doublons, 9.11). Il est
 * seulement recopié sous la fiche la plus ancienne, pour que la suppression d'une fiche plus récente ne l'emporte pas.
 */

/** Une référence de média : publication et position. */
interface Ref {
  postId: string;
  position: number;
}

interface ModelRow {
  post_id: string;
  position: number;
  published_at: string;
  post_no: number;
  prefix: string;
  dup_post: string | null;
  dup_position: number | null;
  has_file: number;
}

const ref = (post: string, position: number) => `${post}#${position}`;
type Dated = { published_at: string; post_no: number; position: number };
/** Ordre de la première occurrence : date de publication, puis numéro de fiche, puis position. */
const earlier = (a: Dated, b: Dated) => a.published_at.localeCompare(b.published_at) || a.post_no - b.post_no || a.position - b.position;

/** Une publication dont tous les médias sont des doublons, une fois les liens du plan posés et les groupes réorientés. */
export interface RedundantPost {
  id: string;
  prefix: string;
}

/**
 * Simulation de l'état final : groupes après les liens du plan (et les doublons de ces médias, qui suivent leur
 * original), puis réorientation vers la fiche la plus ancienne. Rend les fiches à supprimer et le nombre de groupes
 * qui changeraient de fiche. Une requête D1.
 */
export async function planOwnership(
  db: D1Database,
  creatorId: string,
  links: { duplicate: Ref; original: Ref }[],
): Promise<{ redundant: RedundantPost[]; moves: number }> {
  const { results: rows } = await db
    .prepare(
      `SELECT m.post_id, m.position, p.published_at, p.rowid AS post_no, p.r2_prefix AS prefix,
              m.duplicate_post_id AS dup_post, m.duplicate_position AS dup_position, (m.r2_key IS NOT NULL) AS has_file
         FROM media m JOIN posts p ON p.id = m.post_id
        WHERE p.creator_id = ? AND p.status = 'active'
        ORDER BY p.rowid, m.position`,
    )
    .bind(creatorId)
    .all<ModelRow>();

  const target = new Map<string, string | null>(rows.map((r) => [ref(r.post_id, r.position), r.dup_post === null ? null : ref(r.dup_post, r.dup_position ?? 0)]));
  for (const link of links) {
    const self = ref(link.duplicate.postId, link.duplicate.position);
    const original = ref(link.original.postId, link.original.position);
    for (const [k, v] of target) if (v === self) target.set(k, original);
    target.set(self, original);
  }
  const root = (k: string): string => {
    let current = k;
    for (let i = 0; i < 4; i++) {
      const next = target.get(current);
      if (!next) return current;
      current = next;
    }
    return current;
  };

  const byRef = new Map(rows.map((r) => [ref(r.post_id, r.position), r]));
  const groups = new Map<string, ModelRow[]>();
  for (const r of rows) {
    const k = root(ref(r.post_id, r.position));
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const owners = new Set<string>();
  let moves = 0;
  for (const [rootRef, members] of groups) {
    const owner = [...members].sort(earlier)[0];
    if (!owner) continue;
    const ownerRef = ref(owner.post_id, owner.position);
    owners.add(ownerRef);
    if (members.length > 1 && ownerRef !== rootRef && byRef.get(rootRef)?.has_file) moves++;
  }
  const posts = new Map<string, { prefix: string; all: boolean }>();
  for (const r of rows) {
    const k = ref(r.post_id, r.position);
    const grouped = (groups.get(root(k))?.length ?? 0) > 1;
    const entry = posts.get(r.post_id) ?? { prefix: r.prefix, all: true };
    if (!grouped || owners.has(k)) entry.all = false;
    posts.set(r.post_id, entry);
  }
  return { redundant: [...posts].filter(([, v]) => v.all).map(([id, v]) => ({ id, prefix: v.prefix })), moves };
}

interface GroupRow {
  post_id: string;
  position: number;
  published_at: string;
  post_no: number;
  prefix: string;
  r2_key: string | null;
  thumb_r2_key: string | null;
  fingerprint: string | null;
}

const extOf = (key: string) => /\.([^./]+)$/.exec(key)?.[1] ?? "jpg";

async function copy(bucket: R2Bucket, from: string, to: string): Promise<boolean> {
  const src = await bucket.get(from);
  if (!src) return false;
  await bucket.put(to, src.body, { httpMetadata: src.httpMetadata });
  return true;
}

async function rewriteJson(bucket: R2Bucket, row: GroupRow, values: Record<string, unknown>): Promise<void> {
  const key = postJsonKey(row.prefix);
  const file = await bucket.get(key);
  if (!file) return;
  const saved: unknown = await file.json();
  if (!isObject(saved) || !Array.isArray(saved["media"])) return;
  const entry: unknown = (saved["media"] as unknown[])[row.position];
  if (!isObject(entry)) return;
  Object.assign(entry, values);
  await putJson(bucket, key, saved);
}

/**
 * Budget D1 de la réorientation, par appel : un groupe coûte environ cinq requêtes plus une par membre ; on s'arrête
 * avant de dépasser cette réserve (le plan de l'appel en a déjà consommé quelques-unes).
 */
const REASSIGN_QUERY_BUDGET = 35;

const SELECT = `SELECT m.post_id, m.position, p.published_at, p.rowid AS post_no, p.r2_prefix AS prefix, m.r2_key, m.thumb_r2_key, m.fingerprint
                  FROM media m JOIN posts p ON p.id = m.post_id`;

/** Originaux qui ont des doublons dont au moins un est publié avant eux : les groupes à réorienter. Une requête D1. */
async function rootsToMove(env: Env, creatorId: string): Promise<GroupRow[]> {
  const { results } = await env.DB
    .prepare(
      `${SELECT} WHERE p.creator_id = ? AND p.status = 'active' AND m.duplicate_post_id IS NULL AND m.r2_key IS NOT NULL
         AND EXISTS (SELECT 1 FROM media d JOIN posts q ON q.id = d.post_id
                     WHERE d.duplicate_post_id = m.post_id AND d.duplicate_position = m.position AND q.status = 'active'
                       AND (q.published_at < p.published_at OR (q.published_at = p.published_at AND q.rowid < p.rowid)
                            OR (q.published_at = p.published_at AND q.rowid = p.rowid AND d.position < m.position)))
       ORDER BY p.rowid, m.position`,
    )
    .bind(creatorId)
    .all<GroupRow>();
  return results;
}

/**
 * Donne des groupes à leur fiche la plus ancienne, dans la limite du budget D1 de l'appel. Pour chaque groupe : copie
 * des fichiers sous la fiche la plus ancienne (sans écraser un fichier existant), post.json, base, puis suppression des
 * anciens fichiers devenus inutiles. Rend le nombre de groupes déplacés et le nombre qui reste.
 */
export async function reassignBatch(env: Env, creatorId: string): Promise<{ moved: number; remaining: number }> {
  const roots = await rootsToMove(env, creatorId);
  let moved = 0;
  let spent = 0;
  for (const rootRow of roots) {
    const { results: members } = await env.DB
      .prepare(`${SELECT} WHERE m.duplicate_post_id = ? AND m.duplicate_position = ? AND p.status = 'active'`)
      .bind(rootRow.post_id, rootRow.position)
      .all<GroupRow>();
    const cost = 5 + members.length;
    if (moved > 0 && spent + cost > REASSIGN_QUERY_BUDGET) break;
    spent += cost + 1;

    const owner = [...members].sort(earlier)[0];
    if (!owner || earlier(owner, rootRow) >= 0 || !rootRow.r2_key) continue;
    const rootKey = rootRow.r2_key;

    // Nouvelles clés sous la fiche la plus ancienne, sans écraser un fichier existant.
    let slot = owner.position;
    const keysAt = (s: number) => ({
      media: mediaKey(owner.prefix, s, extOf(rootKey)),
      thumb: rootRow.thumb_r2_key ? thumbKey(owner.prefix, s, extOf(rootRow.thumb_r2_key)) : null,
    });
    for (let i = 0; i < 5; i++) {
      const k = keysAt(slot);
      if (!(await env.MEDIA.head(k.media)) && !(k.thumb && (await env.MEDIA.head(k.thumb)))) break;
      slot += 100;
    }
    const keys = keysAt(slot);
    if (!(await copy(env.MEDIA, rootKey, keys.media))) continue;
    if (rootRow.thumb_r2_key && keys.thumb && !(await copy(env.MEDIA, rootRow.thumb_r2_key, keys.thumb))) keys.thumb = null;

    // post.json d'abord, puis la base, puis les anciens fichiers.
    const link = { postId: owner.post_id, position: owner.position };
    for (const row of [rootRow, ...members]) {
      await rewriteJson(env.MEDIA, row, { r2Key: keys.media, thumbR2Key: keys.thumb, duplicateOf: row === owner ? null : link });
    }
    const statements = [
      env.DB
        .prepare("UPDATE media SET r2_key = ?, thumb_r2_key = ?, duplicate_post_id = NULL, duplicate_position = NULL, fingerprint = ? WHERE post_id = ? AND position = ?")
        .bind(keys.media, keys.thumb, rootRow.fingerprint, owner.post_id, owner.position),
      ...[rootRow, ...members.filter((m) => m !== owner)].map((row) =>
        env.DB
          .prepare("UPDATE media SET r2_key = ?, thumb_r2_key = ?, duplicate_post_id = ?, duplicate_position = ?, fingerprint = NULL WHERE post_id = ? AND position = ?")
          .bind(keys.media, keys.thumb, owner.post_id, owner.position, row.post_id, row.position),
      ),
    ];
    await env.DB.batch(statements);
    const old = [rootKey, rootRow.thumb_r2_key].filter((k): k is string => k !== null && k !== keys.media && k !== keys.thumb);
    const unused: string[] = [];
    for (const key of old) if (!(await keyInUseElsewhere(env.DB, key, ""))) unused.push(key);
    if (unused.length > 0) await env.MEDIA.delete(unused);

    log.info("doublon réorienté vers la première occurrence", { original: `${owner.post_id}#${owner.position}`, avant: `${rootRow.post_id}#${rootRow.position}` });
    moved++;
  }
  return { moved, remaining: Math.max(0, roots.length - moved) };
}
