-- Schéma initial de memento

CREATE TABLE creators (
  id TEXT PRIMARY KEY,                     -- "<plateforme>:<id stable>"
  platform TEXT NOT NULL CHECK (platform IN ('bluesky', 'reddit')),
  handle TEXT NOT NULL,
  display_name TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'deleted', 'purging')),
  deleted_at TEXT,
  cursor TEXT,                             -- date ISO de la dernière publication archivée
  created_at TEXT NOT NULL,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,                     -- "<plateforme>:<id natif>"
  creator_id TEXT NOT NULL REFERENCES creators(id),
  native_ref TEXT NOT NULL,                -- URI at:// (Bluesky) ou fullname t3_ (Reddit)
  published_at TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  r2_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  captured_at TEXT NOT NULL,
  deleted_seen_at TEXT,
  checked_at TEXT
);
CREATE INDEX posts_creator_date ON posts(creator_id, published_at DESC, id DESC);
CREATE INDEX posts_date ON posts(published_at DESC, id DESC);
CREATE INDEX posts_checked ON posts(creator_id, checked_at);

CREATE TABLE media (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'gif')),
  mime_type TEXT,
  r2_key TEXT,
  etag TEXT,                               -- empreinte MD5 calculée par R2
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  thumb_r2_key TEXT,
  thumb_width INTEGER,
  thumb_height INTEGER,
  description TEXT,
  source_url TEXT NOT NULL,
  downloaded INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT,
  PRIMARY KEY (post_id, position)
);
CREATE INDEX media_unviewed ON media(post_id) WHERE viewed_at IS NULL;

CREATE VIRTUAL TABLE posts_fts USING fts5(post_id UNINDEXED, title, text, media_descriptions);
