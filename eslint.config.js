import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["web/dist/**", "worker-configuration.d.ts", "node_modules/**", ".wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./web/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Recommandation Cloudflare : aucune promesse flottante.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  {
    files: ["**/*.config.ts", "eslint.config.js", "test/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
