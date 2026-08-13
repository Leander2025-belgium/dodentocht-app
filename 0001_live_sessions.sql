CREATE TABLE IF NOT EXISTS live_sessions (
  code TEXT PRIMARY KEY NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_viewer_at INTEGER,
  snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_updated_at
  ON live_sessions(updated_at);
