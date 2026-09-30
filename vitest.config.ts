import { defineConfig } from "vitest/config";

// Tests unitaires des modules purs (correspondances, clés, quotas, curseurs).
// Les tests d'intégration dans le runtime Workers (D1 et R2 réels) passent par
// @cloudflare/vitest-pool-workers : voir la tâche correspondante dans tasks.md.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
