-- Index sur les clés R2 des médias. Chaque média servi par /api/media/<clé> vérifie que la clé
-- appartient à une publication visible (isVisibleKey) ; sans ces index, la requête lisait toute
-- la table media à chaque miniature affichée, ce qui épuise vite le quota de lectures D1.
CREATE INDEX IF NOT EXISTS media_r2_key ON media(r2_key);
CREATE INDEX IF NOT EXISTS media_thumb_r2_key ON media(thumb_r2_key);
