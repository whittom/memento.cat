---
inclusion: always
---
# Produit

## Objectif
Suivre des créateurs choisis sur les réseaux sociaux et conserver une archive personnelle de leurs publications (texte, titre, médias et descriptions de médias), consultable sans ouvrir les plateformes.

## Intention : une alternative simple au doomscrolling
memento est aussi une façon plus calme de suivre ce que publient des gens qu'on aime lire, sans passer par les fils des réseaux sociaux. Le défilement sans fin d'un fil algorithmique (le « doomscrolling ») est conçu pour retenir l'attention ; memento fait l'inverse : on consulte quand on le décide, et il y a une fin.
- **Un ensemble fini et choisi** : seuls les créateurs suivis explicitement apparaissent. Ni recommandations, ni « tendances », ni contenu suggéré, ni publicités.
- **Du contenu original seulement** : pas de commentaires, de réponses, de republications ni de citations d'autres comptes (donc pas de polémiques relayées) ; seules les publications avec images, vidéos ou GIF sont gardées.
- **Aucun indicateur d'engagement** : ni mentions « j'aime », ni compteurs de partages ou de réponses, ni scores. Ils ne sont même pas archivés.
- **Une ligne d'arrivée** : les médias non consultés sont signalés, un filtre « non consultés seulement » les isole, et on peut tout marquer comme consulté. Quand il n'y en a plus, c'est fini.
- **Pas de sollicitation** : aucune notification, aucun courriel de rappel (le seul courriel est le code de connexion de Cloudflare Access), aucune lecture automatique des vidéos ; la collecte se fait en arrière-plan et rien ne réclame d'ouvrir la galerie.
- **Ordre chronologique** : du plus récent au plus ancien, sans tri par popularité.
- **À l'écart des plateformes** : on consulte l'archive sans ouvrir les applications d'origine, donc sans leurs fils ni leurs suggestions.

## Utilisateur
Un seul utilisateur (le propriétaire de l'archive). Usage personnel et non commercial.

## Périmètre v1
- Plateformes : Bluesky et Mastodon (et serveurs compatibles), puis Reddit si l'accès à l'API est approuvé.
- Collecte planifiée des nouvelles publications, et synchronisation manuelle par créateur ; seules les contributions originales avec médias sont archivées (ni commentaires, ni réponses, ni republications, ni publications texte seul).
- Galerie monopage et adaptative (mobile, tablette, bureau), filtrable par créateur, plateforme et période.
- Vérification des suppressions déclenchée à la demande seulement, créateur par créateur.

## Hors périmètre v1
Instagram, Facebook, Threads, X ; publication ou interaction ; comptes privés ; accès par un compte utilisateur automatisé ou par collecte des pages web (contraire aux conditions des plateformes).

## Principes
- Canaux officiels uniquement, quotas respectés.
- Contenus supprimés à la source : Bluesky et Mastodon gardent la copie avec le statut « supprimé » (usage personnel, questions Q2 et Q5) ; Reddit les efface définitivement, comme l'exigent les conditions de son API.
- L'archive n'est jamais publique.
