---
inclusion: fileMatch
fileMatchPattern: "src/connectors/reddit/**"
---
# API de données Reddit

Sources officielles (consultées le 2026-09-27) :
- Reddit Data API Wiki : https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- Responsible Builder Policy : https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
- Developer Terms et Data API Terms (liées depuis le wiki) : font foi en cas d'écart.

## Accès
- Une approbation explicite est requise avant tout accès aux données. Aucun code Reddit n'est déployé sans elle.
- Authentification OAuth obligatoire ; le trafic sans OAuth est bloqué.
- Une seule demande d'accès pour ce cas d'usage ; pas de comptes multiples.

## User-Agent (obligatoire, jamais falsifié)
`<plateforme>:<id app>:<version> (by /u/<utilisateur>)`, par exemple `cloudflare-worker:memento:v0.4.0 (by /u/...)`. Incrémenter la version à chaque livraison.

## Quotas
- 100 requêtes par minute par identifiant client OAuth, moyennées sur 10 minutes.
- Lire `X-Ratelimit-Remaining` et `X-Ratelimit-Reset` à chaque réponse ; suspendre sous le seuil configuré.

## Contenu supprimé (écart assumé en v1)
Décision projet du 2026-09-28 : pas de purge en v1, les publications supprimées gardent leur copie avec le statut « supprimé ». Rappel des règles officielles :
- Tout contenu supprimé de Reddit doit être supprimé de nos systèmes : titre, texte, URL, médias.
- Un compte supprimé impose d'effacer toutes les informations d'identification de l'auteur.
- Conserver un contenu supprimé, même anonymisé, viole les conditions.
- Reddit recommande fortement de supprimer routinièrement les données stockées sous 48 heures (voir question ouverte Q1 dans `requirements.md`).

## Interdits
Usage commercial ou revente sans accord écrit ; entraînement de modèles ; inférence de caractéristiques sensibles ; contournement des quotas.
