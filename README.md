# memento

Archive personnelle des publications de créateurs suivis sur Bluesky, Mastodon et Reddit, avec une galerie de consultation monopage et adaptative. Le tout tourne dans un seul Cloudflare Worker (plan gratuit), avec D1 pour l'index et R2 pour les médias.

## Une alternative simple au doomscrolling

memento est aussi une façon plus calme de suivre ce que publient des gens qu'on aime lire, sans passer par les fils des réseaux sociaux et leur défilement sans fin (le « doomscrolling », ce défilement anxiogène qui retient l'attention). Il n'y a ici que les créateurs que vous avez choisis, leurs contributions originales avec médias (ni commentaires, ni republications, ni citations), aucun compteur de mentions « j'aime » ou de partages, aucune recommandation, aucune notification et aucune lecture automatique des vidéos. Les médias non consultés sont signalés et le bouton « Non consultés seulement » les isole : quand il n'y en a plus, c'est fini. Le détail de ces principes est dans `.kiro/steering/product.md`.

La démarche est pilotée par spécifications (format Kiro) :

- `.kiro/steering/` : contexte permanent et règles par technologie, tirées des guides officiels ;
- `.kiro/specs/archivage-createurs/` : exigences (EARS), conception et plan de réalisation.

Toute modification de comportement commence par la spec. Chaque livraison porte une étiquette Git (`v0.1`, puis `v0.1.1`, `v0.1.2`, etc. ; voir l'en-tête de `tasks.md`).

## Prérequis

- Node.js 22.12 ou plus récent (exigé par Wrangler 4 et Vitest 5)
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
6. **Déployer** : `npm run deploy` (compile la galerie, puis publie le Worker ; `npx wrangler deploy` seul publierait une galerie périmée).

Ajoutez ensuite vos créateurs depuis la page « Créateurs » de la galerie : la liste vit dans D1, jamais dans le dépôt.

**Mise à jour** : après avoir récupéré une nouvelle version du code, appliquez d'abord les nouvelles migrations (`npm run db:migrate`), puis `npm run deploy`.

Renseignez aussi `MASTODON_USER_AGENT` : un nom qui désigne votre installation auprès des administrateurs des serveurs Mastodon (par exemple `monsite.exemple (archive personnelle en lecture seule)`). La valeur par défaut est neutre.

Plutôt que de remplir `wrangler.jsonc` à la main, vous pouvez le générer à partir du modèle, avec le même script que le déploiement automatique :

```sh
D1_DATABASE_ID=<uuid> ROUTE_PATTERN=monsite.exemple ACCESS_TEAM_DOMAIN=<équipe>.cloudflareaccess.com \
ACCESS_AUD=<aud> MASTODON_USER_AGENT="monsite.exemple (archive personnelle en lecture seule)" \
node scripts/wrangler-config.mjs
```

### Déploiement automatique depuis GitHub

Deux workflows GitHub Actions. `.github/workflows/verify.yml` vérifie chaque pull request (y compris celles de Dependabot) et chaque envoi sur `main` : typecheck, lint, tests, compilation de la galerie et `npm audit` ; il n'utilise aucun secret et ne déploie rien. Le workflow `.github/workflows/deploy.yml` vérifie le code (typecheck, lint, tests), génère `wrangler.jsonc`, applique les migrations D1, puis déploie. Il se lance à chaque étiquette de version poussée (`git tag -a v0.1.15 -m "…" && git push origin v0.1.15`), ou à la main depuis l'onglet **Actions**. Rien de propre à votre installation n'est versionné : tout vient des secrets du dépôt (**Settings → Secrets and variables → Actions**).

| Secret | Contenu |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Jeton d'API Cloudflare (modèle « Edit Cloudflare Workers », plus la permission **D1 : Edit** pour les migrations), limité à votre compte |
| `CLOUDFLARE_ACCOUNT_ID` | Identifiant du compte Cloudflare |
| `D1_DATABASE_ID` | Identifiant de la base `memento-db` |
| `ROUTE_PATTERN` | Domaine personnalisé (par exemple `monsite.exemple`) |
| `ACCESS_TEAM_DOMAIN` | `<équipe>.cloudflareaccess.com` |
| `ACCESS_AUD` | Identifiant d'audience (AUD) de l'application Access |
| `MASTODON_USER_AGENT` | Facultatif : nom de votre installation auprès des serveurs Mastodon |
| `REDDIT_USER_AGENT` | Facultatif, après approbation de Reddit |

Les secrets ne sont transmis qu'aux étapes qui en ont besoin, jamais à l'installation des dépendances ni aux tests. Si une valeur obligatoire manque ou si le modèle a changé de forme, la génération échoue et rien n'est déployé. Les secrets Reddit du Worker (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`) restent gérés par `wrangler secret put` : le déploiement ne les touche pas.

## Plateformes prises en charge

| Plateforme | Identifiant à saisir | Accès |
| --- | --- | --- |
| Bluesky | `nom.bsky.social` | API publique, sans configuration |
| Mastodon (et compatibles, comme Pixelfed) | `nom@serveur.social` | API publique du serveur du créateur, sans compte ni clé |
| Reddit | nom d'utilisateur | OAuth, après approbation de Reddit (voir plus bas) |

- **Mastodon** : seuls les messages avec images, vidéos ou GIF du créateur sont archivés, sans republications ni réponses à d'autres comptes. Un serveur qui exige une connexion pour lire les profils ne peut pas être suivi. Les messages supprimés gardent leur copie avec le statut « supprimé » (question ouverte Q5 de la spec).
- Aucune configuration de secret n'est nécessaire pour Bluesky et Mastodon.

## Médias identiques

Quand un créateur republie une image déjà archivée (même adresse, ou même fichier sous une autre adresse), memento ne la stocke pas une seconde fois : le média est relié à l'original et sert son fichier. La galerie marque « Doublon » les publications faites uniquement de doublons, signale le lien dans la visionneuse, et le bouton « Masquer les doublons » les retire de la liste. Les doublons ne comptent pas parmi les médias non consultés. La reconnaissance est exacte : une image recompressée ou redimensionnée n'est pas reconnue (la reconnaissance visuelle de memento-local exige un module natif qu'un Worker ne peut pas exécuter).

Pour relier les doublons archivés avant cette fonction, ouvrir la galerie, puis la console des outils de développement :

```js
// Simulation : doublons trouvés, octets libérables, exemples. Rien n'est écrit.
await (await fetch("/api/admin/dedupe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
// Application, par lots de 8, jusqu'à la fin.
for (let r; !r || r.remaining > 0; ) {
  r = await (await fetch("/api/admin/dedupe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: true }) })).json();
  console.log(r);
  if (r.linked === 0) break;
}
```

Ajouter `"creator": "<id>"` au corps pour se limiter à un créateur. Une sauvegarde (rclone, ci-dessous) est conseillée avant l'application.

## Miniatures

Quand une plateforme ne fournit pas de miniature (images Reddit, par exemple), memento en fabrique une à l'archivage : l'image réduite à 480 px au plus, en WebP, rangée à côté de l'original (`media_NN.thumb.webp`). La galerie charge cette miniature dans les tuiles et ne charge l'original que dans la visionneuse. Elle est fabriquée par la liaison Cloudflare Images (`images` dans `wrangler.example.jsonc`) : aucun réglage de zone, 5 000 transformations uniques gratuites par mois. Au-delà, ou pour une image de plus de 20 Mo, l'image reste sans miniature et la tuile charge l'original. Les images archivées avant cette fonction ne reçoivent pas de miniature.

## Synchronisation manuelle

En plus de la collecte planifiée (toutes les 15 minutes), le bouton **Synchroniser maintenant** de la page « Créateurs » collecte un seul créateur actif sans attendre le prochain passage. Il suit les mêmes règles que la collecte planifiée (curseur, budget de sous-requêtes, quotas, aucun doublon) et enchaîne les appels avec la progression affichée, jusqu'à ce que le curseur soit rejoint.

- Le bouton n'apparaît que pour un créateur actif : réactivez d'abord un créateur désactivé, ou restaurez-le depuis la corbeille.
- Comme la collecte planifiée, il ne rapatrie pas l'historique antérieur au curseur (voir « Limites connues »). Au premier passage d'un nouveau créateur, seule la page la plus récente est archivée.
- En cas d'erreur ou d'interruption (quota, budget), le curseur est conservé : relancez pour reprendre.
- API : `POST /api/creators/:id/sync` (corps JSON, même vide) renvoie `{ "archived": <n>, "done": <booléen> }`.

## Limites du plan gratuit

Chaque invocation est limitée à 50 sous-requêtes externes, 50 requêtes D1 et 10 ms de processeur. La collecte tourne donc toutes les 15 minutes, par petits lots, et s'arrête d'elle-même avant la limite pour reprendre au passage suivant. Selon le nombre de médias par publication, comptez quelques publications par passage, soit quelques centaines par jour.

Sur Workers Paid, augmentez `MAX_SUBREQUESTS_PER_RUN` et `MAX_QUERIES_PER_RUN`. En cas d'erreur « Exceeded CPU Limit » dans les journaux, c'est le signe qu'il faut passer au plan payant ou réduire ces valeurs.

R2 offre 10 Go gratuits : les vidéos les consomment vite. `MAX_MEDIA_BYTES` (100 Mo par défaut) fixe la taille au-delà de laquelle un média n'est pas téléchargé ; il reste alors consultable par son lien d'origine.

## Limites connues

- Les vidéos Reddit sont archivées sans le son (Reddit sert la piste audio séparément).
- Au premier passage, seule la page la plus récente de chaque créateur est archivée ; l'historique plus ancien n'est pas rapatrié, ni par la collecte planifiée ni par la synchronisation manuelle.
- Une publication Bluesky antidatée (date de création antérieure au curseur) peut être ignorée.
- Contenus supprimés à la source : Bluesky et Mastodon gardent la copie, avec le statut « supprimé » (usage personnel ; questions Q2 et Q5 de la spec). Reddit : la publication est effacée définitivement (fichiers et index) quand la vérification des suppressions la constate. Cette vérification reste à la demande : lancez-la régulièrement sur vos créateurs Reddit, car Reddit recommande de supprimer les contenus retirés sous 48 heures.
- Quand un serveur Mastodon signale son quota atteint, la collecte suspend tous les créateurs Mastodon jusqu'au passage suivant, même ceux d'autres serveurs.
- Les publications qui ne contiennent que du texte ne sont pas archivées, quelle que soit la plateforme (exigence 2.3c).

## Sauvegarde et exportation

R2 est compatible S3. Créez un jeton d'API R2 en lecture seule (tableau de bord R2, « Manage API tokens »), puis synchronisez l'archive complète (médias et `post.json`) avec [rclone](https://rclone.org) :

```sh
rclone config create r2 s3 provider=Cloudflare access_key_id=<ID> secret_access_key=<SECRET> endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
rclone sync r2:memento-media ./memento-archive --progress
```

Si l'index D1 est perdu, il se reconstruit à partir des `post.json` : appeler `POST /api/admin/reindex` avec `{}`, puis avec le `cursor` renvoyé, jusqu'à obtenir `"cursor": null`. Les créateurs recréés arrivent à l'état « désactivé ».

## Structure

```
src/                Worker : collecte, connecteurs, stockage, API, contrôle d'accès
web/                Galerie (SPA TypeScript, Vite)
migrations/         Schéma D1
scripts/            Génération de wrangler.jsonc à partir du modèle
test/               Tests unitaires
.github/workflows/  Déploiement automatique sur Cloudflare
.kiro/              Steering et spec
```

## Usage responsable

memento archive des publications d'autres personnes, pour un usage personnel. Si vous l'installez :

- respectez les conditions de chaque plateforme (en particulier Reddit, qui exige une approbation préalable de l'accès à son API et l'effacement des contenus supprimés) ;
- respectez les droits des auteurs : l'archive reste privée, protégée par Cloudflare Access, et n'est jamais republiée ;
- identifiez honnêtement votre installation (`MASTODON_USER_AGENT`, `REDDIT_USER_AGENT`).

Ce dépôt ne contient aucune donnée archivée. Il est fourni tel quel, sans garantie.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md) : l'usage, la modification et le partage sont permis à des fins non commerciales (usage personnel, recherche, organismes sans but lucratif, etc.). Tout usage commercial demande une licence distincte : contactez l'auteur par son profil GitHub.

Les dépendances gardent leur propre licence (MIT ou Apache-2.0), et les polices Archivo et JetBrains Mono, chargées depuis Google Fonts, sont sous licence SIL Open Font License.
