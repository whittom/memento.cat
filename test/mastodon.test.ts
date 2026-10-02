import { afterEach, describe, expect, it, vi } from "vitest";
import { MastodonConnector } from "../src/connectors/mastodon";
import { htmlToText, isPublicHostname, mapAttachments, mapStatus, parseHandle } from "../src/connectors/mastodon/map";
import { checkRateLimit } from "../src/connectors/ratelimit";
import { Budget } from "../src/lib/budget";
import type { Config } from "../src/lib/config";
import { NotFoundError, PlatformError, RateLimitError } from "../src/lib/errors";
import { postPrefix } from "../src/storage/keys";

const host = "pics.social";
const account = "42";
const config: Config = {
  requireAccess: false, accessTeamDomain: "", accessAud: "",
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 40, maxPagesPerCreator: 3, maxMediaBytes: 1, rateLimitFloor: 10, redditUserAgent: "", mastodonUserAgent: "memento (test)",
};

const image = (n: number) => ({
  type: "image", url: `https://files.example/orig/${n}.jpeg`, preview_url: `https://files.example/small/${n}.jpeg`,
  description: ` Une rue en automne ${n} `,
  meta: { original: { width: 3325, height: 2494 }, small: { width: 554, height: 416 } },
});

const status = (id: string, over: Record<string, unknown> = {}) => ({
  id, created_at: new Date(Date.UTC(2026, 8, 29, 10, 0, 0) + (Number(id) || 0) % 100_000 * 1000).toISOString(), visibility: "public", reblog: null, spoiler_text: "",
  url: `https://${host}/@nom/${id}`, uri: `https://${host}/users/nom/statuses/${id}`,
  content: "<p>Bonjour</p>", account: { id: account }, media_attachments: [image(1)], ...over,
});

describe("Mastodon : serveur et identifiant", () => {
  it("accepte un nom d'hôte public et refuse adresses IP, ports, noms locaux et hôtes mal formés", () => {
    expect(isPublicHostname("mastodon.social")).toBe(true);
    expect(isPublicHostname("xn--bcher-kva.org")).toBe(true);
    for (const bad of ["localhost", "127.0.0.1", "10.0.0.1", "mastodon", "pics.social:8080", "serveur.local", "a.internal", "Pics.Social", "-x.example", "a..b", "", "[::1]"]) {
      expect(isPublicHostname(bad), bad).toBe(false);
    }
  });

  it("lit nom@serveur, @nom@serveur et les adresses de profil", () => {
    expect(parseHandle("nom@pics.social")).toEqual({ user: "nom", host: "pics.social" });
    expect(parseHandle(" @Nom@Pics.Social ")).toEqual({ user: "Nom", host: "pics.social" });
    expect(parseHandle("https://pics.social/@nom")).toEqual({ user: "nom", host: "pics.social" });
    expect(parseHandle("https://pics.social/users/nom")).toEqual({ user: "nom", host: "pics.social" });
    expect(parseHandle("nom")).toBeUndefined();
    expect(parseHandle("nom@127.0.0.1")).toBeUndefined();
    expect(parseHandle("nom@serveur.local")).toBeUndefined();
    expect(parseHandle("https://pics.social/")).toBeUndefined();
  });
});

describe("Mastodon : texte", () => {
  it("convertit le HTML en texte brut", () => {
    expect(htmlToText("<p>Un &amp; deux</p><p>Trois<br>quatre</p>")).toBe("Un & deux\n\nTrois\nquatre");
    expect(htmlToText('<p>Merci <a href="https://t/x" class="mention hashtag">#<span>Chat</span></a> &#233;t&#xE9; &quot;ok&quot;</p>')).toBe('Merci #Chat été "ok"');
    expect(htmlToText('<a href="https://x.example/a"><span class="invisible">https://</span><span class="ellipsis">x.example/a</span></a>')).toBe("x.example/a");
    expect(htmlToText("&unknown; &#0; &#99999999;")).toBe("&unknown; &#0; &#99999999;");
  });
});

describe("Mastodon : correspondance des publications", () => {
  it("normalise une publication avec image", () => {
    const p = mapStatus(status("117353911072205197", { spoiler_text: " Attention ", created_at: "2026-09-29T10:42:54.716Z" }), host, account);
    expect(p).toMatchObject({
      id: `mastodon:${host}:117353911072205197`,
      platform: "mastodon",
      creatorId: `mastodon:${host}:${account}`,
      nativeId: "117353911072205197",
      nativeRef: `https://${host}/api/v1/statuses/117353911072205197`,
      publishedAt: "2026-09-29T10:42:54.716Z",
      title: "Attention",
      text: "Bonjour",
      sourceUrl: `https://${host}/@nom/117353911072205197`,
    });
    expect(p?.media[0]).toEqual({
      kind: "image", sourceUrl: "https://files.example/orig/1.jpeg", thumbUrl: "https://files.example/small/1.jpeg",
      width: 3325, height: 2494, thumbWidth: 554, thumbHeight: 416, description: "Une rue en automne 1",
    });
    expect(postPrefix(p!)).toBe(`mastodon/${host}_${account}/2026/09/2026-09-29_117353911072205197/`);
  });

  it("garde image, vidéo et gifv ; ignore audio et inconnu", () => {
    const kinds = mapAttachments([
      image(1), { type: "video", url: "https://f/v.mp4", preview_url: "https://f/v.jpg" },
      { type: "gifv", url: "https://f/g.mp4" }, { type: "audio", url: "https://f/a.mp3" }, { type: "unknown", url: "https://f/x" }, { type: "image" },
    ]).map((m) => m.kind);
    expect(kinds).toEqual(["image", "video", "gif"]);
    expect(mapAttachments([{ type: "gifv", url: "https://f/g.mp4" }])[0]).toMatchObject({ thumbUrl: null, width: null, description: null });
  });

  it("écarte les republications, les messages d'un autre compte et les messages non publics", () => {
    expect(mapStatus(status("1", { reblog: { id: "9" } }), host, account)).toBeNull();
    expect(mapStatus(status("1", { account: { id: "7" } }), host, account)).toBeNull();
    expect(mapStatus(status("1", { visibility: "private" }), host, account)).toBeNull();
    expect(mapStatus(status("1", { visibility: "direct" }), host, account)).toBeNull();
    expect(mapStatus(status("1", { visibility: "unlisted" }), host, account)).not.toBeNull();
    expect(mapStatus(status("pas-un-nombre"), host, account)).toBeNull();
    expect(mapStatus(status("1", { created_at: "n'importe quoi" }), host, account)).toBeNull();
  });
});

