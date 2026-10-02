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

## Contenu supprimé : effacement définitif
Règles officielles :
- Tout contenu supprimé de Reddit doit être supprimé de nos systèmes : titre, texte, URL, médias.
- Un compte supprimé impose d'effacer toutes les informations d'identification de l'auteur.
- Conserver un contenu supprimé, même anonymisé, viole les conditions.
- Reddit recommande fortement de supprimer routinièrement les données stockées sous 48 heures.

Application (décision du 2026-10-01, qui remplace celle du 2026-09-28 « pas de purge ») : la vérification des suppressions efface définitivement toute publication Reddit constatée supprimée (`isRemoved` : auteur `[deleted]`, `removed_by_category` renseigné, texte `[deleted]` ou `[removed]`), fichiers R2 d'abord, puis lignes D1. Aucune copie ni statut « supprimé » n'est gardé.
- L'effacement est irréversible : une réponse de `/api/info` sans `data.children` lève une erreur et n'efface rien, de même qu'une erreur HTTP ou un quota atteint. Une publication omise d'une réponse valide compte comme supprimée (Reddit ne renvoie plus les identifiants disparus).
- La constatation reste à la demande (exigence 5.2). Pour approcher la recommandation de 48 heures, lancer régulièrement « Vérifier les suppressions » sur chaque créateur Reddit ; une vérification planifiée limitée à Reddit est l'option à évaluer si Reddit l'exige.
- Si un compte Reddit suivi est lui-même supprimé, ses publications sont effacées à la vérification ; la fiche du créateur reste dans la liste jusqu'à ce que vous la supprimiez.

## Interdits
Usage commercial ou revente sans accord écrit ; entraînement de modèles ; inférence de caractéristiques sensibles ; contournement des quotas.
