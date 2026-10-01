export type Platform = "bluesky" | "reddit";
export type CreatorState = "active" | "paused" | "deleted" | "purging";

export interface Creator {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string | null;
  state: CreatorState;
  deletedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  postCount?: number;
  unviewedCount?: number;
}

export interface Media {
  position: number;
  kind: "image" | "video" | "gif";
  mimeType: string | null;
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  description: string | null;
  downloaded: boolean;
  viewed: boolean;
  sourceUrl: string;
}

export interface Post {
  id: string;
  /** Numéro d'inventaire du catalogue. */
  catalogNo: number;
  creator: { id: string; handle: string; displayName: string | null; platform: Platform };
  publishedAt: string;
  capturedAt: string;
  title: string | null;
  text: string;
  sourceUrl: string;
  status: "active" | "deleted";
  deletedSeenAt: string | null;
  mediaCount: number;
  unviewedCount: number;
  media: Media[];
}

export interface Filters {
  creator?: string;
  platform?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  unviewed?: boolean;
}
