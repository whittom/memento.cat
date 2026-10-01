---
inclusion: fileMatch
fileMatchPattern: ["src/**/*.ts", "wrangler.jsonc"]
---
# Cloudflare Workers

Source officielle : https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ (consultée le 2026-09-27). Relire cette page avant de modifier ce fichier.

## Configuration
- `compatibility_date` = date du jour à la création, mise à jour périodiquement ; activer `nodejs_compat`.
- Ne jamais écrire `Env` à la main : `npx wrangler types` après tout ajout ou renommage de liaison.
- Secrets via `wrangler secret put` ; en local, fichier `.dev.vars` (modèle : `.dev.vars.example`) listé dans `.gitignore`. Ses valeurs remplacent celles de `vars` en local (vérifié le 2026-10-01 : `REQUIRE_ACCESS=false` y désactive bien le contrôle d'accès).
- Environnements Wrangler : les liaisons ne sont pas héritées, les déclarer par environnement.

## Architecture
- Accéder à R2 et D1 par liaisons (`env.MEDIA`, `env.DB`), jamais par l'API REST de Cloudflare.
- Servir la SPA avec Workers Static Assets (recommandé plutôt que Pages pour un nouveau projet).
- Travail en arrière-plan : `ctx.waitUntil()` uniquement pour ce qui n'affecte pas la réponse ; ne pas déstructurer `ctx`.

## Requêtes et réponses
- Diffuser (stream) les corps volumineux : un média va de la plateforme vers R2 sans `arrayBuffer()` complet quand c'est possible ; limite mémoire 128 Mo.
- Fixer une taille maximale avant de lire un corps entier.

## Code
- Aucun état propre à une requête dans une variable de module.
- Toute promesse est `await`, retournée ou passée à `ctx.waitUntil()`.
- `try/catch` explicite avec réponse structurée ; pas de `passThroughOnException()`.
- `crypto.randomUUID()` / `crypto.getRandomValues()`, jamais `Math.random()` pour un identifiant.

## Observabilité
- `observability.enabled = true` dans `wrangler.jsonc`.
- Journaux JSON structurés : `console.log(JSON.stringify({ message, ... }))`, `console.error` pour les erreurs.

## Tests
- `@cloudflare/vitest-plugin` (tests dans le runtime Workers, liaisons réelles).
- Le plugin injecte `nodejs_compat` : vérifier que `wrangler.jsonc` l'active aussi.
