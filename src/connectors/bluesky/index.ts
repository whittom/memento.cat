import { NotFoundError, PlatformError } from "../../lib/errors";
import { arr, obj, str, type Json } from "../../lib/json";
import { checkRateLimit } from "../ratelimit";
import type { Connector, ConnectorContext, FetchResult, NormalizedPost, PostState, ResolvedCreator } from "../types";
import { BSKY_APPVIEW, blobUrl, mapFeedItem } from "./map";

const PAGE_SIZE = 50;

export class BlueskyConnector implements Connector {
  readonly platform = "bluesky" as const;
  readonly checkBatchSize = 25;
  /** Cache des PDS par DID, limité à cette instance (une instance par invocation). */
  private readonly pdsByDid = new Map<string, string>();

  constructor(private readonly ctx: ConnectorContext) {}

  private async get(method: string, params: URLSearchParams): Promise<Json> {
    const url = `${BSKY_APPVIEW}/xrpc/${method}?${params.toString()}`;
    const res = await this.ctx.budget.fetch(url, { headers: { accept: "application/json" } });
    checkRateLimit("bluesky", res, this.ctx.config.rateLimitFloor);
    if (res.status === 400) {
      const body = obj(await res.json().catch(() => null));
      const message = str(body?.["message"]) ?? "requête refusée";
      if (/not found/i.test(message)) throw new NotFoundError(message);
      throw new PlatformError("bluesky", message, 400);
    }
    if (!res.ok) throw new PlatformError("bluesky", `HTTP ${res.status} sur ${method}`, res.status);
    return (await res.json());
  }

  async resolveCreator(handle: string): Promise<ResolvedCreator> {
    const actor = handle.trim().replace(/^@/, "");
    const profile = obj(await this.get("app.bsky.actor.getProfile", new URLSearchParams({ actor })));
    const did = str(profile?.["did"]);
    if (!did) throw new NotFoundError(`Profil Bluesky introuvable : ${actor}`);
    return {
      id: `bluesky:${did}`,
      handle: str(profile?.["handle"]) ?? actor,
      displayName: str(profile?.["displayName"]) ?? null,
    };
  }

  async fetchSince(creator: { id: string }, cursor: string | null): Promise<FetchResult> {
    const did = creator.id.slice("bluesky:".length);
    const since = cursor ? Date.parse(cursor) : null;
    const maxPages = since === null ? 1 : this.ctx.config.maxPagesPerCreator;
    const collected: NormalizedPost[] = [];
    const pendingVideos: { post: NormalizedPost; index: number; cid: string }[] = [];
    let pageCursor: string | undefined;
    let reachedCursor = false;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ actor: did, limit: String(PAGE_SIZE), filter: "posts_no_replies" });
      if (pageCursor) params.set("cursor", pageCursor);
      const body = obj(await this.get("app.bsky.feed.getAuthorFeed", params));
      const feed = arr(body?.["feed"]);

      for (const item of feed) {
        // Les vidéos exigent le PDS de l'auteur : on le résout après coup, une seule fois.
        const post = mapFeedItem(item, did, (cid) => `pending-video:${cid}`);
        if (!post) continue;
        if (since !== null && Date.parse(post.publishedAt) <= since) {
          reachedCursor = true;
          continue;
        }
        post.media.forEach((m, index) => {
          if (m.sourceUrl.startsWith("pending-video:")) {
            pendingVideos.push({ post, index, cid: m.sourceUrl.slice("pending-video:".length) });
          }
        });
        collected.push(post);
      }

      pageCursor = str(body?.["cursor"]);
      if (reachedCursor || !pageCursor || feed.length === 0) {
        reachedCursor = true;
        break;
      }
    }
    if (since === null) reachedCursor = true;

    if (pendingVideos.length > 0) {
      const pds = await this.resolvePds(did);
      for (const v of pendingVideos) {
        const media = v.post.media[v.index];
        if (media) media.sourceUrl = blobUrl(pds, did, v.cid);
      }
    }

    // Déduplication (une publication peut apparaître deux fois entre deux pages).
    const unique = new Map(collected.map((p) => [p.id, p]));
    const posts = [...unique.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    return { posts, reachedCursor };
  }

  /** Trouve le serveur (PDS) qui héberge les fichiers de l'auteur, à partir de son document DID. */
  private async resolvePds(did: string): Promise<string> {
    const cached = this.pdsByDid.get(did);
    if (cached) return cached;
    let url: string;
    if (did.startsWith("did:plc:")) url = `https://plc.directory/${did}`;
    else if (did.startsWith("did:web:")) url = `https://${did.slice("did:web:".length)}/.well-known/did.json`;
    else throw new PlatformError("bluesky", `Méthode DID non prise en charge : ${did}`);

    const res = await this.ctx.budget.fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new PlatformError("bluesky", `Document DID illisible (${res.status})`, res.status);
    const doc = obj(await res.json());
    const service = arr(doc?.["service"])
      .map((s) => obj(s))
      .find((s) => str(s?.["id"])?.endsWith("#atproto_pds"));
    const endpoint = str(service?.["serviceEndpoint"]);
    if (!endpoint) throw new PlatformError("bluesky", `Aucun PDS déclaré pour ${did}`);
    this.pdsByDid.set(did, endpoint);
    return endpoint;
  }

  async checkStates(nativeRefs: string[]): Promise<Map<string, PostState>> {
    const params = new URLSearchParams();
    for (const uri of nativeRefs) params.append("uris", uri);
    const body = obj(await this.get("app.bsky.feed.getPosts", params));
    const found = new Set(arr(body?.["posts"]).map((p) => str(obj(p)?.["uri"])).filter(Boolean));
    return new Map(nativeRefs.map((uri) => [uri, found.has(uri) ? "active" : "deleted"]));
  }
}
