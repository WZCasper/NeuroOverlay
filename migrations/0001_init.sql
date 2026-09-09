-- NeuroOverlay D1 schema (SQLite dialect). Applied via:
--   npx wrangler d1 execute neuroverlay --file=migrations/0001_init.sql --local   (for local dev)
--   npx wrangler d1 execute neuroverlay --file=migrations/0001_init.sql --remote  (for the real deploy)
-- The site is free -- there is no trial/subscription state, just accounts.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER UNIQUE NOT NULL,
  username         TEXT,
  first_name        TEXT,
  last_name          TEXT,
  photo_url           TEXT,
  is_admin              INTEGER NOT NULL DEFAULT 0,
  overlay_token          TEXT UNIQUE NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS overlay_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state        TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_overlay_token ON users(overlay_token);
