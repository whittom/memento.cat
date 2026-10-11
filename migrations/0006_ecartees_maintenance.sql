-- Fiches supprimées par le ménage des doublons : ne plus jamais les archiver (exigence 9.13).
CREATE TABLE discarded_posts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  discarded_at TEXT NOT NULL
);
CREATE INDEX discarded_creator ON discarded_posts(creator_id);

-- Maintenance planifiée des doublons (exigences 9.15 et 9.17) : dernier passage complet sur ce créateur.
ALTER TABLE creators ADD COLUMN dedupe_checked_at TEXT;
