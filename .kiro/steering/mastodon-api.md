---
inclusion: fileMatch
fileMatchPattern: "src/connectors/mastodon/**"
---
# API Mastodon (et serveurs compatibles)

Sources officielles : https://docs.joinmastodon.org/methods/accounts/ , https://docs.joinmastodon.org/methods/statuses/ , https://docs.joinmastodon.org/api/rate-limits/ . Ces pages n'ont pas été relues en détail ; le comportement ci-dessous a été vérifié directement sur `mastodon.social` le 2026-10-01 (lecture sans authentification, en-têtes de quota, forme des pièces jointes).

- Il n'y a pas d'API centrale : chaque serveur expose la sienne. Un créateur s'écrit `nom@serveur` et on interroge le serveur du créateur, jamais un autre.
- Lecture seule et sans authentification : `GET /api/v1/accounts/lookup?acct=<nom>` (identifiant numérique du compte) puis `GET /api/v1/accounts/:id/statuses` avec `only_media=true`, `exclude_reblogs=true`, `exclude_replies=true` et `limit`. La pagination se fait par `max_id` (identifiant du dernier message reçu, les identifiants sont ordonnés dans le temps).
- Certains serveurs exigent une connexion pour lire les profils (réponse 401 ou 403) : refuser avec un message explicite, ne jamais contourner.
- Quota : `X-RateLimit-Remaining` (nombre) et `X-RateLimit-Reset` (horodatage ISO 8601, pas un nombre de secondes). Valeur courante : 300 requêtes par 5 minutes et par adresse IP, variable selon le serveur. Réagir à HTTP 429.
- Pièces jointes (`media_attachments`) : `type` vaut `image`, `video`, `gifv` (boucle sans son, en MP4), `audio` ou `unknown`. `url` est le fichier d'origine, `preview_url` la miniature, `meta.original` et `meta.small` donnent les dimensions, `description` le texte alternatif. Ignorer `audio` et `unknown`.
- Contenu : `content` est du HTML ; le convertir en texte brut. `spoiler_text` (avertissement de contenu) sert de titre.
- Vérification des suppressions : `GET /api/v1/statuses/:id` ; 404 ou 410 signifie supprimé. Une autre erreur (401, 403, 5xx) ne dit rien : ne pas changer le statut.
- Le nom de serveur vient de l'utilisateur : le valider (nom d'hôte public, HTTPS, pas d'adresse IP, de port ni de nom local) avant tout appel.
- Envoyer un User-Agent identifiable pour que les administrateurs puissent joindre ou bloquer proprement.
- Question ouverte Q5 : conservation des publications supprimées (voir `requirements.md`).
