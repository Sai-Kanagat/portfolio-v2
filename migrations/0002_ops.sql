-- Operational tables: ingest counters (aggregate only, no PII) and health checks.

CREATE TABLE IF NOT EXISTS ingest_stats (
  day    TEXT NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, detail)
);

CREATE TABLE IF NOT EXISTS health (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_ts ON health (ts);
CREATE INDEX IF NOT EXISTS idx_health_check ON health (check_name, ts);
