# Plan de réalisation

Chaque tâche renvoie aux exigences de `requirements.md`. Les étiquettes `v0.N` nommées par phase ci-dessous étaient le plan initial ; le dépôt a en pratique été livré d'un bloc en `v0.1` (2026-09-30), puis versionné par incréments `v0.1.x` (`v0.1.1` synchronisation manuelle, `v0.1.2` citations Bluesky, `v0.1.3` refonte visuelle). `v1.0` est réservé à la fin de la phase 6.

## Phase 0 — Préalables
- [x] 0.1 Pousser le dépôt Git sur GitHub.
- [x] 0.2 Créer le compte Cloudflare, le bucket R2 `memento-media` et la base D1 `memento-db`.
- [ ] 0.3 Déposer la demande d'accès à l'API Reddit (délai inconnu : à lancer dès maintenant). Brouillon prêt dans `docs/reddit-access-request.md`, non envoyé. _Exig. 6.4_
- [x] 0.4 Trancher Q1 : Reddit conservé, sans purge en v1 (décision remplacée le 2026-10-01 : voir 4.4).
- [x] 0.5 Ajouter `.gitignore` (`wrangler.jsonc`, `.dev.vars`, `.env`, `node_modules`, `dist`) et `wrangler.example.jsonc`. _Exig. 8.2_

## Phase 1 — Socle technique → `v0.1`
- [x] 1.1 Initialiser le Worker TypeScript (`wrangler.jsonc`, `compatibility_date` du jour, `nodejs_compat`, observabilité).
- [x] 1.2 Liaisons D1 et R2, `wrangler types`, ESLint (`no-floating-promises`), Vitest (tests unitaires).
- [ ] 1.7 Tests d'intégration dans le runtime Workers (`@cloudflare/vitest-pool-workers`, D1 et R2 réels).
- [x] 1.3 Migration D1 initiale ; valider FTS5. _Exig. 3_
- [x] 1.4 Module `storage/` : clés R2, écriture diffusée des médias, empreinte MD5 calculée par R2 (un SHA-256 dans le Worker dépasserait la limite de temps processeur), `post.json`, insertion idempotente. _Exig. 3.1–3.3, 2.4_
- [x] 1.6 Archivage des miniatures fournies par les plateformes et des dimensions. _Exig. 3.5_
- [x] 1.5 Script de reconstruction de l'index depuis `post.json`. _Exig. 3.4_

- [x] 1.8 Archiver les originaux des images Bluesky (blob du PDS de l'auteur) au lieu du WebP recompressé du CDN ; miniatures inchangées. _Exig. 3.2_
- [x] 1.9 Migrer les images Bluesky déjà archivées en WebP vers leurs originaux (opération ponctuelle, faite le 2026-10-01 : 65 images, 41,8 Mo, miniatures conservées). _Exig. 3.2_

## Phase 2 — Connecteur Bluesky et collecte → `v0.2`
- [x] 2.1 `connectors/types.ts` et limiteur de quota générique. _Exig. 2.6_
- [x] 2.2 Connecteur Bluesky : `resolveCreator`, `fetchSince` (sans réponses), extraction des `alt`. _Exig. 1.1, 2.2, 2.3_
- [x] 2.3 Orchestration `scheduled()` : un créateur en échec n'arrête pas les autres ; curseur mis à jour après succès. _Exig. 2.1, 2.5, 2.7_
- [x] 2.4 Déclencheur Cron (toutes les 15 minutes, petits lots) ; essai en local avec `wrangler dev`. _Exig. 7.1_

## Phase 3 — API et galerie → `v0.3`
- [x] 3.1 Routes créateurs : liste, ajout, désactivation et réactivation. _Exig. 1.1–1.3_
- [x] 3.2 Suppression logique, corbeille et restauration ; exclusion des créateurs supprimés dans toutes les requêtes. _Exig. 1.4–1.6_
- [x] 3.3 Suppression physique par lots avec état `purging`, reprise après interruption, statistiques avant confirmation. _Exig. 1.7–1.10_
- [x] 3.4 Écran de gestion des créateurs dans la galerie, confirmation par saisie du nom. _Exig. 1, 8.1_
- [x] 3.5 Routes publications (filtres, recherche, pagination par curseur) et diffusion des médias. _Exig. 4.3–4.5_
- [x] 3.6 SPA : liste filtrable, fiche créateur, fiche publication ; URL synchronisée avec les filtres. _Exig. 4.1_
- [x] 3.7 Mise en page adaptative, contrôlée à 375, 768 et 1280 px. _Exig. 4.2_
- [x] 3.8 Grille de miniatures, tuiles simples et tuiles de groupe. _Exig. 4.8, 4.11, 4.17_
- [x] 3.9 Visionneuse : version complète, navigation dans le groupe, clavier et balayage, état dans l'URL. _Exig. 4.9, 4.10, 4.18_
- [x] 3.10 Consultation : marquage automatique, indicateurs consulté / non consulté / partiel, marquage manuel, filtre « non consultés », compteurs par créateur. _Exig. 4.12–4.16, 4.19_

- [x] 3.11 Synchronisation manuelle d'un créateur : `collectCreator` partagé, `POST /api/creators/:id/sync`, bouton « Synchroniser maintenant » avec progression. _Exig. 2.9–2.12_

- [x] 3.12 Refonte visuelle « catalogue » : fiches numérotées, logo memento.cat avec tête de chat, icône d'onglet, thème sombre. _Exig. 4.1, 4.2, 4.8_

- [x] 3.13 En-tête créateur et actions de consultation aussi avec le filtre « Créateur » ; nom du créateur cliquable sur chaque tuile. _Exig. 4.20, 4.21_

- [x] 3.14 Loupe dans la visionneuse : pleine résolution, déplacement, raccourcis clavier. _Exig. 4.22_

- [ ] 3.17 Évaluer le remplacement du chargement automatique au défilement par le seul bouton « Afficher plus » (question ouverte Q6, intention anti-doomscrolling).
- [x] 3.16 Filtre « Non consultés seulement » : bouton à bascule à la place de la case à cocher. _Exig. 4.15_
- [x] 3.15 Fermeture de la visionneuse par un clic en dehors de l'image (marges d'ajustement comprises). _Exig. 4.23_

