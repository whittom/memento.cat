# Exigences — Archivage de créateurs

Notation EARS : QUAND (événement), TANT QUE (état), SI … ALORS (situation indésirable), LE SYSTÈME DOIT (comportement attendu).

## Exigence 1 — Gestion des créateurs suivis
**Récit :** En tant qu'utilisateur, je veux déclarer les créateurs à suivre, afin que leurs publications soient archivées.

1. QUAND l'utilisateur ajoute un créateur avec une plateforme supportée et un identifiant, LE SYSTÈME DOIT résoudre l'identifiant stable du créateur et l'enregistrer comme actif.
2. SI la plateforme n'est pas supportée ou si le créateur est introuvable, ALORS LE SYSTÈME DOIT refuser l'ajout avec un message explicite.
3. QUAND l'utilisateur désactive un créateur, LE SYSTÈME DOIT seulement cesser sa synchronisation ; ses archives restent visibles dans la galerie et l'utilisateur peut le réactiver.
4. LE SYSTÈME DOIT offrir la suppression d'un créateur comme une action distincte de la désactivation, avec deux modes au choix : logique ou physique.
5. QUAND l'utilisateur supprime un créateur en mode logique, LE SYSTÈME DOIT arrêter sa synchronisation, masquer le créateur et ses publications dans la galerie et la recherche, et conserver toutes ses données dans D1 et R2.
6. QUAND l'utilisateur restaure un créateur supprimé logiquement, LE SYSTÈME DOIT le rétablir à l'état désactivé, avec toutes ses publications à nouveau visibles.
7. QUAND l'utilisateur demande une suppression physique, LE SYSTÈME DOIT exiger une confirmation explicite indiquant le nombre de publications et de médias concernés, et préciser que l'action est irréversible.
8. QUAND la suppression physique est confirmée, LE SYSTÈME DOIT effacer le créateur, ses publications, ses médias et ses `post.json` de R2 et de D1, puis afficher la progression jusqu'à la fin.
9. SI une suppression physique est interrompue, ALORS LE SYSTÈME DOIT pouvoir la reprendre là où elle s'est arrêtée, le créateur restant masqué entre-temps.
10. LA suppression physique PEUT s'appliquer directement à un créateur actif, désactivé ou supprimé logiquement.

## Exigence 2 — Collecte planifiée
**Récit :** En tant qu'utilisateur, je veux que les nouvelles publications soient récupérées automatiquement, afin de ne pas avoir à consulter les plateformes.

1. QUAND le déclencheur planifié s'exécute, LE SYSTÈME DOIT récupérer, pour chaque créateur actif, les publications postérieures au dernier curseur enregistré avec succès.
2. LE SYSTÈME DOIT archiver pour chaque publication : identifiant, plateforme, créateur, date de publication, titre, texte, médias, description de chaque média, URL source, date de capture.
3. LE SYSTÈME NE DOIT PAS archiver les commentaires ni les réponses.
4. QUAND une publication déjà archivée est récupérée à nouveau, LE SYSTÈME NE DOIT PAS créer de doublon.
5. SI la collecte d'un créateur échoue, ALORS LE SYSTÈME DOIT journaliser l'erreur, conserver le curseur précédent et poursuivre avec les autres créateurs.
6. TANT QUE le quota restant annoncé par une plateforme est sous le seuil configuré, LE SYSTÈME DOIT suspendre les appels vers cette plateforme jusqu'à la réinitialisation annoncée.
7. SI une exécution planifiée n'a pas eu lieu (panne, ordinateur éteint en exécution locale), ALORS LA PROCHAINE exécution DOIT rattraper les publications manquées à partir du curseur.
8. LE SYSTÈME DOIT borner chaque exécution par un budget de sous-requêtes et de requêtes D1, s'arrêter proprement avant la limite et reprendre au passage suivant sans perte ni doublon.

