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
- Écarter les republications (`reason`), les publications d'un autre auteur et les citations pures d'un autre compte (`app.bsky.embed.record#view`) ; archiver l'image d'origine (blob du PDS de l'auteur) plutôt que la version du CDN.
- Question ouverte Q2 : vérifier dans les conditions développeur de Bluesky si la conservation d'un contenu supprimé est permise. Le badge « supprimé » est actif, avec copie conservée, en attendant cette vérification.
