---
inclusion: fileMatch
fileMatchPattern: "web/**"
---
# Galerie (SPA)

Règles du projet (pas de guide officiel unique pour ce domaine).

- Application monopage : navigation par routes côté client (`/`, `/createur/:id`, `/publication/:id`), l'URL reflète toujours les filtres pour permettre le partage d'un lien interne et le retour arrière.
- Adaptative, conçue d'abord pour le mobile : points de rupture à 640, 1024 et 1536 px ; grille de 2, 3, 4 puis 5 colonnes. Filtres repliés sous « Filtres » sur mobile.
- Direction visuelle : planche contact sur table lumineuse. Une seule couleur d'accent, le rouge « crayon gras », réservée au marquage des médias non consultés.
- Images chargées paresseusement (`loading="lazy"`), dimensions réservées pour éviter les sauts de mise en page.
- Accessibilité : texte alternatif archivé réutilisé comme `alt`, navigation au clavier, contraste AA.
- La SPA ne parle qu'à `/api/*` ; aucun appel direct à une plateforme.
- Pagination par curseur (défilement infini ou bouton « Plus »).
- Miniatures d'abord : la grille ne charge jamais la version complète d'un média, sauf en l'absence de miniature.
- Indicateur « non consulté » : pastille avec texte ou icône, jamais la couleur seule.
- Groupe de médias : toujours identifiable par l'effet de pile et le compteur, sur toutes les largeurs d'écran.
- Visionneuse : focus piégé tant qu'elle est ouverte, rendu au déclencheur à la fermeture ; flèches, Échap et balayage pris en charge.
