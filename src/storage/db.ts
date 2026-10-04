import type { NormalizedPost, Platform } from "../connectors/types";

/** Toutes les requêtes SQL du projet sont regroupées ici. */

export type CreatorState = "active" | "paused" | "deleted" | "purging";

export interface CreatorRow {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string | null;
  state: CreatorState;
  deleted_at: string | null;
  cursor: string | null;
  created_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export interface CreatorWithCounts extends CreatorRow {
  post_count: number;
  unviewed_count: number;
}

export interface PostRow {
  id: string;
  creator_id: string;
  native_ref: string;
  published_at: string;
  title: string | null;
  text: string;
  source_url: string;
  r2_prefix: string;
  status: "active" | "deleted";
  captured_at: string;
  deleted_seen_at: string | null;
  checked_at: string | null;
}

export interface PostListRow extends PostRow {
  platform: Platform;
  handle: string;
  display_name: string | null;
  media_count: number;
  unviewed_count: number;
  /** Nombre de médias liés à un original (doublons). */
  duplicate_count: number;
  /** Numéro d'inventaire : rowid de posts, croissant à l'archivage (renuméroté par une reconstruction d'index). */
  catalog_no: number;
}

export interface MediaRow {
  post_id: string;
  position: number;
  kind: "image" | "video" | "gif";
  mime_type: string | null;
  r2_key: string | null;
  etag: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  thumb_r2_key: string | null;
  thumb_width: number | null;
  thumb_height: number | null;
  description: string | null;
  source_url: string;
  downloaded: number;
  viewed_at: string | null;
  /** Média identique à un original du même créateur : publication et position de cet original (exigence 9). */
  duplicate_post_id: string | null;
  duplicate_position: number | null;
}

/** Ligne de média à insérer ; le lien vers un original est facultatif (nul par défaut). */
export type MediaInsert = Omit<MediaRow, "viewed_at" | "duplicate_post_id" | "duplicate_position"> &
  Partial<Pick<MediaRow, "duplicate_post_id" | "duplicate_position">>;

/** Médias non consultés qui comptent : téléchargés, et qui ne sont pas des doublons (exigence 9.7). */
const UNVIEWED = "m.viewed_at IS NULL AND m.downloaded = 1 AND m.duplicate_post_id IS NULL";

const VISIBLE = "c.state IN ('active', 'paused')";

// ---------- Créateurs ----------

export async function listCreators(db: D1Database): Promise<CreatorWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM posts p WHERE p.creator_id = c.id) AS post_count,
         (SELECT COUNT(*) FROM media m JOIN posts p ON p.id = m.post_id
            WHERE p.creator_id = c.id AND ${UNVIEWED}) AS unviewed_count
       FROM creators c
       ORDER BY c.handle COLLATE NOCASE`,
    )
    .all<CreatorWithCounts>();
  return results;
}

export async function getCreator(db: D1Database, id: string): Promise<CreatorRow | null> {
  return db.prepare("SELECT * FROM creators WHERE id = ?").bind(id).first<CreatorRow>();
}

export async function insertCreator(
  db: D1Database,
  c: { id: string; platform: Platform; handle: string; displayName: string | null },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO creators (id, platform, handle, display_name, state, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
    .bind(c.id, c.platform, c.handle, c.displayName, now)
    .run();
}

/**
 * Reconstruction de l'index : recrée un créateur absent à l'état « désactivé », et fait avancer son
 * curseur jusqu'à la plus récente publication archivée. Les post.json sont listés du plus ancien au plus
 * récent : sans cette mise à jour, le curseur resterait à la plus ancienne et une réactivation
 * relirait inutilement tout l'historique déjà archivé. Un curseur plus récent n'est jamais reculé.
 */
export async function upsertCreatorFromArchive(
  db: D1Database,
  c: { id: string; platform: Platform; handle: string; displayName: string | null; createdAt: string; cursor: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO creators (id, platform, handle, display_name, state, created_at, cursor)
       VALUES (?, ?, ?, ?, 'paused', ?, ?)
       ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor
       WHERE creators.cursor IS NULL OR excluded.cursor > creators.cursor`,
    )
    .bind(c.id, c.platform, c.handle, c.displayName, c.createdAt, c.cursor)
    .run();
}

export async function setCreatorState(
  db: D1Database,
  id: string,
  state: CreatorState,
  deletedAt: string | null,
): Promise<void> {
  await db.prepare("UPDATE creators SET state = ?, deleted_at = ? WHERE id = ?").bind(state, deletedAt, id).run();
}

