import { describe, expect, it } from "vitest";
import { buildWranglerConfig } from "../scripts/wrangler-config.mjs";
import template from "../wrangler.example.jsonc?raw";

const values = {
  D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
  ROUTE_PATTERN: "Memento.Example",
  ACCESS_TEAM_DOMAIN: "equipe.cloudflareaccess.com",
  ACCESS_AUD: "aud-123",
  MASTODON_USER_AGENT: "memento.example (archive personnelle)",
};

/** Le modèle n'a de commentaires qu'en début de ligne : on les retire pour lire le JSON. */
const parse = (jsonc: string): Record<string, unknown> =>
  JSON.parse(jsonc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")) as Record<string, unknown>;

describe("génération de wrangler.jsonc pour le déploiement", () => {
  it("remplit le modèle versionné avec les valeurs de l'installation", () => {
    const config = parse(buildWranglerConfig(template, values));
    expect(config["d1_databases"]).toEqual([expect.objectContaining({ database_id: values.D1_DATABASE_ID, database_name: "memento-db" })]);
    expect(config["routes"]).toEqual([{ pattern: "memento.example", custom_domain: true }]);
    expect(config["workers_dev"]).toBe(false);
    expect(config["vars"]).toMatchObject({
      REQUIRE_ACCESS: "true",
      ACCESS_TEAM_DOMAIN: values.ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: values.ACCESS_AUD,
      MASTODON_USER_AGENT: values.MASTODON_USER_AGENT,
      REDDIT_USER_AGENT: "",
    });
  });

  it("garde la valeur du modèle pour une variable facultative absente", () => {
    const config = parse(buildWranglerConfig(template, { ...values, MASTODON_USER_AGENT: undefined }));
    expect((config["vars"] as Record<string, string>)["MASTODON_USER_AGENT"]).toBe("memento (archive personnelle en lecture seule)");
  });

  it("échappe une valeur qui contient des guillemets", () => {
    const config = parse(buildWranglerConfig(template, { ...values, MASTODON_USER_AGENT: 'nom "entre guillemets"' }));
    expect((config["vars"] as Record<string, string>)["MASTODON_USER_AGENT"]).toBe('nom "entre guillemets"');
  });

  it("refuse une configuration incomplète ou invalide plutôt que de déployer", () => {
    expect(() => buildWranglerConfig(template, { ...values, D1_DATABASE_ID: undefined })).toThrow(/D1_DATABASE_ID/);
    expect(() => buildWranglerConfig(template, { ...values, D1_DATABASE_ID: "pas-un-uuid" })).toThrow(/D1_DATABASE_ID/);
    expect(() => buildWranglerConfig(template, { ...values, ROUTE_PATTERN: "" })).toThrow(/ROUTE_PATTERN/);
    expect(() => buildWranglerConfig(template, { ...values, ROUTE_PATTERN: "https://memento.example/" })).toThrow(/ROUTE_PATTERN/);
    expect(() => buildWranglerConfig(template, { ...values, ACCESS_AUD: undefined })).toThrow(/ACCESS_AUD/);
    expect(() => buildWranglerConfig(template, { ...values, ACCESS_TEAM_DOMAIN: "" })).toThrow(/ACCESS_TEAM_DOMAIN/);
  });

  it("signale un modèle qui a changé de forme", () => {
    expect(() => buildWranglerConfig(template.replace('"<ID_D1>"', '"x"'), values)).toThrow(/ID_D1/);
    expect(() => buildWranglerConfig(template.replace(/\/\/\s*"routes".*\n/, ""), values)).toThrow(/routes/);
    expect(() => buildWranglerConfig(template.replace(/"MASTODON_USER_AGENT".*\n/, ""), values)).toThrow(/MASTODON_USER_AGENT/);
  });
});
