import type { MediaRow, PostListRow } from "../storage/db";

/** URL de l'API pour une clé R2 (chaque segment encodé). */
export function mediaUrl(key: string | null): string | null {
  return key ? `/api/media/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

export function presentPost(row: PostListRow, media: MediaRow[]) {
  return {
    id: row.id,
    catalogNo: row.catalog_no,
    creator: { id: row.creator_id, handle: row.handle, displayName: row.display_name, platform: row.platform },
    publishedAt: row.published_at,
    capturedAt: row.captured_at,
    title: row.title,
    text: row.text,
    sourceUrl: row.source_url,
    status: row.status,
    deletedSeenAt: row.deleted_seen_at,
    mediaCount: row.media_count,
    unviewedCount: row.unviewed_count,
    media: media.map((m) => ({
      position: m.position,
      kind: m.kind,
      mimeType: m.mime_type,
      url: mediaUrl(m.r2_key),
      thumbUrl: mediaUrl(m.thumb_r2_key),
      width: m.width,
      height: m.height,
      thumbWidth: m.thumb_width,
      thumbHeight: m.thumb_height,
      description: m.description,
      downloaded: m.downloaded === 1,
      viewed: m.viewed_at !== null,
      sourceUrl: m.source_url,
    })),
  };
}

export type PresentedPost = ReturnType<typeof presentPost>;