/** Créateurs à collecter, les moins récemment traités d'abord (tourniquet). */
export async function creatorsToCollect(db: D1Database): Promise<CreatorRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM creators WHERE state = 'active' ORDER BY last_run_at IS NOT NULL, last_run_at")
    .all<CreatorRow>();
  return results;
}

export async function recordRun(
  db: D1Database,
  id: string,
  r: { now: string; cursor?: string | null; success: boolean; error: string | null },
): Promise<void> {
  if (r.cursor !== undefined) {
    await db.prepare("UPDATE creators SET cursor = ? WHERE id = ?").bind(r.cursor, id).run();
  }
  await db
    .prepare(
      `UPDATE creators SET last_run_at = ?, last_error = ?,
         last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END
       WHERE id = ?`,
    )
    .bind(r.now, r.error, r.success ? 1 : 0, r.now, id)
    .run();
}

export async function advanceCursor(db: D1Database, id: string, cursor: string): Promise<void> {
  await db
    .prepare("UPDATE creators SET cursor = ? WHERE id = ? AND (cursor IS NULL OR cursor < ?)")
    .bind(cursor, id, cursor)
    .run();
}

export async function creatorStats(
  db: D1Database,
  id: string,
): Promise<{ posts: number; media: number; bytes: number }> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE creator_id = ?1) AS posts,
         (SELECT COUNT(*) FROM media m JOIN posts p ON p.id = m.post_id WHERE p.creator_id = ?1) AS media,
         (SELECT COALESCE(SUM(m.bytes), 0) FROM media m JOIN posts p ON p.id = m.post_id WHERE p.creator_id = ?1 AND m.duplicate_post_id IS NULL) AS bytes`,
    )
    .bind(id)
    .first<{ posts: number; media: number; bytes: number }>();
  return row ?? { posts: 0, media: 0, bytes: 0 };
}

export async function deleteCreatorRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM creators WHERE id = ?").bind(id).run();
}

// ---------- Publications ----------

export async function postExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM posts WHERE id = ?").bind(id).first<{ x: number }>();
  return row !== null;
}

/** Insère une publication, ses médias et son entrée de recherche en une transaction. */
export async function insertPost(
  db: D1Database,
  post: NormalizedPost,
  prefix: string,
  media: MediaInsert[],
  capturedAt: string,
): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO posts
           (id, creator_id, native_ref, published_at, title, text, source_url, r2_prefix, status, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .bind(post.id, post.creatorId, post.nativeRef, post.publishedAt, post.title, post.text, post.sourceUrl, prefix, capturedAt),
    db.prepare("DELETE FROM posts_fts WHERE post_id = ?").bind(post.id),
    db
      .prepare("INSERT INTO posts_fts (post_id, title, text, media_descriptions) VALUES (?, ?, ?, ?)")
      .bind(post.id, post.title ?? "", post.text, media.map((m) => m.description ?? "").join("\n")),
    ...media.map((m) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO media
             (post_id, position, kind, mime_type, r2_key, etag, bytes, width, height,
              thumb_r2_key, thumb_width, thumb_height, description, source_url, downloaded,
              duplicate_post_id, duplicate_position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          m.post_id, m.position, m.kind, m.mime_type, m.r2_key, m.etag, m.bytes, m.width, m.height,
          m.thumb_r2_key, m.thumb_width, m.thumb_height, m.description, m.source_url, m.downloaded,
          m.duplicate_post_id ?? null, m.duplicate_position ?? null,
        ),
    ),
  ];
  await db.batch(statements);
}

export interface PostFilters {
  creator?: string;
  platform?: Platform;
  from?: string;
  to?: string;
  q?: string;
  status?: "active" | "deleted";
  unviewed?: boolean;
  /** Retire les publications dont tous les médias sont des doublons (exigence 9.6). */
  hideDuplicates?: boolean;
  cursor?: { publishedAt: string; id: string };
  limit: number;
}

/** Transforme une saisie libre en requête FTS5 sûre : chaque mot devient un préfixe entre guillemets. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  return terms.length > 0 ? terms.map((t) => `"${t}"*`).join(" ") : null;
}

export async function listPosts(db: D1Database, f: PostFilters): Promise<PostListRow[]> {
  const where: string[] = [VISIBLE];
  const params: unknown[] = [];
  if (f.creator) { where.push("p.creator_id = ?"); params.push(f.creator); }
  if (f.platform) { where.push("c.platform = ?"); params.push(f.platform); }
  if (f.from) { where.push("p.published_at >= ?"); params.push(f.from); }
  if (f.to) { where.push("p.published_at < ?"); params.push(f.to); }
  if (f.status) { where.push("p.status = ?"); params.push(f.status); }
  if (f.unviewed) {
    where.push(`EXISTS (SELECT 1 FROM media m WHERE m.post_id = p.id AND ${UNVIEWED})`);
  }
  if (f.hideDuplicates) {
    where.push(
      `(NOT EXISTS (SELECT 1 FROM media m WHERE m.post_id = p.id)
        OR EXISTS (SELECT 1 FROM media m WHERE m.post_id = p.id AND m.duplicate_post_id IS NULL))`,
    );
  }
  const fts = f.q ? toFtsQuery(f.q) : null;
  if (fts) { where.push("p.id IN (SELECT post_id FROM posts_fts WHERE posts_fts MATCH ?)"); params.push(fts); }
  if (f.cursor) {
    where.push("(p.published_at < ? OR (p.published_at = ? AND p.id < ?))");
    params.push(f.cursor.publishedAt, f.cursor.publishedAt, f.cursor.id);
  }
  params.push(f.limit);

  const { results } = await db
    .prepare(
      `SELECT p.*, p.rowid AS catalog_no, c.platform, c.handle, c.display_name,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id) AS media_count,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND ${UNVIEWED}) AS unviewed_count,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND m.duplicate_post_id IS NOT NULL) AS duplicate_count
       FROM posts p JOIN creators c ON c.id = p.creator_id
       WHERE ${where.join(" AND ")}
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<PostListRow>();
  return results;
}

