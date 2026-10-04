import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Version affichée dans le pied de page : APP_VERSION si fournie (étiquette déployée, voir deploy.yml),
 * sinon celle de package.json, suivie du commit court quand il est connu (GITHUB_SHA).
 */
function appVersion(): string {
  const fromEnv = process.env["APP_VERSION"]?.trim();
  if (fromEnv) return fromEnv;
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const sha = process.env["GITHUB_SHA"]?.slice(0, 7);
  return `v${pkg.version}${sha ? `+${sha}` : ""}`;
}

const version = (): Plugin => ({
  name: "memento-version",
  transformIndexHtml: (html) => html.replaceAll("%APP_VERSION%", appVersion().replace(/[<>&"]/g, "")),
});

export default defineConfig({
  root,
  plugins: [version()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // En développement de la galerie seule, l'API est servie par `wrangler dev`.
    proxy: { "/api": "http://localhost:8787" },
  },
});
