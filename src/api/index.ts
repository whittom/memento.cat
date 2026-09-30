import { syncCreator } from "../collect";
import { createConnectors } from "../connectors";
import { isPlatform } from "../connectors/types";
import { Budget } from "../lib/budget";
import { readConfig } from "../lib/config";
import { HttpError, NotFoundError, PlatformError, RateLimitError } from "../lib/errors";
import { bool, num, str } from "../lib/json";
import { purgeBatch } from "../purge";
import {
  creatorStats,
  getCreator,
  getVisiblePost,
  insertCreator,
  isVisibleKey,
  listCreators,
  listPosts,
  mediaForPosts,
  setCreatorState,
  setViewed,
  type CreatorRow,
  type CreatorWithCounts,
} from "../storage/db";
import { verifyBatch } from "../verify";
import { decodeCursor, encodeCursor, json, parseDay, readBody } from "./http";
import { presentPost } from "./present";
import { reindexBatch } from "./reindex";

const PAGE_SIZE = 30;

function presentCreator(c: CreatorRow | CreatorWithCounts) {
  return {
    id: c.id,
    platform: c.platform,
    handle: c.handle,
    displayName: c.display_name,
    state: c.state,
    deletedAt: c.deleted_at,
    lastRunAt: c.last_run_at,
    lastSuccessAt: c.last_success_at,
    lastError: c.last_error,
    postCount: "post_count" in c ? c.post_count : undefined,
    unviewedCount: "unviewed_count" in c ? c.unviewed_count : undefined,
  };
}

async function requireCreator(env: Env, id: string): Promise<CreatorRow> {
  const creator = await getCreator(env.DB, id);
  if (!creator) throw new HttpError(404, "Créateur introuvable");
  return creator;
}

