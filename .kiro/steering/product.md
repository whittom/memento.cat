---
inclusion: always
---
# Produit

## Objectif
Suivre des créateurs choisis sur les réseaux sociaux et conserver une archive personnelle de leurs publications (texte, titre, médias et descriptions de médias), consultable sans ouvrir les plateformes.

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
- Pas de purge des contenus supprimés en v1 (usage personnel) ; écart connu avec les conditions Reddit, documenté dans la spec.
- L'archive n'est jamais publique.
