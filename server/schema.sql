-- BSV EquiCare — Postgres schema (pilot).
-- Run once against your DATABASE_URL (host it in your data-residency region,
-- e.g. Mumbai ap-south-1, for DPDP). TimescaleDB optional but recommended for
-- the readings hypertable at scale.

CREATE TABLE IF NOT EXISTS readings (
  id          TEXT PRIMARY KEY,
  horse_id    TEXT,
  stall_id    TEXT,
  metric      TEXT NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  unit        TEXT,
  ts          TIMESTAMPTZ NOT NULL,
  source      TEXT,
  confidence  DOUBLE PRECISION DEFAULT 1,
  meta        JSONB
);

CREATE INDEX IF NOT EXISTS readings_horse_ts_idx ON readings (horse_id, ts DESC);
CREATE INDEX IF NOT EXISTS readings_metric_ts_idx ON readings (metric, ts DESC);
CREATE INDEX IF NOT EXISTS readings_ts_idx ON readings (ts DESC);

CREATE TABLE IF NOT EXISTS alert_acks (
  alert_key   TEXT PRIMARY KEY,
  acked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TimescaleDB (optional):
--   CREATE EXTENSION IF NOT EXISTS timescaledb;
--   SELECT create_hypertable('readings','ts', if_not_exists => TRUE);
--   -- retention: drop raw readings older than 90 days
--   SELECT add_retention_policy('readings', INTERVAL '90 days');

-- User-authored records (horses, diary notes, health tasks, feed plans,
-- invoices, breeding records). Stored generically so adding a record type is
-- an API change, not a migration.
CREATE TABLE IF NOT EXISTS entities (
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS entities_kind_idx ON entities (kind, created_at);
