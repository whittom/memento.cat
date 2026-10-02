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
}

export type MediaInsert = Omit<MediaRow, "viewed_at">;

const VISIBLE = "c.state IN ('active', 'paused')";

// ---------- Créateurs ----------

export async function listCreators(db: D1Database): Promise<CreatorWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM posts p WHERE p.creator_id = c.id) AS post_count,
         (SELECT COUNT(*) FROM media m JOIN posts p ON p.id = m.post_id
            WHERE p.creator_id = c.id AND m.viewed_at IS NULL AND m.downloaded = 1) AS unviewed_count
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
         (SELECT COALESCE(SUM(m.bytes), 0) FROM media m JOIN posts p ON p.id = m.post_id WHERE p.creator_id = ?1) AS bytes`,
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
              thumb_r2_key, thumb_width, thumb_height, description, source_url, downloaded)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          m.post_id, m.position, m.kind, m.mime_type, m.r2_key, m.etag, m.bytes, m.width, m.height,
          m.thumb_r2_key, m.thumb_width, m.thumb_height, m.description, m.source_url, m.downloaded,
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
    where.push("EXISTS (SELECT 1 FROM media m WHERE m.post_id = p.id AND m.viewed_at IS NULL AND m.downloaded = 1)");
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
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND m.viewed_at IS NULL AND m.downloaded = 1) AS unviewed_count
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
         (SELECT COUNT(*) FROM media m WHERE m.post_id = p.id AND m.viewed_at IS NULL AND m.downloaded = 1) AS unviewed_count
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
