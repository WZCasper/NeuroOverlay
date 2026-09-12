-- Adds support for multiple overlay profiles per account (e.g. a separate
-- 16:9 and 9:16 layout, each with its own OBS/TikTok link). Run this once
-- against the live database the same way as 0001_init.sql:
--   npx wrangler d1 execute neuroverlay --file=migrations/0002_profiles.sql --remote
-- (or paste its contents into the D1 Console on the Cloudflare dashboard,
-- one statement at a time if it complains about running several at once).
--
-- Safe to run more than once -- existing users are only migrated if they
-- don't already have a profile row (WHERE NOT EXISTS below), and nothing
-- here deletes or overwrites the old users.overlay_token / overlay_settings
-- data, which stays untouched as a safety net.

CREATE TABLE IF NOT EXISTS overlay_profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  token            TEXT UNIQUE NOT NULL,
  state              TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_overlay_profiles_user_id ON overlay_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_overlay_profiles_token ON overlay_profiles(token);

-- Give every existing account its first profile, carrying over their
-- current token and saved state exactly as-is, so nobody's OBS/TikTok
-- link changes because of this migration.
INSERT INTO overlay_profiles (user_id, name, token, state, created_at, updated_at)
SELECT u.id, 'Основной', u.overlay_token, COALESCE(s.state, '{}'), u.created_at, COALESCE(s.updated_at, u.updated_at)
FROM users u
LEFT JOIN overlay_settings s ON s.user_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM overlay_profiles p WHERE p.user_id = u.id);
