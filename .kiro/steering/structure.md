---
inclusion: always
---
# Structure du projet

```
src/
  index.ts              # export default { fetch, scheduled } satisfies ExportedHandler<Env>
  access/               # contrôle du jeton Cloudflare Access (et cache des clés)
  collect/              # collecte d'un créateur (collectCreator), planifiée et manuelle ; archivage d'une publication
  verify/               # vérification des suppressions (à la demande)
  purge/                # suppression physique par lots
  connectors/
    types.ts            # interface Connector, NormalizedPost
    ratelimit.ts        # lecture des en-têtes de quota, commune aux plateformes
    bluesky/
    mastodon/
    reddit/
  storage/
    keys.ts             # clés R2 et extensions
    r2.ts               # écriture des médias (en flux) et de post.json
    db.ts               # requêtes D1 (aucun SQL en dehors de ce fichier)
  api/                  # routes /api/*, présentation, reconstruction de l'index
  lib/                  # budget, configuration, erreurs, journaux, lecture JSON
web/                    # SPA (Vite), compilée vers web/dist
  src/views/            # galerie, créateurs, visionneuse
  src/zoom.ts           # calculs de la loupe (purs, testés)
migrations/             # migrations D1 numérotées
test/                   # tests Vitest (un fichier par domaine : connecteurs, stockage, accès, collecte, loupe)
.kiro/                  # steering et specs
```

## Conventions
- Un connecteur par plateforme ; il ne connaît ni D1 ni R2, il renvoie des `NormalizedPost`.
- Identifiant de publication : `<plateforme>:<id natif>` (ex. `reddit:t3_abc123` ; pour Mastodon, l'id natif inclut le serveur : `mastodon:<serveur>:<id>`).
- Clés R2 : `<plateforme>/<créateur>/<AAAA>/<MM>/<AAAA-MM-JJ>_<id>/<fichier>`.
- Noms de fichiers en kebab-case, types en PascalCase, fonctions en camelCase.
- Pas d'import d'un connecteur vers un autre.
