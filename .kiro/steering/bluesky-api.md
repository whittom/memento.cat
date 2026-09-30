---
inclusion: fileMatch
fileMatchPattern: "src/connectors/bluesky/**"
---
# API Bluesky (AT Protocol)

Sources officielles : https://docs.bsky.app (référence des points de terminaison) et https://docs.bsky.app/docs/advanced-guides/rate-limits

- Les points de terminaison publics `app.bsky.*` s'appellent sans authentification sur l'AppView publique `https://public.api.bsky.app`.
- Collecte : `app.bsky.feed.getAuthorFeed` avec pagination par `cursor` ; filtrer les réponses (paramètre `filter`) pour ne garder que les publications de l'auteur.
- Profil : `app.bsky.actor.getProfile` ; identifier un créateur par son DID (stable) plutôt que par son handle (modifiable).
- Vérification des suppressions : `app.bsky.feed.getPosts` par lot d'URI ; une URI absente de la réponse est considérée supprimée.
- Médias : conserver le texte alternatif (`alt`) de chaque image comme description du média.
- Respecter les en-têtes de quota renvoyés ; reculer exponentiellement sur HTTP 429.
- Question ouverte Q2 : vérifier dans les conditions développeur de Bluesky si la conservation d'un contenu supprimé est permise avant d'activer le badge « supprimé ».
