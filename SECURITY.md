# Sécurité

memento est un projet personnel. Merci de ne pas signaler une vulnérabilité dans un ticket public.

## Signaler une vulnérabilité

Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Décrivez le problème, comment le reproduire et son effet possible. Je réponds dès que possible, sans délai garanti.

## Périmètre

- Le code de ce dépôt : Worker (contrôle Cloudflare Access, API, collecte), galerie, migrations.
- Hors périmètre : les plateformes elles-mêmes (Bluesky, Mastodon, Reddit), Cloudflare, et les installations d'autres personnes.

## Bonnes pratiques pour une installation

- Ne versionnez jamais `wrangler.jsonc` ni `.dev.vars` (déjà exclus par `.gitignore`) ; les identifiants et secrets vont dans les secrets de Wrangler ou du dépôt.
- Laissez `workers_dev` à `false` et protégez le domaine avec Cloudflare Access : le Worker refuse tout accès tant que `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD` ne sont pas configurés.
- Donnez au jeton de déploiement Cloudflare les seules permissions nécessaires (Workers et D1 sur votre compte).
