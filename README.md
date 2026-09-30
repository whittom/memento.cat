# memento

Archive personnelle des publications de créateurs suivis sur Bluesky et Reddit, avec une galerie de consultation monopage et adaptative. Le tout tourne dans un seul Cloudflare Worker (plan gratuit), avec D1 pour l'index et R2 pour les médias.

La démarche est pilotée par spécifications (format Kiro) :

- `.kiro/steering/` : contexte permanent et règles par technologie, tirées des guides officiels ;
- `.kiro/specs/archivage-createurs/` : exigences (EARS), conception et plan de réalisation.

Toute modification de comportement commence par la spec. Une étiquette Git clôt chaque phase du plan.

## Prérequis

- Node.js 20 ou plus récent
- Un compte Cloudflare (le plan gratuit suffit)
- Pour Reddit seulement : une application OAuth approuvée par Reddit (voir `.kiro/steering/reddit-api.md`)

## Démarrer en local

```sh
npm install
cp wrangler.example.jsonc wrangler.jsonc   # l'identifiant D1 n'est pas nécessaire en local
cp .dev.vars.example .dev.vars              # REQUIRE_ACCESS=false en local
npm run db:migrate:local
npm run dev                                  # galerie et API sur http://localhost:8787
```

Pour déclencher une collecte à la main : `npx wrangler dev --test-scheduled`, puis ouvrir `http://localhost:8787/cdn-cgi/handler/scheduled`.

Le même code tourne ainsi sur un ordinateur portable, avec D1 et R2 émulés sur le disque (dossier `.wrangler/`). Un portable éteint ne perd rien : la collecte suivante reprend au curseur de chaque créateur.

## Vérifier

```sh
npm run typecheck
npm run lint
npm test
```

## Déployer sur Cloudflare

1. **Créer les ressources.**
   ```sh
   npx wrangler login
   npx wrangler d1 create memento-db     # reporter l'identifiant dans wrangler.jsonc
   npx wrangler r2 bucket create memento-media
   ```
2. **Configurer `wrangler.jsonc`** (non versionné) : identifiant D1, puis décommenter la route de votre domaine personnalisé (`routes`). `workers_dev` reste à `false`, pour qu'aucune adresse ne contourne Cloudflare Access.
3. **Appliquer le schéma** : `npm run db:migrate`
4. **Protéger avec Cloudflare Access.** Dans Zero Trust, créer une application auto-hébergée pour votre domaine, avec une politique qui n'autorise que votre adresse courriel. Reporter dans `wrangler.jsonc` :
   - `ACCESS_TEAM_DOMAIN` : `<équipe>.cloudflareaccess.com`
   - `ACCESS_AUD` : l'identifiant d'audience (AUD) de l'application

   Le Worker vérifie lui-même le jeton sur chaque requête. Si ces deux valeurs manquent, il refuse tout (erreur 500) plutôt que d'ouvrir l'accès.
5. **Reddit (après approbation seulement).**
   ```sh
   npx wrangler secret put REDDIT_CLIENT_ID
   npx wrangler secret put REDDIT_CLIENT_SECRET
   ```
   Renseigner aussi `REDDIT_USER_AGENT` au format `<plateforme>:<id app>:<version> (by /u/<utilisateur>)`.
6. **Déployer** : `npm run deploy`

Ajoutez ensuite vos créateurs depuis la page « Créateurs » de la galerie : la liste vit dans D1, jamais dans le dépôt.

### Déploiement automatique depuis GitHub (optionnel)

Les jetons vont dans les secrets du dépôt GitHub (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), jamais dans le code. `wrangler.jsonc` n'étant pas versionné, l'intégration doit le générer à partir de `wrangler.example.jsonc` et de variables du dépôt.

## Limites du plan gratuit

Chaque invocation est limitée à 50 sous-requêtes externes, 50 requêtes D1 et 10 ms de processeur. La collecte tourne donc toutes les 15 minutes, par petits lots, et s'arrête d'elle-même avant la limite pour reprendre au passage suivant. Selon le nombre de médias par publication, comptez quelques publications par passage, soit quelques centaines par jour.

Sur Workers Paid, augmentez `MAX_SUBREQUESTS_PER_RUN` et `MAX_QUERIES_PER_RUN`. En cas d'erreur « Exceeded CPU Limit » dans les journaux, c'est le signe qu'il faut passer au plan payant ou réduire ces valeurs.

R2 offre 10 Go gratuits : les vidéos les consomment vite. `MAX_MEDIA_BYTES` (100 Mo par défaut) fixe la taille au-delà de laquelle un média n'est pas téléchargé ; il reste alors consultable par son lien d'origine.

## Limites connues

- Les vidéos Reddit sont archivées sans le son (Reddit sert la piste audio séparément).
- Au premier passage, seule la page la plus récente de chaque créateur est archivée ; l'historique plus ancien n'est pas rapatrié.
- Une publication Bluesky antidatée (date de création antérieure au curseur) peut être ignorée.
- Pas de purge automatique des contenus supprimés par leurs auteurs (décision de projet). Voir l'écart documenté avec les conditions de Reddit dans la spec.

## Sauvegarde et exportation

R2 est compatible S3. Créez un jeton d'API R2 en lecture seule (tableau de bord R2, « Manage API tokens »), puis synchronisez l'archive complète (médias et `post.json`) avec [rclone](https://rclone.org) :

```sh
rclone config create r2 s3 provider=Cloudflare access_key_id=<ID> secret_access_key=<SECRET> endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
rclone sync r2:memento-media ./memento-archive --progress
```

Si l'index D1 est perdu, il se reconstruit à partir des `post.json` : appeler `POST /api/admin/reindex` avec `{}`, puis avec le `cursor` renvoyé, jusqu'à obtenir `"cursor": null`. Les créateurs recréés arrivent à l'état « désactivé ».

## Structure

```
src/            Worker : collecte, connecteurs, stockage, API, contrôle d'accès
web/            Galerie (SPA TypeScript, Vite)
migrations/     Schéma D1
test/           Tests unitaires
.kiro/          Steering et spec
```