export async function getVisiblePost(db: D1Database, id: string): Promise<PostListRow | null> {
  return db
    .prepare(
      `SELECT p.*, p.rowid AS catalog_no, c.platform, c.handle, c.display_name,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id) AS media_count,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND ${UNVIEWED}) AS unviewed_count,
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND m.duplicate_post_id IS NOT NULL) AS duplicate_count
       FROM posts p JOIN creators c ON c.id = p.creator_id
       WHERE p.id = ? AND ${VISIBLE}`,
    )
    .bind(id)
    .first<PostListRow>();
}

export async function mediaForPosts(db: D1Database, postIds: string[]): Promise<MediaRow[]> {
  if (postIds.length === 0) return [];
  const placeholders = postIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT * FROM media WHERE post_id IN (${placeholders}) ORDER BY post_id, position`)
    .bind(...postIds)
    .all<MediaRow>();
  return results;
}

/** Ce qui identifie un média pour la reconnaissance des doublons (exigence 9.1). */
export interface MediaProbe {
  kind: MediaRow["kind"];
  sourceUrl: string;
  /** Empreinte MD5 (calculée par R2) et taille du fichier téléchargé ; absentes avant le téléchargement. */
  etag?: string | null;
  bytes?: number | null;
}

/** Les champs d'un original que recopie un doublon : fichiers, mesures et lien. */
export type OriginalOf = Pick<
  MediaRow,
  "post_id" | "position" | "mime_type" | "r2_key" | "etag" | "bytes" | "width" | "height" | "thumb_r2_key" | "thumb_width" | "thumb_height"
>;

const isOriginal = (m: Pick<MediaInsert, "downloaded" | "r2_key" | "duplicate_post_id">) =>
  m.downloaded === 1 && m.r2_key !== null && (m.duplicate_post_id ?? null) === null;

/**
 * Original d'un média : un média déjà archivé **du même créateur**, téléchargé et qui n'est pas lui-même
 * un doublon, dont l'adresse source est la même, ou dont l'empreinte et la taille sont les mêmes
 * (exigence 9.1). `pending` : les lignes de la publication en cours, pas encore en base.
 * Au plus deux requêtes D1 (par adresse, puis par contenu).
 */
export async function findOriginal(
  db: D1Database,
  creatorId: string,
  probe: MediaProbe,
  pending: MediaInsert[] = [],
): Promise<OriginalOf | null> {
  const matches = (m: { kind: string; source_url: string; etag: string | null; bytes: number | null }) =>
    m.source_url === probe.sourceUrl || (probe.etag != null && m.etag === probe.etag && m.bytes === (probe.bytes ?? null) && m.kind === probe.kind);

  const local = pending.find((m) => isOriginal(m) && matches(m));
  if (local) return local;

  const columns = "m.post_id, m.position, m.mime_type, m.r2_key, m.etag, m.bytes, m.width, m.height, m.thumb_r2_key, m.thumb_width, m.thumb_height";
  const base = `SELECT ${columns} FROM media m JOIN posts p ON p.id = m.post_id
     WHERE p.creator_id = ? AND m.downloaded = 1 AND m.r2_key IS NOT NULL AND m.duplicate_post_id IS NULL`;
  const order = "ORDER BY p.rowid, m.position LIMIT 1";
  if (probe.etag == null || probe.bytes == null) {
    return db.prepare(`${base} AND m.source_url = ? ${order}`).bind(creatorId, probe.sourceUrl).first<OriginalOf>();
  }
  return db
    .prepare(`${base} AND m.etag = ? AND m.bytes = ? AND m.kind = ? ${order}`)
    .bind(creatorId, probe.etag, probe.bytes, probe.kind)
    .first<OriginalOf>();
}

/** Vrai si un média d'une autre publication se sert encore de ce fichier (média ou miniature). */
export async function keyInUseElsewhere(db: D1Database, key: string, postId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM media WHERE post_id != ?1 AND (r2_key = ?2 OR thumb_r2_key = ?2) LIMIT 1")
    .bind(postId, key)
    .first<{ x: number }>();
  return row !== null;
}

/** Médias d'autres publications liés aux publications données (ils perdraient leur original). */
export async function dependentsOf(db: D1Database, postIds: string[]): Promise<Pick<MediaRow, "post_id" | "position" | "duplicate_post_id" | "duplicate_position">[]> {
  if (postIds.length === 0) return [];
  const placeholders = postIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT post_id, position, duplicate_post_id, duplicate_position FROM media
       WHERE duplicate_post_id IN (${placeholders}) AND post_id NOT IN (${placeholders})`,
    )
    .bind(...postIds, ...postIds)
    .all<Pick<MediaRow, "post_id" | "position" | "duplicate_post_id" | "duplicate_position">>();
  return results;
}

