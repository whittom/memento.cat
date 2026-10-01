import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertAccess, findKey } from "../src/access";
import type { Config } from "../src/lib/config";

// WebCrypto global (Node 20+ et runtime Workers) : pas de dépendance aux types de Node.
const subtle = crypto.subtle;
const team = "equipe.cloudflareaccess.com";
const aud = "aud-memento";
const config: Config = {
  requireAccess: true, accessTeamDomain: team, accessAud: aud,
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 40, maxPagesPerCreator: 3, maxMediaBytes: 1, rateLimitFloor: 10, redditUserAgent: "",
};

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
const finder = (_t: string, kid: string | undefined) => Promise.resolve(kid === "k1" ? publicJwk : undefined);

const b64url = (b: Uint8Array | string): string => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function token(payload: Record<string, unknown>, kid = "k1"): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const valid = () => ({ aud: [aud], iss: `https://${team}`, exp: Math.floor(Date.now() / 1000) + 600 });
const req = (t?: string) => new Request("https://memento.example/", { headers: t ? { "cf-access-jwt-assertion": t } : {} });

beforeAll(async () => {
  const pair = (await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = (await subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
});

describe("contrôle Cloudflare Access", () => {
  it("accepte un jeton valide", async () => {
    await expect(assertAccess(req(await token(valid())), config, finder)).resolves.toBeUndefined();
  });

  it("accepte le jeton transmis par le cookie CF_Authorization", async () => {
    const r = new Request("https://memento.example/", { headers: { cookie: `a=b; CF_Authorization=${await token(valid())}` } });
    await expect(assertAccess(r, config, finder)).resolves.toBeUndefined();
  });

  it("refuse l'absence de jeton, une mauvaise audience, un jeton expiré, un autre émetteur, une clé inconnue", async () => {
    await expect(assertAccess(req(), config, finder)).rejects.toMatchObject({ status: 403 });
    await expect(assertAccess(req(await token({ ...valid(), aud: ["autre"] })), config, finder)).rejects.toMatchObject({ status: 403 });
    await expect(assertAccess(req(await token({ ...valid(), exp: 1 })), config, finder)).rejects.toMatchObject({ status: 403 });
    await expect(assertAccess(req(await token({ ...valid(), iss: "https://pirate.example" })), config, finder)).rejects.toMatchObject({ status: 403 });
    await expect(assertAccess(req(await token(valid(), "k2")), config, finder)).rejects.toMatchObject({ status: 403 });
  });

  it("refuse un jeton dont la charge a été modifiée", async () => {
    const [h, , s] = (await token(valid())).split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...valid(), aud: [aud], admin: true }))}.${s}`;
    await expect(assertAccess(req(forged), config, finder)).rejects.toMatchObject({ status: 403 });
  });

  it("signale une configuration incomplète plutôt que d'ouvrir l'accès", async () => {
    await expect(assertAccess(req(), { ...config, accessAud: "" }, finder)).rejects.toMatchObject({ status: 500 });
  });

  it("laisse passer quand le contrôle est désactivé (développement local)", async () => {
    await expect(assertAccess(req(), { ...config, requireAccess: false }, finder)).resolves.toBeUndefined();
  });
});

describe("clés Cloudflare Access (cache et rotation)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Cache simulé (caches.default) et fetch simulé de la liste de clés. */
  function setup(cachedKids: string[] | null, cachedAgeMs: number, freshKids: string[]) {
    const store = new Map<string, Response>();
    if (cachedKids) {
      store.set(`https://${team}/cdn-cgi/access/certs`, new Response(JSON.stringify({ keys: cachedKids.map((kid) => ({ kid, kty: "RSA" })) }), {
        headers: { "x-memento-fetched-at": String(Date.now() - cachedAgeMs) },
      }));
    }
    const fetches: string[] = [];
    vi.stubGlobal("caches", {
      default: {
        match: (url: string) => Promise.resolve(store.get(url)?.clone()),
        put: (url: string, res: Response) => { store.set(url, res); return Promise.resolve(); },
      },
    });
    vi.stubGlobal("fetch", (url: string) => {
      fetches.push(url);
      return Promise.resolve(Response.json({ keys: freshKids.map((kid) => ({ kid, kty: "RSA" })) }));
    });
    return { fetches, store };
  }

  it("sert la clé depuis le cache sans appel réseau", async () => {
    const { fetches } = setup(["k1"], 0, ["k1"]);
    expect(await findKey(team, "k1")).toMatchObject({ kid: "k1" });
    expect(fetches).toHaveLength(0);
  });

  it("relit la liste quand la clé est absente du cache (rotation), puis la garde en cache", async () => {
    const { fetches } = setup(["ancienne"], 120_000, ["ancienne", "nouvelle"]);
    expect(await findKey(team, "nouvelle")).toMatchObject({ kid: "nouvelle" });
    expect(fetches).toHaveLength(1);
    expect(await findKey(team, "nouvelle")).toMatchObject({ kid: "nouvelle" });
    expect(fetches).toHaveLength(1);
  });

  it("ne relit pas la liste plus d'une fois par minute pour une clé inconnue", async () => {
    const { fetches } = setup(["k1"], 5_000, ["k1"]);
    expect(await findKey(team, "inconnue")).toBeUndefined();
    expect(fetches).toHaveLength(0);
  });

  it("lit la liste à la source quand le cache est vide", async () => {
    const { fetches, store } = setup(null, 0, ["k1"]);
    expect(await findKey(team, "k1")).toMatchObject({ kid: "k1" });
    expect(fetches).toHaveLength(1);
    expect(store.size).toBe(1);
  });
});
