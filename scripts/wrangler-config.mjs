// Génère wrangler.jsonc (non versionné) à partir de wrangler.example.jsonc (versionné) et de valeurs
// propres à une installation, lues dans l'environnement. Sert au déploiement automatique (GitHub Actions)
// et peut servir en local : le modèle reste la seule source de la structure, seules les valeurs
// propres à l'installation (identifiant D1, domaine, Access, User-Agent) viennent de l'extérieur.
//
// Usage : D1_DATABASE_ID=... ROUTE_PATTERN=memento.example ACCESS_TEAM_DOMAIN=... ACCESS_AUD=... \
//         node scripts/wrangler-config.mjs [modèle] [sortie]

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Variables (bloc "vars") qu'une installation peut fixer ; absentes, la valeur du modèle est gardée. */
export const OPTIONAL_VARS = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "REDDIT_USER_AGENT", "MASTODON_USER_AGENT"];

const ROUTE_LINE = /^(\s*)\/\/\s*"routes":.*$/m;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Remplit le modèle. Lève une erreur si une valeur attendue manque ou si le modèle a changé de forme
 * (marqueur introuvable) : mieux vaut un déploiement refusé qu'une configuration incomplète.
 * @param {string} template contenu de wrangler.example.jsonc
 * @param {Record<string, string | undefined>} values D1_DATABASE_ID et ROUTE_PATTERN obligatoires, OPTIONAL_VARS facultatives
 * @returns {string} contenu de wrangler.jsonc
 */
export function buildWranglerConfig(template, values) {
  const id = values.D1_DATABASE_ID?.trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("D1_DATABASE_ID manquant ou invalide (UUID attendu)");
  const route = values.ROUTE_PATTERN?.trim().toLowerCase();
  if (!route || !HOSTNAME.test(route)) throw new Error("ROUTE_PATTERN manquant ou invalide (nom d'hôte attendu, par exemple memento.example)");

  if (!template.includes('"<ID_D1>"')) throw new Error("Marqueur <ID_D1> introuvable dans le modèle");
  let out = template.replace('"<ID_D1>"', JSON.stringify(id));

  if (!ROUTE_LINE.test(out)) throw new Error("Ligne « routes » commentée introuvable dans le modèle");
  out = out.replace(ROUTE_LINE, (_line, indent) => `${indent}"routes": [{ "pattern": ${JSON.stringify(route)}, "custom_domain": true }],`);

  for (const name of OPTIONAL_VARS) {
    const value = values[name];
    if (value === undefined || value === "") continue;
    const field = new RegExp(`("${name}":\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    if (!field.test(out)) throw new Error(`Variable ${name} introuvable dans le modèle`);
    out = out.replace(field, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
  }

  // Une installation déployée doit protéger l'accès : sans ces deux valeurs, le Worker refuserait tout.
  for (const name of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"]) {
    if (!values[name]) throw new Error(`${name} manquant : le déploiement exige Cloudflare Access`);
  }
  return `// Fichier généré par scripts/wrangler-config.mjs à partir de wrangler.example.jsonc : ne pas modifier à la main.\n${out}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [templatePath = "wrangler.example.jsonc", outputPath = "wrangler.jsonc"] = process.argv.slice(2);
  try {
    writeFileSync(outputPath, buildWranglerConfig(readFileSync(templatePath, "utf8"), process.env), "utf8");
    console.log(`${outputPath} généré à partir de ${templatePath}`);
  } catch (e) {
    console.error(`Configuration non générée : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
