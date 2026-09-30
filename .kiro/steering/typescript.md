---
inclusion: fileMatch
fileMatchPattern: ["**/*.ts", "**/*.tsx"]
---
# TypeScript

Règles du projet, alignées sur les exemples TypeScript du guide officiel Cloudflare (voir `cloudflare-workers.md`).

- `tsconfig` en `strict: true` ; pas de `any` implicite ; `unknown` puis validation pour toute donnée externe (réponses d'API).
- Les réponses des plateformes sont validées à l'entrée du connecteur avant d'être converties en `NormalizedPost` ; un champ manquant produit une erreur typée, pas un `undefined` silencieux.
- Gestionnaires Worker typés par `satisfies ExportedHandler<Env>`.
- Fonctions asynchrones : type de retour explicite (`Promise<...>`).
- Erreurs : classes dédiées (`RateLimitError`, `NotFoundError`, `PlatformError`) ; `catch (e)` teste `e instanceof Error`.
- Dates : chaînes ISO 8601 en UTC dans les données ; conversion au fuseau local uniquement dans la galerie.
