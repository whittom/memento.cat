---
inclusion: always
---
# Structure du projet

```
src/
  index.ts              # export default { fetch, scheduled } satisfies ExportedHandler<Env>
  collect/              # orchestration de la collecte planifiée
  verify/               # vérification des suppressions (à la demande)
  connectors/
    types.ts            # interface Connector, NormalizedPost
    bluesky/
    reddit/
  storage/
    r2.ts               # clés R2, écriture des médias et de post.json
    db.ts               # requêtes D1 (aucun SQL en dehors de ce dossier)
  api/                  # routes /api/*
web/                    # SPA (Vite), compilée vers web/dist
migrations/             # migrations D1 numérotées
test/                   # tests Vitest, miroir de src/
.kiro/                  # steering et specs
```

## Conventions
- Un connecteur par plateforme ; il ne connaît ni D1 ni R2, il renvoie des `NormalizedPost`.
- Identifiant de publication : `<plateforme>:<id natif>` (ex. `reddit:t3_abc123`).
- Clés R2 : `<plateforme>/<créateur>/<AAAA>/<MM>/<AAAA-MM-JJ>_<id>/<fichier>`.
- Noms de fichiers en kebab-case, types en PascalCase, fonctions en camelCase.
- Pas d'import d'un connecteur vers un autre.
