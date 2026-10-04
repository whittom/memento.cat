-- Médias identiques (doublons) : un média dont le fichier est le même que celui d'un média déjà archivé
-- du même créateur est lié à celui-ci et n'a pas de fichier propre (exigence 9).
ALTER TABLE media ADD COLUMN duplicate_post_id TEXT;
ALTER TABLE media ADD COLUMN duplicate_position INTEGER;
CREATE INDEX media_duplicates ON media(duplicate_post_id) WHERE duplicate_post_id IS NOT NULL;
CREATE INDEX media_etag ON media(etag) WHERE etag IS NOT NULL;
CREATE INDEX media_source ON media(source_url);
