import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    // En développement de la galerie seule, l'API est servie par `wrangler dev`.
    proxy: { "/api": "http://localhost:8787" },
  },
});
