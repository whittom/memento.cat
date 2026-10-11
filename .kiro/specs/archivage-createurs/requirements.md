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

Reprise de l'exigence L10 de memento-local (2026-10-03). La reconnaissance exacte (adresse, ou empreinte MD5 et taille) est faite dans le Worker. La reconnaissance visuelle des quasi-doublons (9.11, reprise le 2026-10-11 de L10.10 à L10.13) passe par la liaison Cloudflare Images, qui rend des pixels bruts : memento-local utilise `sharp`, qu'un Worker ne peut pas charger.

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
10. **Depuis la page Créateurs (reprise de L10.12 de memento-local, 2026-10-11) :** LA page Créateurs DOIT offrir, pour chaque créateur suivi (actif ou désactivé), « Supprimer les doublons… » : une simulation (médias à relier, fiches entièrement en double, espace libérable), une confirmation dans une fenêtre de la page, puis le ménage de ce créateur seulement, avec sa progression et son bilan. Route `POST /api/creators/<id>/duplicates` (`{ apply }`), par lots, rappelée par la galerie jusqu'à la fin.
    - **Seule la première occurrence d'un média est conservée** : les fiches dont **tous** les médias sont des doublons (déjà reliés, ou que ce ménage relie) sont **supprimées définitivement** (fichiers propres, index, publication). Une galerie qui garde au moins un média propre reste entière, doublons liés compris. Une fiche dont un fichier sert à une autre est conservée.
    - Le ménage relie aussi les quasi-doublons (9.11) ; dans un groupe de quasi-doublons, le meilleur fichier (le plus de pixels, puis d'octets) est gardé, sous la fiche publiée la première (9.12).
11. **Quasi-doublons (reprise de L10.10, L10.11 et L10.13 de memento-local, 2026-10-11) :** une même image archivée sous des encodages différents (recompression, redimensionnement) DOIT être reconnue, au sein d'un même créateur, par une **empreinte visuelle** (image réduite à 17 × 16 en niveaux de gris, comparaison de chaque pixel à son voisin, 256 bits), conservée en base (colonne `fingerprint`).
    - **À l'archivage :** QUAND une image téléchargée n'est pas une copie identique, LE SYSTÈME DOIT la comparer aux originaux du créateur qui ont déjà une empreinte ; si l'écart est d'au plus `VISUAL_DEDUPE_THRESHOLD` bits (6 par défaut, 0 désactive), que le rapport largeur/hauteur est le même à 2 % près et que l'original a au moins autant de pixels, ALORS elle est reliée comme un doublon (9.2 : fichier en double supprimé, journal avec l'écart).
    - **Second regard :** QUAND l'écart est au-dessus du seuil mais d'au plus **24 bits**, LE SYSTÈME DOIT comparer les deux images pixel à pixel (48 × 48, niveaux de gris) et les tenir pour la même image si l'écart moyen est d'au plus **6** sur 255. Au plus 3 seconds regards par image archivée, 30 par plan de ménage.
    - **Ménage (9.10) :** il calcule d'abord, par lots, les empreintes manquantes des images du créateur (celles de l'archive existante), puis compare chaque image aux seuls originaux de groupe (jamais de proche en proche). Un doublon déjà relié à une image qui cesse d'être l'original est relié à la nouvelle.
    - Une image illisible, quasi unie, animée (GIF), un SVG, une image de plus de 20 Mo ou une vidéo n'est jamais comparée. Sans la liaison Images, ou quand son quota est atteint, seules les copies identiques sont reconnues, sans erreur.

12. **Première occurrence (reprise de L10.14 de memento-local, commit 4da3d16, 2026-10-11) :** dans un groupe de médias identiques ou quasi identiques, LE ménage DOIT faire de la fiche **publiée la première** (date de publication, puis numéro de fiche, puis position) celle qui garde le média ; les autres y sont reliées, y compris les liens déjà posés dans l'autre sens (une fiche plus ancienne archivée après une plus récente). Le fichier conservé reste le meilleur pour les quasi-doublons : il est recopié sous la fiche la plus ancienne, puis les fiches devenues entièrement en double sont supprimées (9.10). La simulation annonce le nombre d'images qui changeront de fiche.