/** Candidats au rattrapage : médias téléchargés, non liés, avec empreinte et taille, dans l'ordre d'archivage. */
export interface DedupeCandidate {
  creator_id: string;
  post_id: string;
  position: number;
  kind: MediaRow["kind"];
  r2_key: string;
  thumb_r2_key: string | null;
  r2_prefix: string;
  etag: string;
  bytes: number;
}

export async function dedupeCandidates(db: D1Database, creatorId?: string): Promise<DedupeCandidate[]> {
  const { results } = await db
    .prepare(
      `SELECT p.creator_id, m.post_id, m.position, m.kind, m.r2_key, m.thumb_r2_key, p.r2_prefix, m.etag, m.bytes
       FROM media m JOIN posts p ON p.id = m.post_id
       WHERE m.downloaded = 1 AND m.r2_key IS NOT NULL AND m.duplicate_post_id IS NULL
         AND m.etag IS NOT NULL AND m.bytes IS NOT NULL AND (?1 IS NULL OR p.creator_id = ?1)
         AND EXISTS (SELECT 1 FROM media m2 JOIN posts p2 ON p2.id = m2.post_id
                     WHERE p2.creator_id = p.creator_id AND m2.etag = m.etag AND m2.bytes = m.bytes AND m2.kind = m.kind
                       AND m2.downloaded = 1 AND m2.duplicate_post_id IS NULL
                       AND (m2.post_id != m.post_id OR m2.position != m.position))
       ORDER BY p.creator_id, p.rowid, m.position`,
    )
    .bind(creatorId ?? null)
    .all<DedupeCandidate>();
  return results;
}

/** Relie un média à son original : il recopie ses fichiers et ses mesures (consultation et légende conservées). */
export async function linkMedia(db: D1Database, postId: string, position: number, original: OriginalOf): Promise<void> {
  await db
    .prepare(
      `UPDATE media SET mime_type = ?, r2_key = ?, etag = ?, bytes = ?, width = ?, height = ?,
         thumb_r2_key = ?, thumb_width = ?, thumb_height = ?, downloaded = 1,
         duplicate_post_id = ?, duplicate_position = ?
       WHERE post_id = ? AND position = ?`,
    )
    .bind(
      original.mime_type, original.r2_key, original.etag, original.bytes, original.width, original.height,
      original.thumb_r2_key, original.thumb_width, original.thumb_height, original.post_id, original.position,
      postId, position,
    )
    .run();
}

/** Le média (fichiers et mesures) qui sert d'original. */
export async function getMedia(db: D1Database, postId: string, position: number): Promise<MediaRow | null> {
  return db.prepare("SELECT * FROM media WHERE post_id = ? AND position = ?").bind(postId, position).first<MediaRow>();
}

