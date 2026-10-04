# Exigences — Archivage de créateurs

Notation EARS : QUAND (événement), TANT QUE (état), SI … ALORS (situation indésirable), LE SYSTÈME DOIT (comportement attendu).

## Intention
Au-delà de l'archivage, memento est une alternative simple au « doomscrolling » (le défilement anxiogène des fils des réseaux sociaux) : un ensemble fini de créateurs choisis, de leurs seules contributions originales avec médias, consulté quand l'utilisateur le décide, sans fil algorithmique ni indicateur d'engagement, et avec une fin identifiable (les médias non consultés). Cette intention n'ajoute pas d'exigence propre : elle s'appuie sur les exigences 1 (liste choisie), 2.3 et 2.3b à 2.3c (contenu original avec médias), 4.12 à 4.16 (médias consultés et filtre « non consultés ») et sur les principes de `.kiro/steering/product.md`. Le chargement automatique de la suite de la liste au défilement la contrarie en partie : voir la question ouverte Q6.

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
3c. LE SYSTÈME NE DOIT PAS archiver une publication sans média (image, vidéo ou GIF) : une publication texte seule est ignorée, et le curseur avance quand même pour ne pas la récupérer de nouveau. Un média trop volumineux pour être téléchargé compte comme média (exigence 3.3).
3b. LE SYSTÈME NE DOIT archiver que les contributions originales du créateur : il NE DOIT PAS archiver les republications ni les citations d'une publication ou d'une ressource (flux, liste) d'un autre compte. Une citation de sa propre publication, ou une publication qui ajoute ses propres médias en citant un autre compte, reste une contribution originale.
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
2. LE SYSTÈME DOIT conserver les médias sans recompression (pour Bluesky, le fichier d'origine téléversé par l'auteur, non la version redimensionnée du CDN ; seules les miniatures peuvent être des versions recompressées fournies par la plateforme) et enregistrer une empreinte de contenu par média (l'empreinte MD5 calculée par R2 ; un SHA-256 calculé dans le Worker dépasserait la limite de temps processeur du plan gratuit).
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
6. SI une publication porte le statut « supprimé », ALORS LE SYSTÈME DOIT l'afficher avec un badge « supprimé ». Seules les publications Bluesky et Mastodon portent ce statut : une publication Reddit supprimée à la source est effacée (exigence 5.5).
7. LE SYSTÈME DOIT refuser l'accès à la galerie et à l'API à toute personne autre que le propriétaire.

### Miniatures et visionneuse
8. LE SYSTÈME DOIT afficher les médias de la galerie sous forme de miniatures.
9. QUAND l'utilisateur clique sur une miniature, LE SYSTÈME DOIT ouvrir la version complète du média dans une visionneuse (image en pleine résolution, vidéo lisible), sans quitter la page.
10. PENDANT la visionneuse, LE SYSTÈME DOIT permettre de passer au média suivant ou précédent (flèches, clavier, balayage sur mobile) et de fermer (Échap, bouton, balayage vers le bas).
11. SI aucune miniature n'a pu être archivée pour un média, ALORS LE SYSTÈME DOIT afficher une version réduite du média complet, chargée paresseusement.
22. QUAND une image est affichée dans la visionneuse, LE SYSTÈME DOIT permettre de l'agrandir à sa pleine résolution (un pixel de l'image pour un pixel de l'écran), de la parcourir par glissement ou défilement, et de revenir à l'affichage ajusté, au bouton « loupe », au clic sur l'image ou au clavier (`+`, `-`, `Z`, Échap). Le passage à un autre média ramène à l'affichage ajusté. Les vidéos et GIF ne sont pas concernés.
23. QUAND l'utilisateur clique en dehors de l'image affichée dans la visionneuse (le fond autour de l'image, y compris les marges laissées par l'ajustement), LE SYSTÈME DOIT fermer la visionneuse, comme le bouton de fermeture. Un clic sur l'image elle-même ouvre la loupe (exigence 22) ; les commandes, la vidéo et le panneau de détails ne ferment pas la visionneuse. À l'affichage agrandi, un clic dans la marge ramène à l'affichage ajusté sans fermer.

### Médias consultés et non consultés
12. QUAND l'utilisateur ouvre un média dans la visionneuse, LE SYSTÈME DOIT l'enregistrer comme consulté, avec la date de première consultation.
13. LE SYSTÈME DOIT distinguer visuellement les miniatures des médias non consultés de celles des médias consultés, autrement que par la seule couleur.
14. LE SYSTÈME DOIT permettre de marquer manuellement un média, une publication ou tout un créateur comme consulté ou non consulté ; après un marquage de tout un créateur, LE SYSTÈME DOIT rafraîchir l'affichage (tuiles et compteurs) à la fin du traitement, sans action de l'utilisateur.
15. QUAND l'utilisateur active le filtre « non consultés », LE SYSTÈME DOIT n'afficher que les publications ayant au moins un média non consulté. Ce filtre est un bouton à bascule (« Non consultés seulement ») dont l'état actif se voit autrement que par la seule couleur et est annoncé aux lecteurs d'écran.
16. LE SYSTÈME DOIT afficher, par créateur, le nombre de médias non consultés.

### Navigation par créateur
20. QUAND un créateur est sélectionné dans la galerie, que ce soit par le filtre « Créateur » ou par sa page, LE SYSTÈME DOIT afficher son nom, sa plateforme, son identifiant et ses actions de consultation (« Tout marquer consulté », « Tout marquer non consulté »), de la même façon dans les deux cas.
21. LE SYSTÈME DOIT permettre d'ouvrir la page d'un créateur depuis chacune de ses tuiles, sans passer par la liste de gestion.

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
5. QUAND une publication Reddit n'est plus disponible (supprimée par son auteur, retirée par un modérateur ou par Reddit, ou auteur dont le compte est supprimé), LE SYSTÈME DOIT l'effacer définitivement, conformément aux conditions de l'API Reddit : sa ligne dans D1 (publication, médias, index de recherche) et tous ses fichiers dans R2 (médias, miniatures, `post.json`), sans conserver de copie, de statut ni d'information d'identification de l'auteur. LE SYSTÈME NE DOIT PAS effacer sur une réponse incomplète ou invalide de l'API Reddit (corps ou liste de publications absents, erreur HTTP, quota atteint) : seule une réponse valide qui signale la publication comme retirée, ou qui l'omet, déclenche l'effacement.
6. QUAND une publication Mastodon n'est plus disponible sur son serveur (erreur 404 ou 410), LE SYSTÈME DOIT lui attribuer le statut « supprimé » avec la date de constat, comme pour Bluesky ; toute autre erreur (connexion exigée, serveur indisponible) NE DOIT PAS la faire passer à « supprimé ».

## Exigence 6 — Conformité aux plateformes
1. LE SYSTÈME DOIT n'utiliser que les API officielles des plateformes.
2. LE SYSTÈME DOIT s'authentifier auprès de Reddit par OAuth et envoyer un User-Agent conforme au format imposé.
3. LE SYSTÈME NE DOIT PAS dépasser 100 requêtes par minute (moyenne sur 10 minutes) vers Reddit.
4. LE SYSTÈME NE DOIT activer le connecteur Reddit qu'après approbation de la demande d'accès.
5. LE SYSTÈME DOIT lire Mastodon (et les serveurs compatibles, comme Pixelfed) en lecture seule, par l'API publique du serveur du créateur, sans authentification ni identifiant, et envoyer un User-Agent identifiable.
6. SI un serveur Mastodon exige une connexion pour lire un compte, ALORS LE SYSTÈME DOIT refuser l'ajout ou la collecte avec un message explicite, sans tenter de contourner la restriction.
7. LE SYSTÈME DOIT respecter les en-têtes de quota Mastodon (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) comme ceux des autres plateformes (exigence 2.6).
8. LE SYSTÈME DOIT n'appeler que des serveurs désignés par un nom d'hôte public valide (pas d'adresse IP, de port ni de nom local) pour un compte Mastodon.

## Exigence 8 — Configuration et secrets
1. LE SYSTÈME DOIT stocker la liste des créateurs suivis dans D1, gérée depuis la galerie (ajout, désactivation, suppression logique ou physique, restauration) ; elle n'est jamais versionnée dans le dépôt.
2. LE SYSTÈME DOIT pouvoir être publié sur GitHub sans aucun secret ni identifiant de ressource personnel.
3. LE SYSTÈME DOIT lire les secrets (identifiants Reddit) depuis les secrets Wrangler en production et depuis un fichier local ignoré par Git en développement.

## Exigence 7 — Portabilité
1. LE SYSTÈME DOIT pouvoir s'exécuter localement (`wrangler dev`) avec le même code qu'en production.
2. LE SYSTÈME DOIT offrir une exportation complète de l'archive (médias et `post.json`) vers un dossier local.

## Exigence 9 — Médias identiques
**Récit :** En tant qu'utilisateur, je ne veux pas revoir ni stocker deux fois la même image republiée par un créateur.

Reprise de l'exigence L10 de memento-local (2026-10-03), limitée à ce qui s'exécute dans un Worker : la reconnaissance est **exacte** (adresse, ou empreinte MD5 et taille). La reconnaissance visuelle des quasi-doublons de memento-local (L10.10 et L10.11) n'est pas reprise : elle décode les images avec un module natif (`sharp`) qu'un Worker ne peut pas charger, et dépasserait la limite de temps processeur du plan gratuit.

1. LE SYSTÈME DOIT reconnaître qu'un média est identique à un média déjà archivé **du même créateur**, jamais d'un autre créateur :
   - avant de le télécharger, quand son adresse source est celle d'un original ;
   - après l'avoir téléchargé, quand son empreinte MD5 (calculée par R2) et sa taille sont celles d'un original de même genre.
2. QUAND un média est identique, LE SYSTÈME NE DOIT PAS conserver un second fichier. La publication est archivée normalement, avec ses autres médias ; la ligne du média identique est **liée** à l'original (publication et position) et se sert de ses fichiers (média et miniature). Un fichier déjà écrit pour un doublon reconnu après téléchargement DOIT être supprimé.
3. LA reconnaissance DOIT se faire média par média : dans un groupe, seul le média identique est lié.
4. UN doublon n'est jamais l'original d'un autre : tous pointent vers le premier média archivé. Un média non téléchargé n'est jamais un original.
5. LE lien DOIT survivre à la reconstruction de l'index (il est écrit dans `post.json`). LE SYSTÈME NE DOIT PAS supprimer un fichier encore utilisé par un autre média : avant d'effacer une publication dont un média sert d'original (exigence 5.5), il recopie ses fichiers chez le premier doublon, qui devient l'original des autres.
6. LA galerie DOIT :
   - signaler dans la visionneuse qu'un média est identique à celui d'une autre publication, avec un lien vers elle ;
   - signaler sur la tuile une publication dont tous les médias sont des doublons (badge « Doublon », visible autrement que par la seule couleur) ;
   - offrir un bouton à bascule « Masquer les doublons » (`aria-pressed`, synchronisé avec l'URL par `duplicates=hide`) qui retire de la liste les publications dont tous les médias sont des doublons. Sans lui, tout reste visible.
7. LES doublons NE DOIVENT PAS compter parmi les médias non consultés (compteurs et filtre « Non consultés seulement »), ni dans la taille archivée d'un créateur.
8. LE journal DOIT noter chaque média reconnu comme identique (publication, position, original).
9. LE SYSTÈME DOIT offrir un rattrapage qui relie les doublons déjà présents dans l'archive, par lots (`POST /api/admin/dedupe`) :
   - par défaut, il **simule** : il renvoie les doublons trouvés, l'espace libérable et des exemples, sans rien écrire ; `{"apply": true}` applique un lot, à rappeler jusqu'à `remaining = 0` ;
   - il ne compare que le contenu (genre, empreinte et taille identiques, au sein d'un même créateur) ;
   - l'original est le premier média archivé (ordre de la fiche, puis position) dont le fichier existe ; jamais de chaîne ;
   - il écrit `post.json` avant la base et ne supprime les fichiers en double qu'après : une interruption laisse une archive cohérente, et l'appel suivant termine le travail ;
   - il peut être limité à un créateur (`{"creator": "<id>"}`).

## Questions ouvertes
- **Q1 — Reddit.** Tranchée le 2026-09-28 : Reddit conservé, sans purge en v1. Reprise le 2026-10-01 : la purge est implémentée (exigence 5.5), ce qui supprime l'écart avec les conditions Reddit. Reste la fréquence : la vérification est à la demande (exigence 5.2) et Reddit recommande de supprimer sous 48 heures ; tant qu'aucune vérification n'est lancée, une publication supprimée à la source reste dans l'archive. Option à évaluer si Reddit l'exige : vérification planifiée limitée à Reddit.
- **Q2 — Bluesky et le contenu supprimé.** Vérifier dans les conditions développeur de Bluesky si la conservation d'une publication supprimée est permise. Le choix de ne pas purger s'applique aussi à Bluesky en v1.
- **Q4 — Vidéos Reddit.** La vidéo archivée est la version sans piste audio (Reddit sert l'audio séparément). Ajouter l'audio exigerait un assemblage hors du Worker.
- **Q5 — Mastodon et le contenu supprimé.** Le fediverse n'a pas de conditions d'API uniformes : chaque serveur fixe ses règles, et la culture du réseau attend que les suppressions se propagent. Par cohérence avec Bluesky, une publication Mastodon supprimée garde sa copie avec le statut « supprimé » (usage strictement personnel). À réévaluer, notamment si un serveur l'interdit.
- **Q6 — Chargement automatique au défilement.** La galerie charge la page suivante dès qu'on approche du bas (un observateur d'intersection avec une marge de 800 px), en plus du bouton « Afficher plus ». Sur une archive longue, cela donne un défilement continu, ce que l'intention anti-doomscrolling cherche à éviter. Option à évaluer : ne garder que le bouton « Afficher plus » (une pause explicite à chaque page) et afficher le nombre de publications restantes. Non traitée pour l'instant.
- **Q3 — Volume.** Estimer le volume vidéo par créateur pour valider les 10 Go gratuits de R2.