13. **Fiches écartées (2026-10-11) :** QUAND le ménage supprime une fiche entièrement en double, LE SYSTÈME DOIT retenir son identifiant (table `discarded_posts`) et NE DOIT PLUS l'archiver, même si une collecte ou une synchronisation la retrouve ; le curseur la dépasse. L'effacement définitif du créateur efface aussi cette liste.
14. **Première occurrence dès l'archivage (2026-10-11) :** QUAND une publication nouvellement archivée a un média relié à un original publié **après** elle, LE SYSTÈME DOIT donner le groupe à la nouvelle fiche (9.12 : meilleur fichier recopié sous elle, liens réorientés), sans attendre le ménage, si le budget de l'exécution le permet ; sinon le ménage le fera.
15. **Empreintes de l'archive existante, en continu (2026-10-11) :** LE SYSTÈME DOIT calculer les empreintes manquantes par petits lots lors d'une exécution de maintenance planifiée, distincte de la collecte, un créateur à la fois, pour que la reconnaissance à l'archivage compare aussi aux images anciennes. `AUTO_DEDUPE = "false"` la désactive.
16. **Reconnaissance avant téléchargement (2026-10-11) :** QUAND un média a une miniature fournie par la plateforme et des dimensions connues, LE SYSTÈME DOIT télécharger la miniature d'abord, la comparer par empreinte (et second regard) aux originaux du créateur, et SI elle correspond à un original d'au moins autant de pixels, ALORS relier le média **sans télécharger le fichier complet** (la miniature téléchargée est supprimée).
17. **Ménage automatique sans suppression (2026-10-11) :** l'exécution de maintenance DOIT aussi relier les doublons et réorienter les groupes vers la fiche publiée la première (9.9 à 9.12), par lots, créateur par créateur. Elle NE DOIT JAMAIS supprimer de fiche : la suppression reste au bouton « Supprimer les doublons… ».
18. **Vidéos (2026-10-11) :** LE SYSTÈME DOIT reconnaître une même vidéo republiée par l'empreinte de sa miniature (seule image disponible sans décoder la vidéo), entre vidéos du même créateur, de mêmes proportions. Faute d'autre indice, la règle est plus stricte que pour les images : écart d'empreinte d'au plus le seuil **et** second regard pixel à pixel toujours exigé. Une vidéo sans miniature n'est jamais comparée. Grâce à 9.16, une vidéo reconnue n'est pas téléchargée.

## Exigence 10 — Miniatures fabriquées
**Récit :** En tant qu'utilisateur, je veux que la galerie charge de petites images, pas les originaux de plusieurs mégaoctets.

Reprise de l'exigence L12 de memento-local (v0.5.1), avec la liaison Cloudflare Images au lieu de `sharp`. Le rattrapage des images déjà archivées n'est pas repris (décision du 2026-10-05).

