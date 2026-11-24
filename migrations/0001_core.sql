-- Core tables from tracking/CONTRACT.md (frozen v1).
-- Timestamps are ms since epoch (integer). day is 'YYYY-MM-DD' in UTC.
-- owner is 0/1. test is '' for real traffic, otherwise the test id string.
-- No IP address, no user agent, no typed text is ever stored.

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  vid       TEXT NOT NULL,
  sid       TEXT NOT NULL,
  pid       TEXT NOT NULL,
  name      TEXT NOT NULL,
  path      TEXT NOT NULL,
  page_type TEXT,
  device    TEXT,
  lang      TEXT,
  country   TEXT,
  link      TEXT,
  owner     INTEGER NOT NULL DEFAULT 0,
  test      TEXT NOT NULL DEFAULT '',
  params    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts        ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_name_ts   ON events (name, ts);
CREATE INDEX IF NOT EXISTS idx_events_sid       ON events (sid, ts);
CREATE INDEX IF NOT EXISTS idx_events_path_ts   ON events (path, ts);
CREATE INDEX IF NOT EXISTS idx_events_vid       ON events (vid, ts);
CREATE INDEX IF NOT EXISTS idx_events_link_ts   ON events (link, ts) WHERE link IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_test      ON events (test) WHERE test <> '';

CREATE TABLE IF NOT EXISTS sessions (
  sid          TEXT PRIMARY KEY,
  vid          TEXT NOT NULL,
  first_ts     INTEGER NOT NULL,
  last_ts      INTEGER NOT NULL,
  landing      TEXT,
  ref_host     TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  link         TEXT,
  country      TEXT,
  device       TEXT,
  owner        INTEGER NOT NULL DEFAULT 0,
  test         TEXT NOT NULL DEFAULT '',
  pages        INTEGER NOT NULL DEFAULT 0,
  events       INTEGER NOT NULL DEFAULT 0,
  active_ms    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_first ON sessions (first_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_last  ON sessions (last_ts);
CREATE INDEX IF NOT EXISTS idx_sessions_vid   ON sessions (vid);
CREATE INDEX IF NOT EXISTS idx_sessions_link  ON sessions (link, first_ts) WHERE link IS NOT NULL;

CREATE TABLE IF NOT EXISTS links (
  slug          TEXT PRIMARY KEY,
  dest          TEXT NOT NULL,
  channel       TEXT NOT NULL,
  campaign      TEXT,
  content_label TEXT,
  app_label     TEXT,
  created       INTEGER NOT NULL,
  retired       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_channel ON links (channel, created);

CREATE TABLE IF NOT EXISTS link_clicks (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  slug    TEXT NOT NULL,
  country TEXT,
  device  TEXT,
  is_bot  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clicks_slug_ts ON link_clicks (slug, ts);
CREATE INDEX IF NOT EXISTS idx_clicks_ts      ON link_clicks (ts);

CREATE TABLE IF NOT EXISTS cursor_bins (
  day    TEXT NOT NULL,
  path   TEXT NOT NULL,
  device TEXT NOT NULL,
  kind   TEXT NOT NULL,
  x      INTEGER NOT NULL,
  y      INTEGER NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  test   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (day, path, device, kind, x, y, test)
);
CREATE INDEX IF NOT EXISTS idx_bins_path ON cursor_bins (path, device, kind);

CREATE TABLE IF NOT EXISTS daily_rollup (
  day      TEXT NOT NULL,
  name     TEXT NOT NULL,
  "key"    TEXT NOT NULL DEFAULT '',
  n        INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, "key")
);