## Phase 4 — Vérification des suppressions → `v0.4`
- [x] 4.1 `checkStates` Bluesky (`getPosts` par lot). _Exig. 5.1_
- [x] 4.2 Endpoint de vérification par lot et boucle de progression dans la galerie. _Exig. 5.2, 5.3_
- [x] 4.3 Statut « supprimé » et badge (Bluesky, Mastodon). _Exig. 4.6, 5.4, 5.6_
- [x] 4.4 Reddit : effacement définitif d'une publication constatée supprimée (fichiers R2, lignes D1, index), sans effacer sur une réponse invalide de l'API. _Exig. 5.5_

## Phase 5 — Connecteur Reddit → `v0.5` (code prêt ; activation seulement après approbation de 0.3)
- [x] 5.1 OAuth, secrets Wrangler, User-Agent conforme. _Exig. 6.2_
- [x] 5.2 `fetchSince` : titre, texte, image, galerie et légendes, vidéo. _Exig. 2.2_
- [x] 5.3 Limiteur calé sur 100 requêtes/minute et les en-têtes `X-Ratelimit-*`. _Exig. 6.3_
- [x] 5.4 `checkStates` Reddit et statut « supprimé ». _Exig. 5.5_

## Phase 5b — Connecteur Mastodon (livré en `v0.1.5`)
- [x] 5b.1 Migration `0002_platform_libre.sql` : retirer la contrainte `CHECK` sur `creators.platform` (reconstruction de la table, données conservées). _Exig. 1.1_
- [x] 5b.2 Connecteur Mastodon : `resolveCreator` (validation du serveur), `fetchSince` sans republications ni réponses, conversion du HTML, images, vidéos et `gifv`. _Exig. 2.2, 3b, 6.5, 6.6, 6.8_
- [x] 5b.3 Limiteur : lecture de `X-RateLimit-Reset` en horodatage ISO. _Exig. 6.7_
- [x] 5b.4 `checkStates` Mastodon : 404 ou 410 = supprimé, toute autre erreur laisse le statut inchangé. _Exig. 5.6_
- [x] 5b.5 Galerie : choix de la plateforme, libellés et filtre. _Exig. 1.1_

