import { NotFoundError, PlatformError } from "../../lib/errors";
import { arr, obj, str, type Json } from "../../lib/json";
import { checkRateLimit } from "../ratelimit";
import type { Connector, ConnectorContext, FetchResult, NormalizedPost, PostState, ResolvedCreator } from "../types";
import { isPublicHostname, mapStatus, parseHandle } from "./map";

const PAGE_SIZE = 40;

/** Identifiant de créateur "mastodon:<serveur>:<id du compte>" → serveur et compte. */
function splitCreatorId(id: string): { host: string; accountId: string } {
  const [, host, accountId] = id.split(":");
  if (!host || !accountId || !isPublicHostname(host) || !/^\d+$/.test(accountId)) {
    throw new PlatformError("mastodon", `Identifiant de créateur invalide : ${id}`);
  }
  return { host, accountId };
}

export class MastodonConnector implements Connector {
  readonly platform = "mastodon" as const;
  /** Un appel par message : on garde de la marge sous le budget de sous-requêtes. */
  readonly checkBatchSize = 20;

  constructor(private readonly ctx: ConnectorContext) {}

  /** GET sur le serveur du créateur, sans authentification. Renvoie la réponse après contrôle du quota. */
  private async request(host: string, path: string, params?: URLSearchParams): Promise<Response> {
    const query = params ? `?${params.toString()}` : "";
    const res = await this.ctx.budget.fetch(`https://${host}${path}${query}`, {
      headers: { accept: "application/json", "user-agent": this.ctx.config.mastodonUserAgent },
      redirect: "manual",
    });
    checkRateLimit("mastodon", res, this.ctx.config.rateLimitFloor);
    return res;
  }

  private async getJson(host: string, path: string, params?: URLSearchParams): Promise<Json> {
    const res = await this.request(host, path, params);
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      throw new NotFoundError(`Mastodon : ${path} introuvable sur ${host}`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new PlatformError("mastodon", `${host} exige une connexion pour lire ce compte : il ne peut pas être suivi`, res.status);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new PlatformError("mastodon", `HTTP ${res.status} sur ${host}${path}`, res.status);
    }
    return (await res.json());
  }

  async resolveCreator(handle: string): Promise<ResolvedCreator> {
    const parsed = parseHandle(handle);
    if (!parsed) throw new NotFoundError(`Identifiant Mastodon invalide : ${handle} (attendu : nom@serveur)`);
    const account = obj(await this.getJson(parsed.host, "/api/v1/accounts/lookup", new URLSearchParams({ acct: parsed.user })));
    const accountId = str(account?.["id"]);
    if (!accountId || !/^\d+$/.test(accountId)) throw new NotFoundError(`Compte Mastodon introuvable : ${handle}`);
    const username = str(account?.["username"]) ?? parsed.user;
    const displayName = str(account?.["display_name"])?.trim();
    return {
      id: `mastodon:${parsed.host}:${accountId}`,
      handle: `${username}@${parsed.host}`,
      displayName: displayName ? displayName : null,
    };
  }

  async fetchSince(creator: { id: string; handle: string }, cursor: string | null): Promise<FetchResult> {
    const { host, accountId } = splitCreatorId(creator.id);
    const since = cursor ? Date.parse(cursor) : null;
    const maxPages = since === null ? 1 : this.ctx.config.maxPagesPerCreator;
    const collected: NormalizedPost[] = [];
    let maxId: string | undefined;
    let reachedCursor = false;

    for (let page = 0; page < maxPages; page++) {
      // Le serveur écarte déjà republications, réponses à autrui et messages sans média.
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        only_media: "true",
        exclude_reblogs: "true",
        exclude_replies: "true",
      });
      if (maxId) params.set("max_id", maxId);
      const statuses = arr(await this.getJson(host, `/api/v1/accounts/${accountId}/statuses`, params));

      for (const status of statuses) {
        const post = mapStatus(status, host, accountId);
        if (!post) continue;
        if (since !== null && Date.parse(post.publishedAt) <= since) {
          reachedCursor = true;
          continue;
        }
        collected.push(post);
      }

      // Les identifiants sont ordonnés dans le temps : le dernier de la page sert de point de reprise.
      maxId = str(obj(statuses.at(-1))?.["id"]);
      if (reachedCursor || !maxId || statuses.length === 0) {
        reachedCursor = true;
        break;
      }
    }
    if (since === null) reachedCursor = true;

    const unique = new Map(collected.map((p) => [p.id, p]));
    const posts = [...unique.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    return { posts, reachedCursor };
  }

  /**
   * 200 = en ligne ; 404 ou 410 = supprimé. Toute autre réponse (connexion exigée, serveur en panne)
   * ne dit rien sur la publication : on lève une erreur plutôt que de la déclarer supprimée.
   */
  async checkStates(nativeRefs: string[]): Promise<Map<string, PostState>> {
    const states = new Map<string, PostState>();
    for (const ref of nativeRefs) {
      const m = /^https:\/\/([^/]+)\/api\/v1\/statuses\/(\d+)$/.exec(ref);
      if (!m?.[1] || !m[2] || !isPublicHostname(m[1])) {
        throw new PlatformError("mastodon", `Référence de publication invalide : ${ref}`);
      }
      const res = await this.request(m[1], `/api/v1/statuses/${m[2]}`);
      await res.body?.cancel();
      if (res.status === 404 || res.status === 410) states.set(ref, "deleted");
      else if (res.ok) states.set(ref, "active");
      else throw new PlatformError("mastodon", `HTTP ${res.status} en vérifiant ${ref}`, res.status);
    }
    return states;
  }
}
