# Plan de réalisation

Chaque tâche renvoie aux exigences de `requirements.md`. Une étiquette Git clôt chaque phase.

## Phase 0 — Préalables
- [ ] 0.1 Pousser le dépôt Git (déjà initialisé localement) sur GitHub.
- [ ] 0.2 Créer le compte Cloudflare, le bucket R2 `memento-media` et la base D1 `memento-db`.
- [ ] 0.3 Déposer la demande d'accès à l'API Reddit (délai inconnu : à lancer dès maintenant). _Exig. 6.4_
- [x] 0.4 Trancher Q1 : Reddit conservé, sans purge en v1.
- [x] 0.5 Ajouter `.gitignore` (`wrangler.jsonc`, `.dev.vars`, `.env`, `node_modules`, `dist`) et `wrangler.example.jsonc`. _Exig. 8.2_

## Phase 1 — Socle technique → `v0.1`
- [x] 1.1 Initialiser le Worker TypeScript (`wrangler.jsonc`, `compatibility_date` du jour, `nodejs_compat`, observabilité).
- [x] 1.2 Liaisons D1 et R2, `wrangler types`, ESLint (`no-floating-promises`), Vitest (tests unitaires).
- [ ] 1.7 Tests d'intégration dans le runtime Workers (`@cloudflare/vitest-pool-workers`, D1 et R2 réels).
- [x] 1.3 Migration D1 initiale ; valider FTS5. _Exig. 3_
- [x] 1.4 Module `storage/` : clés R2, écriture diffusée des médias, SHA-256, `post.json`, insertion idempotente. _Exig. 3.1–3.3, 2.4_
- [x] 1.6 Archivage des miniatures fournies par les plateformes et des dimensions. _Exig. 3.5_
- [x] 1.5 Script de reconstruction de l'index depuis `post.json`. _Exig. 3.4_

## Phase 2 — Connecteur Bluesky et collecte → `v0.2`
- [x] 2.1 `connectors/types.ts` et limiteur de quota générique. _Exig. 2.6_
- [x] 2.2 Connecteur Bluesky : `resolveCreator`, `fetchSince` (sans réponses), extraction des `alt`. _Exig. 1.1, 2.2, 2.3_
- [x] 2.3 Orchestration `scheduled()` : un créateur en échec n'arrête pas les autres ; curseur mis à jour après succès. _Exig. 2.1, 2.5, 2.7_
- [x] 2.4 Déclencheur Cron (horaire par défaut) ; essai en local avec `wrangler dev`. _Exig. 7.1_

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

## Phase 4 — Vérification des suppressions → `v0.4`
- [x] 4.1 `checkStates` Bluesky (`getPosts` par lot). _Exig. 5.1_
- [x] 4.2 Endpoint de vérification par lot et boucle de progression dans la galerie. _Exig. 5.2, 5.3_
- [x] 4.3 Statut « supprimé » et badge (ou purge, selon Q2). _Exig. 4.6, 5.4_

## Phase 5 — Connecteur Reddit → `v0.5` (code prêt ; activation seulement après approbation de 0.3)
- [x] 5.1 OAuth, secrets Wrangler, User-Agent conforme. _Exig. 6.2_
- [x] 5.2 `fetchSince` : titre, texte, image, galerie et légendes, vidéo. _Exig. 2.2_
- [x] 5.3 Limiteur calé sur 100 requêtes/minute et les en-têtes `X-Ratelimit-*`. _Exig. 6.3_
- [x] 5.4 `checkStates` Reddit et statut « supprimé ». _Exig. 5.5_

## Phase 6 — Mise en service → `v1.0`
- [ ] 6.1 Cloudflare Access devant la galerie et l'API ; test d'accès refusé. _Exig. 4.7_
- [ ] 6.2 Déploiement, suivi des journaux sur une semaine.
- [x] 6.3 Exportation complète vers un dossier local et procédure de sauvegarde (rclone, voir README). _Exig. 7.2_
- [ ] 6.5 Premier passage réel sur Bluesky et Reddit : valider les correspondances sur des réponses réelles.
- [ ] 6.4 Point sur le volume R2 (Q3).
