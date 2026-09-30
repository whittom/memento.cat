import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { assertAccess } from "../src/access";
import type { Config } from "../src/lib/config";

const subtle = webcrypto.subtle;
const team = "equipe.cloudflareaccess.com";
const aud = "aud-memento";
const config: Config = {
  requireAccess: true, accessTeamDomain: team, accessAud: aud,
  maxSubrequestsPerRun: 45, maxQueriesPerRun: 40, maxPagesPerCreator: 3, maxMediaBytes: 1, rateLimitFloor: 10, redditUserAgent: "",
};

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
const finder = (_t: string, kid: string | undefined) => Promise.resolve(kid === "k1" ? publicJwk : undefined);

const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? Buffer.from(b) : b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function token(payload: Record<string, unknown>, kid = "k1"): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", kid }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const valid = () => ({ aud: [aud], iss: `https://${team}`, exp: Math.floor(Date.now() / 1000) + 600 });
const req = (t?: string) => new Request("https://memento.example/", { headers: t ? { "cf-access-jwt-assertion": t } : {} });

beforeAll(async () => {
  const pair = await subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = await subtle.exportKey("jwk", pair.publicKey);
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
