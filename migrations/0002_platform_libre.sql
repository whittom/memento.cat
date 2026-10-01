-- Retire la contrainte CHECK sur creators.platform (0001 n'autorisait que bluesky et reddit).
-- La plateforme est désormais validée dans le code (isPlatform) : ajouter une plateforme
-- ne demandera plus de reconstruire la table. Les données sont conservées telles quelles.
--
-- posts.creator_id référence creators : D1 impose les clés étrangères en permanence. On copie donc
-- les créateurs dans une table de passage, on supprime et recrée creators, puis on les recopie ;
-- la vérification des clés étrangères est différée jusqu'à la fin de la migration, où les
-- publications retrouvent leur créateur.

PRAGMA defer_foreign_keys = on;

CREATE TABLE creators_old AS SELECT * FROM creators;

DROP TABLE creators;

CREATE TABLE creators (
  id TEXT PRIMARY KEY,                     -- "<plateforme>:<id stable>"
  platform TEXT NOT NULL,
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

INSERT INTO creators (id, platform, handle, display_name, state, deleted_at, cursor, created_at, last_run_at, last_success_at, last_error)
SELECT id, platform, handle, display_name, state, deleted_at, cursor, created_at, last_run_at, last_success_at, last_error
FROM creators_old;

DROP TABLE creators_old;