/** Retire le lien : le média garde les fichiers et devient un original (son original a été effacé). */
export async function unlinkMedia(db: D1Database, rows: Pick<MediaRow, "post_id" | "position">[]): Promise<void> {
  if (rows.length === 0) return;
  await db.batch(
    rows.map((r) =>
      db.prepare("UPDATE media SET duplicate_post_id = NULL, duplicate_position = NULL WHERE post_id = ? AND position = ?").bind(r.post_id, r.position),
    ),
  );
}

/** Vrai si la clé R2 appartient à une publication visible (un média masqué n'est pas servi). */
export async function isVisibleKey(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM media m JOIN posts p ON p.id = m.post_id JOIN creators c ON c.id = p.creator_id
       WHERE (m.r2_key = ?1 OR m.thumb_r2_key = ?1) AND ${VISIBLE} LIMIT 1`,
    )
    .bind(key)
    .first<{ x: number }>();
  return row !== null;
}

// ---------- Consultation ----------

export type ViewScope = "media" | "post" | "creator";

export async function setViewed(
  db: D1Database,
  scope: ViewScope,
  id: string,
  position: number | null,
  viewed: boolean,
  now: string,
): Promise<number> {
  const set = viewed ? "viewed_at = COALESCE(viewed_at, ?)" : "viewed_at = NULL";
  const setParams = viewed ? [now] : [];
  let stmt: D1PreparedStatement;
  if (scope === "media") {
    stmt = db.prepare(`UPDATE media SET ${set} WHERE post_id = ? AND position = ?`).bind(...setParams, id, position ?? -1);
  } else if (scope === "post") {
    stmt = db.prepare(`UPDATE media SET ${set} WHERE post_id = ?`).bind(...setParams, id);
  } else {
    stmt = db
      .prepare(`UPDATE media SET ${set} WHERE post_id IN (SELECT id FROM posts WHERE creator_id = ?)`)
      .bind(...setParams, id);
  }
  const res = await stmt.run();
  return res.meta.changes;
}

// ---------- Vérification des suppressions ----------

export async function postsToVerify(
  db: D1Database,
  creatorId: string,
  startedAt: string,
  limit: number,
): Promise<Pick<PostRow, "id" | "native_ref" | "r2_prefix">[]> {
  const { results } = await db
    .prepare(
      `SELECT id, native_ref, r2_prefix FROM posts
       WHERE creator_id = ? AND status = 'active' AND (checked_at IS NULL OR checked_at < ?)
       ORDER BY checked_at IS NOT NULL, checked_at
       LIMIT ?`,
    )
    .bind(creatorId, startedAt, limit)
    .all<Pick<PostRow, "id" | "native_ref" | "r2_prefix">>();
  return results;
}

export async function countToVerify(db: D1Database, creatorId: string, startedAt: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM posts
       WHERE creator_id = ? AND status = 'active' AND (checked_at IS NULL OR checked_at < ?)`,
    )
    .bind(creatorId, startedAt)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordChecks(
  db: D1Database,
  checks: { id: string; deleted: boolean }[],
  now: string,
): Promise<void> {
  if (checks.length === 0) return;
  await db.batch(
    checks.map((c) =>
      c.deleted
        ? db.prepare("UPDATE posts SET status = 'deleted', deleted_seen_at = ?, checked_at = ? WHERE id = ?").bind(now, now, c.id)
        : db.prepare("UPDATE posts SET checked_at = ? WHERE id = ?").bind(now, c.id),
    ),
  );
}

// ---------- Suppression physique ----------

export async function postsOfCreator(
  db: D1Database,
  creatorId: string,
  limit: number,
): Promise<Pick<PostRow, "id" | "r2_prefix">[]> {
  const { results } = await db
    .prepare("SELECT id, r2_prefix FROM posts WHERE creator_id = ? LIMIT ?")
    .bind(creatorId, limit)
    .all<Pick<PostRow, "id" | "r2_prefix">>();
  return results;
}

export async function countPostsOfCreator(db: D1Database, creatorId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM posts WHERE creator_id = ?").bind(creatorId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deletePosts(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.flatMap((id) => [
      db.prepare("DELETE FROM media WHERE post_id = ?").bind(id),
      db.prepare("DELETE FROM posts_fts WHERE post_id = ?").bind(id),
      db.prepare("DELETE FROM posts WHERE id = ?").bind(id),
    ]),
  );
}