describe("Mastodon : quota", () => {
  it("lit X-RateLimit-Reset en horodatage ISO", () => {
    const at = new Date(Date.now() + 90_000).toISOString();
    const low = new Response("", { headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": at } });
    let error: unknown;
    try { checkRateLimit("mastodon", low, 10); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetSeconds).toBeGreaterThan(80);
    expect((error as RateLimitError).resetSeconds).toBeLessThanOrEqual(90);
    expect(() => checkRateLimit("mastodon", new Response("", { headers: { "x-ratelimit-remaining": "250", "x-ratelimit-reset": at } }), 10)).not.toThrow();
  });
});

describe("Mastodon : connecteur (appels simulés)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (data: unknown, status = 200) => Promise.resolve(Response.json(data, { status }));
  const connector = () => new MastodonConnector({ env: {} as Env, config, budget: new Budget(45) });
  const creator = { id: `mastodon:${host}:${account}`, handle: `nom@${host}` };
  const stub = (handler: (url: URL) => Promise<Response>) => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return handler(url);
    });
    return calls;
  };

  it("résout un compte sur le serveur indiqué", async () => {
    const calls = stub(() => json({ id: account, username: "nom", display_name: " Nom Prénom " }));
    expect(await connector().resolveCreator("@Nom@Pics.Social")).toEqual({ id: `mastodon:${host}:${account}`, handle: `nom@${host}`, displayName: "Nom Prénom" });
    expect(calls[0]?.origin).toBe(`https://${host}`);
    expect(calls[0]?.searchParams.get("acct")).toBe("Nom");
  });

  it("refuse un serveur qui exige une connexion, un compte absent et un identifiant invalide", async () => {
    stub(() => json({ error: "connexion" }, 401));
    await expect(connector().resolveCreator(`nom@${host}`)).rejects.toBeInstanceOf(PlatformError);
    stub(() => json({ error: "absent" }, 404));
    await expect(connector().resolveCreator(`nom@${host}`)).rejects.toBeInstanceOf(NotFoundError);
    const calls = stub(() => json({}));
    await expect(connector().resolveCreator("nom@127.0.0.1")).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toHaveLength(0);
  });

  it("premier passage : une seule page, filtres envoyés au serveur", async () => {
    const calls = stub(() => json([status("300"), status("200", { reblog: { id: "1" } }), status("100")]));
    const r = await connector().fetchSince(creator, null);
    expect(r.reachedCursor).toBe(true);
    expect(r.posts.map((p) => p.nativeId)).toEqual(["100", "300"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe(`/api/v1/accounts/${account}/statuses`);
    expect(Object.fromEntries(calls[0]?.searchParams ?? [])).toMatchObject({ only_media: "true", exclude_reblogs: "true", exclude_replies: "true", limit: "40" });
  });

  it("s'arrête au curseur et pagine par max_id, sinon signale un trou", async () => {
    const old = (id: string) => status(id, { created_at: "2026-09-01T00:00:00.000Z" });
    const calls = stub((url) => json(url.searchParams.get("max_id") ? [old("90")] : [status("300"), status("200")]));
    const r = await connector().fetchSince(creator, "2026-09-10T00:00:00.000Z");
    expect(r.reachedCursor).toBe(true);
    expect(r.posts.map((p) => p.nativeId)).toEqual(["200", "300"]);
    expect(calls.map((c) => c.searchParams.get("max_id"))).toEqual([null, "200"]);

    stub(() => json([status("300", { created_at: "2026-09-29T00:00:00.000Z" })]));
    const gap = await connector().fetchSince(creator, "2026-09-10T00:00:00.000Z");
    expect(gap.reachedCursor).toBe(false);
  });

  it("vérifie les suppressions : 404 et 410 sont supprimés, les autres erreurs ne concluent rien", async () => {
    const ref = (id: string) => `https://${host}/api/v1/statuses/${id}`;
    stub((url) => json({}, url.pathname.endsWith("/1") ? 200 : url.pathname.endsWith("/2") ? 404 : 410));
    const states = await connector().checkStates([ref("1"), ref("2"), ref("3")]);
    expect([...states]).toEqual([[ref("1"), "active"], [ref("2"), "deleted"], [ref("3"), "deleted"]]);

    stub(() => json({}, 403));
    await expect(connector().checkStates([ref("1")])).rejects.toBeInstanceOf(PlatformError);
    stub(() => json({}, 503));
    await expect(connector().checkStates([ref("1")])).rejects.toBeInstanceOf(PlatformError);
    const calls = stub(() => json({}));
    await expect(connector().checkStates(["https://127.0.0.1/api/v1/statuses/1"])).rejects.toBeInstanceOf(PlatformError);
    expect(calls).toHaveLength(0);
  });
});
