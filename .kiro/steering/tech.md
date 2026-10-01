---
inclusion: always
---
# Technologie

## Pile
- Langage : TypeScript (mode `strict`) partout, côté Worker comme côté galerie.
- Exécution : un Cloudflare Worker unique avec trois points d'entrée : `scheduled()` (collecte), `fetch()` pour `/api/*`, et Workers Static Assets pour la galerie.
- Données : D1 (index SQLite), R2 (médias et `post.json`).
- Galerie : SPA TypeScript construite avec Vite, servie par Workers Static Assets.
- Tests : Vitest (modules purs) ; intégration dans le runtime Workers avec `@cloudflare/vitest-pool-workers` (à venir).
- Qualité : ESLint avec `@typescript-eslint/no-floating-promises` en erreur.
- Accès : galerie et API protégées par Cloudflare Access.

## Commandes
- `npx wrangler dev` : exécution locale (D1 et R2 émulés localement, sert aussi d'option d'hébergement sur un portable).
- `npx wrangler types` : régénère `Env` après tout changement de liaison.
- `npm run db:migrate` (`--remote`) et `npm run db:migrate:local` : migrations de schéma (`wrangler d1 migrations apply memento-db`).
- `npm run typecheck`, `npm run lint`, `npm test` : vérifications, toutes attendues sans erreur.
- `npm run build:web` : compilation de la galerie vers `web/dist`.
- `npm run deploy` : compile la galerie puis déploie (`wrangler deploy` seul publierait une galerie périmée).

## Contraintes du plan gratuit
- 5 déclencheurs Cron par compte : un seul déclencheur pour tout le projet, toutes les 15 minutes.
- Par invocation : 50 sous-requêtes externes, 50 requêtes D1, 10 ms de processeur. Tout traitement répétitif passe par `Budget` / `countingDb` et par petits lots.
- R2 : 10 Go gratuits ; surveiller le volume vidéo.
- Secrets (identifiants Reddit) uniquement via `wrangler secret put`, jamais dans le dépôt.
