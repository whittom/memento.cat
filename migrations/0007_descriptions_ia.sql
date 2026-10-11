-- Description d'un média générée par IA, à la demande (exigence 11) : séparée du texte alternatif du créateur.
ALTER TABLE media ADD COLUMN ai_description TEXT;
ALTER TABLE media ADD COLUMN ai_description_model TEXT;
ALTER TABLE media ADD COLUMN ai_description_at TEXT;