## Revue du 2026-10-01 (livrée en `v0.1.11`)
- [x] R.1 Index sur les clés R2 des médias (migration `0003`) : plus de lecture complète de `media` à chaque média servi.
- [x] R.2 Clés Access : relecture à la source en cas de rotation (au plus une fois par minute).
- [x] R.3 Corps JSON exigé aussi sur la restauration, la synchronisation manuelle et la mise à la corbeille.
- [x] R.4 Reddit : écarter les republications croisées (crossposts). _Exig. 2.3b_
- [x] R.5 Reconstruction de l'index : SQL déplacé dans `db.ts`, curseur avancé à la plus récente publication archivée.
- [x] R.6 `npm run typecheck` sans erreur (tests d'accès sans dépendance aux types de Node).
- [x] R.7 Documentation alignée sur le code (README, steering, conception).
- [x] R.8 En-tête `Content-Security-Policy` stricte, avec un test de compatibilité de la galerie (livré en `v0.1.12`). _Exig. 4.7_

## Publication du dépôt (livrée en `v0.1.15`)
- [x] P.1 Licence PolyForm Noncommercial 1.0.0 (`LICENSE.md`, `package.json`), `SECURITY.md`, section « Usage responsable » du README.
- [x] P.2 Nettoyage : plus de nom de dépôt ni d'équipe Access dans la documentation ; User-Agent Mastodon configurable (`MASTODON_USER_AGENT`), avec une valeur par défaut neutre.
- [x] P.3 Déploiement automatique : `scripts/wrangler-config.mjs` (testé) génère `wrangler.jsonc` à partir du modèle et des secrets ; `.github/workflows/deploy.yml` vérifie, migre et déploie à chaque étiquette `v*`.
- [x] P.4 Secrets du dépôt enregistrés ; premier déploiement automatique réussi (étiquette `v0.1.15`).
- [x] P.5 Wrangler 4.146 (corrige trois vulnérabilités de dépendances de développement : undici, miniflare, wrangler) et workflow `verify.yml` qui vérifie chaque pull request, dont celles de Dependabot (livré en `v0.1.16`).
- [x] P.6 Réglages de sécurité GitHub : dépôt public, analyse des secrets et protection des envois, signalement privé de vulnérabilités, CodeQL (configuration par défaut), alertes et correctifs Dependabot groupés. Mention de droits d'auteur de `LICENSE.md` confirmée.

## Médias identiques (repris de memento-local le 2026-10-03)
- [x] 9.1 Migration `0004_medias_identiques.sql` et couche de données : `findOriginal`, `keyInUseElsewhere`, insertion du lien, décomptes sans doublons, filtre `hideDuplicates`. _Exig. 9.1, 9.4, 9.7_
- [x] 9.2 Archivage : reconnaissance avant et après téléchargement, fichier en double supprimé, `post.json` (`duplicateOf`), journal, budget D1 ajusté. _Exig. 9.1 à 9.4, 9.8_
- [x] 9.3 Reconstruction de l'index et relogement des doublons avant l'effacement d'une publication. _Exig. 9.5_
- [x] 9.4 API (`duplicateOf`, `duplicate`, `duplicates=hide`) et galerie (badge, note dans la visionneuse, bouton « Masquer les doublons »). _Exig. 9.6_
- [x] 9.5 Rattrapage par lots `POST /api/admin/dedupe` (simulation par défaut). _Exig. 9.9_
- [x] 9.6 Tests sur une vraie base SQLite (migrations du dépôt) et un faux R2 : `test/duplicates.test.ts`.
- [ ] 9.7 Appliquer la migration 0004 en production et lancer le rattrapage (simulation, puis application).

## Miniatures fabriquées (repris de memento-local v0.5.1 le 2026-10-05)
- [x] 10.1 Liaison Images (`wrangler.example.jsonc`, types), `makeThumbnail` et branchement dans `archivePost`. _Exig. 10.1 à 10.4_
- [x] 10.2 Tests (fausse liaison Images, base SQLite réelle) : `test/thumbnail.test.ts`. _Exig. 10.1 à 10.3_
- [ ] 10.3 Après déploiement : archiver une image sans miniature et vérifier la tuile ; surveiller le quota de transformations.

## Phase 6 — Mise en service → `v1.0`
- [x] 6.1 Cloudflare Access devant la galerie et l'API (application auto-hébergée sur le domaine, politique limitée au propriétaire) ; une requête sans jeton est redirigée vers la connexion Access. _Exig. 4.7_
- [ ] 6.2 Déploiement (fait le 2026-09-30 sur `memento.cat`) ; suivi des journaux sur une semaine, à faire.
- [x] 6.3 Exportation complète vers un dossier local et procédure de sauvegarde (rclone, voir README). _Exig. 7.2_
- [ ] 6.5 Premier passage réel sur Bluesky et Reddit : valider les correspondances sur des réponses réelles.
- [ ] 6.4 Point sur le volume R2 (Q3).
