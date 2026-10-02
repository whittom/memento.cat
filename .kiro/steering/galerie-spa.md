---
inclusion: fileMatch
fileMatchPattern: "web/**"
---
# Galerie (SPA)

Règles du projet (pas de guide officiel unique pour ce domaine).

- Application monopage : navigation par routes côté client (`/`, `/createur/:id`, `/publication/:id`), l'URL reflète toujours les filtres pour permettre le partage d'un lien interne et le retour arrière.
- Adaptative, conçue d'abord pour le mobile : points de rupture à 640, 1024 et 1536 px ; grille de 2, 3, 4 puis 5 colonnes. Filtres repliés sous « Filtres » sur mobile.
- Direction visuelle : un catalogue de souvenirs (memento.cat), avec un chat en clin d'œil discret. Chaque publication est une fiche de catalogue : carte arrondie, filet pointillé de détachement, numéro d'inventaire en chasse fixe (`n° 0042`, le `rowid` de `posts`). Le logo associe `memento`, `.cat` en chasse fixe et une petite tête de chat au trait ; jamais plus d'un chat par écran. Une seule couleur d'accent, le rouge, réservée au marquage des médias non consultés : une pastille discrète (point rouge plein et « Nouveau », point évidé et « N non vus » si partiel) ; dans la page des créateurs, seulement le point et le compte, sans cadre.
- Thèmes clair (papier crème, encre presque noire) et sombre (« chambre noire »), selon la préférence du système ; contraste AA dans les deux. La visionneuse reste sombre dans les deux thèmes.
- Images chargées paresseusement (`loading="lazy"`), dimensions réservées pour éviter les sauts de mise en page.
- Accessibilité : texte alternatif archivé réutilisé comme `alt`, navigation au clavier, contraste AA.
- La SPA ne parle qu'à `/api/*` ; aucun appel direct à une plateforme.
- Politique de sécurité du contenu (CSP) stricte : aucun script ni style en ligne (pas de `<script>` sans `src`, pas d'attribut `style` ni `on*` dans le HTML, pas de `innerHTML`), aucune ressource externe autre que Google Fonts. Ajouter une origine externe exige de modifier `src/security.ts` et la spec.
- Pagination par curseur (défilement infini ou bouton « Plus »).
- Miniatures d'abord : la grille ne charge jamais la version complète d'un média, sauf en l'absence de miniature.
- Indicateur « non consulté » : pastille avec texte ou icône, jamais la couleur seule.
- Filtre « Non consultés seulement » : un bouton à bascule (`aria-pressed`), plein et précédé d'une coche quand il est actif, et non une case à cocher.
- Groupe de médias : toujours identifiable par l'effet de pile et le compteur, sur toutes les largeurs d'écran.
- Visionneuse : focus piégé tant qu'elle est ouverte, rendu au déclencheur à la fermeture ; flèches, Échap et balayage pris en charge. Loupe sur les images : pleine résolution (1 pixel d'image pour 1 pixel d'écran), déplacement au glissement et au clavier, retour par Échap ; le zoom ne change jamais l'état « consulté ». Un clic en dehors de l'image (fond, marges d'ajustement) ferme la visionneuse ; un clic sur l'image ouvre la loupe.