### Synchronisation manuelle
9. QUAND l'utilisateur demande la synchronisation d'un créateur actif, LE SYSTÈME DOIT collecter immédiatement ce seul créateur, selon les règles de la collecte planifiée (curseur, budget, quotas, aucun doublon), et afficher la progression jusqu'à la fin.
10. SI le créateur est désactivé, supprimé ou en cours d'effacement, ALORS LE SYSTÈME DOIT refuser la synchronisation manuelle avec un message explicite.
11. SI la synchronisation manuelle échoue ou est interrompue par le budget, ALORS LE SYSTÈME DOIT conserver le curseur, afficher la cause, et permettre de la relancer pour reprendre sans perte ni doublon.
12. LA synchronisation manuelle NE DOIT PAS rapatrier l'historique antérieur au curseur (voir Limites connues du README).

## Exigence 3 — Stockage
1. LE SYSTÈME DOIT ranger chaque publication sous `<plateforme>/<créateur>/<AAAA>/<MM>/<AAAA-MM-JJ>_<id>/`, avec ses médias et un `post.json`.
2. LE SYSTÈME DOIT conserver les médias sans recompression et enregistrer une empreinte de contenu par média (l'empreinte MD5 calculée par R2 ; un SHA-256 calculé dans le Worker dépasserait la limite de temps processeur du plan gratuit).
5. QUAND la plateforme fournit une miniature ou un aperçu réduit d'un média, LE SYSTÈME DOIT l'archiver à côté du média complet, avec les dimensions des deux versions.
3. SI un média dépasse la taille maximale configurée, ALORS LE SYSTÈME DOIT archiver ses métadonnées et le marquer « non téléchargé ».
4. LE SYSTÈME DOIT pouvoir reconstruire l'index D1 à partir des seuls fichiers `post.json`.

## Exigence 4 — Galerie de consultation
**Récit :** En tant qu'utilisateur, je veux parcourir l'archive sur n'importe quel appareil, afin de consulter le contenu hors des plateformes.

1. LE SYSTÈME DOIT fournir la galerie sous forme d'application monopage.
2. LE SYSTÈME DOIT adapter la mise en page aux écrans mobiles, tablettes et ordinateurs.
3. QUAND l'utilisateur filtre par créateur, plateforme ou période, LE SYSTÈME DOIT afficher les publications correspondantes, de la plus récente à la plus ancienne.
4. QUAND l'utilisateur saisit un mot-clé, LE SYSTÈME DOIT rechercher dans les titres, textes et descriptions de médias.
5. QUAND l'utilisateur ouvre une publication, LE SYSTÈME DOIT afficher ses médias, titre, texte, descriptions, lien source, date de publication et date de capture.
6. SI une publication porte le statut « supprimé », ALORS LE SYSTÈME DOIT l'afficher avec un badge « supprimé » (plateformes où la conservation est permise, voir exigence 5).
7. LE SYSTÈME DOIT refuser l'accès à la galerie et à l'API à toute personne autre que le propriétaire.

### Miniatures et visionneuse
8. LE SYSTÈME DOIT afficher les médias de la galerie sous forme de miniatures.
9. QUAND l'utilisateur clique sur une miniature, LE SYSTÈME DOIT ouvrir la version complète du média dans une visionneuse (image en pleine résolution, vidéo lisible), sans quitter la page.
10. PENDANT la visionneuse, LE SYSTÈME DOIT permettre de passer au média suivant ou précédent (flèches, clavier, balayage sur mobile) et de fermer (Échap, bouton, balayage vers le bas).
11. SI aucune miniature n'a pu être archivée pour un média, ALORS LE SYSTÈME DOIT afficher une version réduite du média complet, chargée paresseusement.

### Médias consultés et non consultés
12. QUAND l'utilisateur ouvre un média dans la visionneuse, LE SYSTÈME DOIT l'enregistrer comme consulté, avec la date de première consultation.
13. LE SYSTÈME DOIT distinguer visuellement les miniatures des médias non consultés de celles des médias consultés, autrement que par la seule couleur.
14. LE SYSTÈME DOIT permettre de marquer manuellement un média, une publication ou tout un créateur comme consulté ou non consulté.
15. QUAND l'utilisateur active le filtre « non consultés », LE SYSTÈME DOIT n'afficher que les publications ayant au moins un média non consulté.
16. LE SYSTÈME DOIT afficher, par créateur, le nombre de médias non consultés.

### Groupes de médias
17. QUAND une publication comporte plusieurs médias, LE SYSTÈME DOIT les présenter comme un groupe visuellement identifiable dans la galerie : une seule tuile, le premier média en miniature, un indicateur de pile et le nombre d'éléments.
18. QUAND l'utilisateur ouvre un groupe, LE SYSTÈME DOIT afficher la position dans le groupe (ex. 2/5) et une bande de miniatures du groupe, et limiter la navigation suivant/précédent aux éléments du groupe avant de passer à la publication suivante.
19. SI une partie seulement des éléments d'un groupe a été consultée, ALORS LE SYSTÈME DOIT indiquer sur la tuile l'état « partiellement consulté » et le nombre d'éléments restants.

## Exigence 5 — Vérification des suppressions à la demande
**Récit :** En tant qu'utilisateur, je veux savoir quelles publications d'un créateur ont été supprimées, sans que cela consomme du quota en continu.

1. QUAND l'utilisateur lance la vérification pour un créateur, LE SYSTÈME DOIT interroger la plateforme pour chaque publication archivée active de ce créateur.
2. LE SYSTÈME NE DOIT PAS exécuter cette vérification de façon planifiée.
3. PENDANT la vérification, LE SYSTÈME DOIT afficher la progression et respecter les quotas de l'exigence 2.6.
4. QUAND une publication Bluesky n'est plus disponible, LE SYSTÈME DOIT lui attribuer le statut « supprimé » avec la date de constat, et conserver la copie archivée, sous réserve de Q2.
5. QUAND une publication Reddit n'est plus disponible, LE SYSTÈME DOIT lui attribuer le statut « supprimé » avec la date de constat, comme pour Bluesky.

> Décision du 2026-09-28 : usage strictement personnel, pas de purge en v1. Écart connu : les conditions de l'API Reddit exigent la suppression des contenus supprimés, quel que soit l'usage. La purge (ancienne exigence 5.5–5.6) est reportée et pourra être réactivée si l'approbation Reddit l'exige.

## Exigence 6 — Conformité aux plateformes
1. LE SYSTÈME DOIT n'utiliser que les API officielles des plateformes.
2. LE SYSTÈME DOIT s'authentifier auprès de Reddit par OAuth et envoyer un User-Agent conforme au format imposé.
3. LE SYSTÈME NE DOIT PAS dépasser 100 requêtes par minute (moyenne sur 10 minutes) vers Reddit.
4. LE SYSTÈME NE DOIT activer le connecteur Reddit qu'après approbation de la demande d'accès.

## Exigence 8 — Configuration et secrets
1. LE SYSTÈME DOIT stocker la liste des créateurs suivis dans D1, gérée depuis la galerie (ajout, désactivation, suppression logique ou physique, restauration) ; elle n'est jamais versionnée dans le dépôt.
2. LE SYSTÈME DOIT pouvoir être publié sur GitHub sans aucun secret ni identifiant de ressource personnel.
3. LE SYSTÈME DOIT lire les secrets (identifiants Reddit) depuis les secrets Wrangler en production et depuis un fichier local ignoré par Git en développement.

## Exigence 7 — Portabilité
1. LE SYSTÈME DOIT pouvoir s'exécuter localement (`wrangler dev`) avec le même code qu'en production.
2. LE SYSTÈME DOIT offrir une exportation complète de l'archive (médias et `post.json`) vers un dossier local.

## Questions ouvertes
- **Q1 — Reddit.** Tranchée le 2026-09-28 : Reddit conservé, sans purge en v1 (voir exigence 5). Écart assumé avec les conditions Reddit, à réévaluer lors de la demande d'accès.
- **Q2 — Bluesky et le contenu supprimé.** Vérifier dans les conditions développeur de Bluesky si la conservation d'une publication supprimée est permise. Le choix de ne pas purger s'applique aussi à Bluesky en v1.
- **Q4 — Vidéos Reddit.** La vidéo archivée est la version sans piste audio (Reddit sert l'audio séparément). Ajouter l'audio exigerait un assemblage hors du Worker.
- **Q3 — Volume.** Estimer le volume vidéo par créateur pour valider les 10 Go gratuits de R2.