1. QUAND une image est archivée sans miniature (aucune fournie par la plateforme, ou téléchargement refusé), LE SYSTÈME DOIT en fabriquer une : image réduite pour tenir dans **480 × 480 px**, proportions conservées, jamais agrandie, au format WebP, rangée sous `media_NN.thumb.webp` à côté de l'original.
2. LE SYSTÈME NE DOIT PAS en fabriquer pour une miniature déjà fournie, pour un média lié à un original (exigence 9 : il se sert de la miniature de l'original), pour une vidéo, pour un SVG, pour une image de plus de 20 Mo (limite de la liaison) ni pour une image illisible. Aucune erreur : la tuile affiche alors l'original, comme avant.
3. SI la liaison est absente ou refuse la transformation (par exemple quota mensuel atteint), ALORS l'archivage de la publication DOIT réussir sans miniature.
4. LA miniature DOIT être enregistrée comme les autres (`thumb_r2_key`, `thumb_width`, `thumb_height`, `post.json`), donc survivre à la reconstruction de l'index.
5. LA galerie DOIT utiliser la miniature dans les tuiles ; la visionneuse garde l'original.

## Exigence 11 — Description d'un média par IA
**Récit :** En tant qu'utilisateur, je veux obtenir, à la demande, une description textuelle d'une image (ou d'une vidéo, par sa miniature) quand le créateur n'en a pas fourni, pour la retrouver par la recherche.

Demandée le 2026-10-11.

1. QUAND l'utilisateur clique sur « Décrire avec l'IA » dans la visionneuse, LE SYSTÈME DOIT envoyer l'image (une version réduite, au plus 1024 px, en JPEG) à un modèle image-texte hébergé par Hugging Face (Inference Providers, API compatible OpenAI) et afficher la description obtenue, en français.
2. LE modèle DOIT être configurable (`HF_VISION_MODEL`, `Qwen/Qwen3.8-27B` par défaut) ; le jeton d'accès (`HF_TOKEN`) est un secret du Worker, jamais versionné ni envoyé à la galerie.
3. LA description DOIT être générée **à la demande seulement** (jamais pendant la collecte), puis **conservée dans un champ séparé** (`ai_description`, avec le modèle et la date), sans jamais remplacer le texte alternatif du créateur. Elle est écrite dans `post.json` et incluse dans la recherche plein texte.
4. LA visionneuse DOIT afficher une description conservée avec la mention « Générée par IA » et le modèle, distincte de celle du créateur, et proposer « Régénérer ».
5. Pour une vidéo, LE SYSTÈME DOIT décrire sa miniature ; sans miniature, le bouton n'est pas proposé.
6. SI le jeton manque, est refusé, si les crédits sont épuisés, si le quota est atteint ou si le modèle ne répond pas, ALORS LE SYSTÈME DOIT afficher un message explicite et ne rien conserver.
7. LE texte renvoyé par le modèle DOIT être nettoyé (raisonnement `<think>` retiré, espaces superflus) et limité à 2 000 caractères.

## Questions ouvertes
- **Q1 — Reddit.** Tranchée le 2026-09-28 : Reddit conservé, sans purge en v1. Reprise le 2026-10-01 : la purge est implémentée (exigence 5.5), ce qui supprime l'écart avec les conditions Reddit. Reste la fréquence : la vérification est à la demande (exigence 5.2) et Reddit recommande de supprimer sous 48 heures ; tant qu'aucune vérification n'est lancée, une publication supprimée à la source reste dans l'archive. Option à évaluer si Reddit l'exige : vérification planifiée limitée à Reddit.
- **Q2 — Bluesky et le contenu supprimé.** Vérifier dans les conditions développeur de Bluesky si la conservation d'une publication supprimée est permise. Le choix de ne pas purger s'applique aussi à Bluesky en v1.
- **Q4 — Vidéos Reddit.** La vidéo archivée est la version sans piste audio (Reddit sert l'audio séparément). Ajouter l'audio exigerait un assemblage hors du Worker.
- **Q5 — Mastodon et le contenu supprimé.** Le fediverse n'a pas de conditions d'API uniformes : chaque serveur fixe ses règles, et la culture du réseau attend que les suppressions se propagent. Par cohérence avec Bluesky, une publication Mastodon supprimée garde sa copie avec le statut « supprimé » (usage strictement personnel). À réévaluer, notamment si un serveur l'interdit.
- **Q6 — Chargement automatique au défilement.** La galerie charge la page suivante dès qu'on approche du bas (un observateur d'intersection avec une marge de 800 px), en plus du bouton « Afficher plus ». Sur une archive longue, cela donne un défilement continu, ce que l'intention anti-doomscrolling cherche à éviter. Option à évaluer : ne garder que le bouton « Afficher plus » (une pause explicite à chaque page) et afficher le nombre de publications restantes. Non traitée pour l'instant.
- **Q3 — Volume.** Estimer le volume vidéo par créateur pour valider les 10 Go gratuits de R2.
