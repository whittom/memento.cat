import type { Budget } from "../lib/budget";
import type { Config } from "../lib/config";

export type Platform = "bluesky" | "reddit";
export const PLATFORMS: readonly Platform[] = ["bluesky", "reddit"];

export type MediaKind = "image" | "video" | "gif";

export interface NormalizedMedia {
  kind: MediaKind;
  /** URL de la version complète. */
  sourceUrl: string;
  /** URL de la miniature fournie par la plateforme, si elle existe. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  /** Texte alternatif (Bluesky) ou légende d'élément de galerie (Reddit). */
  description: string | null;
}

export interface NormalizedPost {
  /** "<plateforme>:<id natif>" */
  id: string;
  platform: Platform;
  creatorId: string;
  /** URI at:// (Bluesky) ou fullname t3_ (Reddit), pour les vérifications. */
  nativeRef: string;
  /** Identifiant natif court, utilisé dans les clés R2. */
  nativeId: string;
  publishedAt: string;
  title: string | null;
  text: string;
  sourceUrl: string;
  media: NormalizedMedia[];
}

export interface ResolvedCreator {
  /** "<plateforme>:<id stable>" */
  id: string;
  handle: string;
  displayName: string | null;
}

export type PostState = "active" | "deleted";

export interface ConnectorContext {
  env: Env;
  config: Config;
  budget: Budget;
}

export interface FetchResult {
  /** Publications plus récentes que le curseur, de la plus ancienne à la plus récente. */
  posts: NormalizedPost[];
  /** Faux si la limite de pages a été atteinte avant de rejoindre le curseur (trou possible). */
  reachedCursor: boolean;
}

export interface Connector {
  readonly platform: Platform;
  resolveCreator(handle: string): Promise<ResolvedCreator>;
  /** cursor = date ISO de la dernière publication archivée, ou null au premier passage. */
  fetchSince(creator: { id: string; handle: string }, cursor: string | null): Promise<FetchResult>;
  /** Renvoie l'état de chaque référence native ; une référence absente de la réponse est supprimée. */
  checkStates(nativeRefs: string[]): Promise<Map<string, PostState>>;
  /** Nombre de références vérifiables par appel. */
  readonly checkBatchSize: number;
}

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}
