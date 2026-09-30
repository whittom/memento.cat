import { NotFoundError, PlatformError } from "../../lib/errors";
import { arr, obj, str, type Json } from "../../lib/json";
import { checkRateLimit } from "../ratelimit";
import type { Connector, ConnectorContext, FetchResult, NormalizedPost, PostState, ResolvedCreator } from "../types";
import { isPinned, isRemoved, mapSubmission } from "./map";

const OAUTH_BASE = "https://oauth.reddit.com";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const PAGE_SIZE = 100;

export class RedditConnector implements Connector {
  readonly platform = "reddit" as const;
  readonly checkBatchSize = 100;
  /** Jeton valable pour cette instance seulement (une instance par invocation). */
  private token: string | undefined;

  constructor(private readonly ctx: ConnectorContext) {}

  private assertConfigured(): void {
    const { env, config } = this.ctx;
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
      throw new PlatformError("reddit", "Identifiants OAuth absents : ajouter REDDIT_CLIENT_ID et REDDIT_CLIENT_SECRET");
    }
    if (!/^[^:\s]+:[^:\s]+:v?[\w.-]+ \(by \/u\/[\w-]+\)$/.test(config.redditUserAgent)) {
      throw new PlatformError("reddit", "REDDIT_USER_AGENT doit suivre le format <plateforme>:<id app>:<version> (by /u/<utilisateur>)");
    }
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    this.assertConfigured();
    const { env, config } = this.ctx;
    const res = await this.ctx.budget.fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": config.redditUserAgent,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PlatformError("reddit", `Authentification refusée (${res.status})`, res.status);
    const token = str(obj(await res.json())?.["access_token"]);
    if (!token) throw new PlatformError("reddit", "Réponse d'authentification sans jeton");
    this.token = token;
    return token;
  }

  private async get(path: string, params: URLSearchParams): Promise<Json> {
    const token = await this.getToken();
    params.set("raw_json", "1");
    const res = await this.ctx.budget.fetch(`${OAUTH_BASE}${path}?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": this.ctx.config.redditUserAgent },
    });
    checkRateLimit("reddit", res, this.ctx.config.rateLimitFloor);
    if (res.status === 404 || res.status === 403) throw new NotFoundError(`Reddit : ${path} introuvable ou inaccessible`);
    if (!res.ok) throw new PlatformError("reddit", `HTTP ${res.status} sur ${path}`, res.status);
    return (await res.json());
  }

  async resolveCreator(handle: string): Promise<ResolvedCreator> {
    const name = handle.trim().replace(/^\/?u\//i, "").replace(/^@/, "");
    if (!/^[\w-]{3,20}$/.test(name)) throw new NotFoundError(`Nom d'utilisateur Reddit invalide : ${handle}`);
    const about = obj(obj(await this.get(`/user/${name}/about`, new URLSearchParams()))?.["data"]);
    const canonical = str(about?.["name"]);
    if (!canonical) throw new NotFoundError(`Compte Reddit introuvable : ${name}`);
    const title = str(obj(about?.["subreddit"])?.["title"]);
    return { id: `reddit:${canonical.toLowerCase()}`, handle: canonical, displayName: title || null };
  }

  async fetchSince(creator: { id: string; handle: string }, cursor: string | null): Promise<FetchResult> {
    const since = cursor ? Date.parse(cursor) : null;
    const maxPages = since === null ? 1 : this.ctx.config.maxPagesPerCreator;
    const collected: NormalizedPost[] = [];
    let after: string | undefined;
    let reachedCursor = false;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ sort: "new", limit: String(PAGE_SIZE) });
      if (after) params.set("after", after);
      const listing = obj(obj(await this.get(`/user/${creator.handle}/submitted`, params))?.["data"]);
      const children = arr(listing?.["children"]);

      for (const child of children) {
        const post = mapSubmission(child, creator.id);
        if (!post) continue;
        if (since !== null && Date.parse(post.publishedAt) <= since) {
          // Une publication épinglée ancienne ne signifie pas qu'on a rejoint le curseur.
          if (!isPinned(child)) reachedCursor = true;
          continue;
        }
        collected.push(post);
      }

      after = str(listing?.["after"]);
      if (reachedCursor || !after || children.length === 0) {
        reachedCursor = true;
        break;
      }
    }
    if (since === null) reachedCursor = true;

    const unique = new Map(collected.map((p) => [p.id, p]));
    const posts = [...unique.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    return { posts, reachedCursor };
  }

  async checkStates(nativeRefs: string[]): Promise<Map<string, PostState>> {
    const body = obj(obj(await this.get("/api/info", new URLSearchParams({ id: nativeRefs.join(",") })))?.["data"]);
    const states = new Map<string, PostState>(nativeRefs.map((ref) => [ref, "deleted"]));
    for (const child of arr(body?.["children"])) {
      const data = obj(obj(child)?.["data"]);
      const name = str(data?.["name"]);
      if (data && name && states.has(name)) states.set(name, isRemoved(data) ? "deleted" : "active");
    }
    return states;
  }
}