/** Point d'entrée de l'API /api/*. */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api".length);
  const method = request.method;
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const now = new Date().toISOString();

  // ---- Médias (lecture seule, avec prise en charge des plages pour la vidéo) ----
  if (parts[0] === "media" && method === "GET") {
    const key = parts.slice(1).join("/");
    return serveMedia(request, env, key);
  }

  // ---- Créateurs ----
  if (parts[0] === "creators") {
    const id = parts[1];
    const action = parts[2];

    if (!id && method === "GET") {
      return json({ creators: (await listCreators(env.DB)).map(presentCreator) });
    }

    if (!id && method === "POST") {
      const body = await readBody(request);
      const platform = body["platform"];
      const handle = str(body["handle"])?.trim();
      if (!isPlatform(platform)) throw new HttpError(400, "Plateforme non prise en charge (bluesky ou reddit)");
      if (!handle) throw new HttpError(400, "Identifiant du créateur manquant");
      const config = readConfig(env);
      const connector = createConnectors({ env, config, budget: new Budget(5) })[platform];
      let resolved;
      try {
        resolved = await connector.resolveCreator(handle);
      } catch (e) {
        if (e instanceof NotFoundError) throw new HttpError(404, e.message);
        if (e instanceof RateLimitError) throw new HttpError(429, "Quota de la plateforme atteint, réessayez plus tard");
        if (e instanceof PlatformError) throw new HttpError(502, e.message);
        throw e;
      }
      const existing = await getCreator(env.DB, resolved.id);
      if (existing) throw new HttpError(409, `Ce créateur est déjà suivi (état : ${existing.state})`);
      await insertCreator(env.DB, { ...resolved, platform }, now);
      return json({ creator: presentCreator(await requireCreator(env, resolved.id)) }, 201);
    }

    if (id && !action && method === "PATCH") {
      const creator = await requireCreator(env, id);
      const body = await readBody(request);
      const state = body["state"];
      if (state !== "active" && state !== "paused") throw new HttpError(400, "État attendu : active ou paused");
      if (creator.state !== "active" && creator.state !== "paused") {
        throw new HttpError(409, "Restaurez d'abord ce créateur depuis la corbeille");
      }
      await setCreatorState(env.DB, id, state, null);
      return json({ creator: presentCreator(await requireCreator(env, id)) });
    }

    if (id && !action && method === "DELETE") {
      const creator = await requireCreator(env, id);
      if (url.searchParams.get("mode") !== "logical") {
        throw new HttpError(400, "Utilisez mode=logical, ou POST /purge pour une suppression définitive");
      }
      if (creator.state === "purging") throw new HttpError(409, "Suppression définitive déjà en cours");
      await setCreatorState(env.DB, id, "deleted", now);
      return json({ creator: presentCreator(await requireCreator(env, id)) });
    }

    if (id && action === "restore" && method === "POST") {
      const creator = await requireCreator(env, id);
      if (creator.state !== "deleted") throw new HttpError(409, "Seul un créateur dans la corbeille peut être restauré");
      await setCreatorState(env.DB, id, "paused", null);
      return json({ creator: presentCreator(await requireCreator(env, id)) });
    }

    if (id && action === "stats" && method === "GET") {
      await requireCreator(env, id);
      return json(await creatorStats(env.DB, id));
    }

    if (id && action === "purge" && method === "POST") {
      const creator = await requireCreator(env, id);
      const body = await readBody(request);
      // Première demande : il faut retaper le nom. Une reprise (état purging) n'a pas besoin de nouvelle confirmation.
      if (creator.state !== "purging" && str(body["confirm"]) !== creator.handle) {
        throw new HttpError(400, "Confirmation incorrecte : retapez le nom exact du créateur");
      }
      return json(await purgeBatch(env, id));
    }

    if (id && action === "sync" && method === "POST") {
      return json(await syncCreator(env, id));
    }

    if (id && action === "verify" && method === "POST") {
      const body = await readBody(request);
      try {
        return json(await verifyBatch(env, id, str(body["startedAt"]) ?? null));
      } catch (e) {
        if (e instanceof RateLimitError) throw new HttpError(429, `Quota atteint, réessayez dans ${e.resetSeconds} s`);
        if (e instanceof PlatformError) throw new HttpError(502, e.message);
        throw e;
      }
    }
  }

  // ---- Publications ----
  if (parts[0] === "posts" && method === "GET") {
    if (parts[1]) {
      const row = await getVisiblePost(env.DB, parts[1]);
      if (!row) throw new HttpError(404, "Publication introuvable");
      return json({ post: presentPost(row, await mediaForPosts(env.DB, [row.id])) });
    }
    const q = url.searchParams;
    const platform = q.get("platform");
    const status = q.get("status");
    if (platform && !isPlatform(platform)) throw new HttpError(400, "Plateforme inconnue");
    if (status && status !== "active" && status !== "deleted") throw new HttpError(400, "Statut inconnu");
    const rows = await listPosts(env.DB, {
      creator: q.get("creator") ?? undefined,
      platform: platform && isPlatform(platform) ? platform : undefined,
      from: parseDay(q.get("from")),
      to: parseDay(q.get("to"), true),
      q: q.get("q")?.slice(0, 200) ?? undefined,
      status: status === "active" || status === "deleted" ? status : undefined,
      unviewed: q.get("unviewed") === "1",
      cursor: decodeCursor(q.get("cursor")),
      limit: PAGE_SIZE + 1,
    });
    const page = rows.slice(0, PAGE_SIZE);
    const media = await mediaForPosts(env.DB, page.map((r) => r.id));
    const last = page.at(-1);
    return json({
      posts: page.map((r) => presentPost(r, media.filter((m) => m.post_id === r.id))),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.published_at, last.id) : null,
    });
  }

  // ---- Consultation ----
  if (parts[0] === "views" && method === "POST") {
    const body = await readBody(request);
    const scope = body["scope"];
    const id = str(body["id"]);
    if (scope !== "media" && scope !== "post" && scope !== "creator") throw new HttpError(400, "Portée attendue : media, post ou creator");
    if (!id) throw new HttpError(400, "Identifiant manquant");
    const position = num(body["position"]) ?? null;
    if (scope === "media" && position === null) throw new HttpError(400, "Position du média manquante");
    const changed = await setViewed(env.DB, scope, id, position, bool(body["viewed"]), now);
    return json({ changed });
  }

  // ---- Maintenance ----
  if (parts[0] === "admin" && parts[1] === "reindex" && method === "POST") {
    const body = await readBody(request);
    return json(await reindexBatch(env, str(body["cursor"])));
  }

  throw new HttpError(404, "Route inconnue");
}

async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  if (!key || key.includes("..")) throw new HttpError(400, "Clé de média invalide");
  if (!(await isVisibleKey(env.DB, key))) throw new HttpError(404, "Média introuvable");

  const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) throw new HttpError(404, "Média introuvable");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  // Contenu immuable (une clé ne change jamais de contenu), mais privé : jamais en cache partagé.
  headers.set("cache-control", "private, max-age=31536000, immutable");

  if (!("body" in object)) return new Response(null, { status: 304, headers });

  const range = object.range;
  if (range && request.headers.has("range")) {
    const size = object.size;
    let start: number;
    let end = size - 1;
    if ("suffix" in range) {
      start = Math.max(0, size - range.suffix);
    } else {
      start = range.offset ?? 0;
      end = range.length !== undefined ? start + range.length - 1 : size - 1;
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
