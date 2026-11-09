-- ─── Migration 011: alerts, activity_log, kpis ──────────────────────────────
-- Creates tables for data alerts, activity log, and KPI cards with RLS policies.

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE alert_type AS ENUM ('analysis', 'prediction', 'danger', 'deadline', 'imminent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM ('ai', 'system', 'alert', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trend_direction AS ENUM ('up', 'down', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Alerts table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  type        alert_type NOT NULL DEFAULT 'analysis',
  severity    alert_severity NOT NULL DEFAULT 'info',
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  source      TEXT NOT NULL DEFAULT 'system',
  region      TEXT,
  deadline    TIMESTAMPTZ,
  action_url  TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- ─── Activity log table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  type        activity_type NOT NULL DEFAULT 'system',
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

-- ─── KPIs table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpis (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  value       TEXT NOT NULL,
  change      TEXT NOT NULL DEFAULT '',
  trend       trend_direction NOT NULL DEFAULT 'neutral',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpis_sort_order ON kpis(sort_order);

-- ─── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alerts_updated_at ON alerts;
CREATE TRIGGER trg_alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_kpis_updated_at ON kpis;
CREATE TRIGGER trg_kpis_updated_at
  BEFORE UPDATE ON kpis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpis ENABLE ROW LEVEL SECURITY;

-- Alerts: users can see their own alerts + global alerts (user_id IS NULL).
DROP POLICY IF EXISTS "alerts_select_own_or_global" ON alerts;
CREATE POLICY "alerts_select_own_or_global" ON alerts
  FOR SELECT USING (
    user_id = auth.uid() OR user_id IS NULL
  );

-- Alerts: users can update read status of their own alerts.
DROP POLICY IF EXISTS "alerts_update_own" ON alerts;
CREATE POLICY "alerts_update_own" ON alerts
  FOR UPDATE USING (user_id = auth.uid());

-- Alerts: service role can do everything (managed via server-side admin client).
-- (No INSERT/DELETE policy for authenticated users — only service role bypasses RLS.)

-- Activity log: users can see their own activity + global activity.
DROP POLICY IF EXISTS "activity_log_select_own_or_global" ON activity_log;
CREATE POLICY "activity_log_select_own_or_global" ON activity_log
  FOR SELECT USING (
    user_id = auth.uid() OR user_id IS NULL
  );

-- KPIs: all authenticated users can read.
DROP POLICY IF EXISTS "kpis_select_all" ON kpis;
CREATE POLICY "kpis_select_all" ON kpis
  FOR SELECT TO authenticated USING (true);

-- ─── Seed data ──────────────────────────────────────────────────────────────
INSERT INTO kpis (title, value, change, trend, description, sort_order) VALUES
  ('Total Cases', '1,284,592', '+12.5%', 'up', 'Total TB cases reported this year', 1),
  ('Treatment Success Rate', '87.3%', '+2.1%', 'up', 'Percentage of successful treatments', 2),
  ('Case Detection Rate', '68.4%', '-3.2%', 'down', 'Estimated detection rate', 3),
  ('High-Risk Provinces', '12', '+2', 'up', 'Provinces below WHO threshold', 4)
ON CONFLICT DO NOTHING;

INSERT INTO alerts (title, message, type, severity, source, region, deadline, action_url) VALUES
  ('TB Detection Rate Below Threshold', 'The case detection rate in Kinshasa has dropped below the WHO threshold of 70%.', 'analysis', 'warning', 'ML Engine', 'Kinshasa', now() + interval '14 days', '/dashboard'),
  ('Predicted Outbreak Risk', 'ML model predicts a 78% probability of TB outbreak in Nord-Kivu within the next 30 days.', 'prediction', 'critical', 'ML Engine', 'Nord-Kivu', now() + interval '30 days', '/dashboard'),
  ('Treatment Stockout Imminent', 'Anti-TB medication stock in Haut-Katanga will run out in 5 days based on current consumption.', 'imminent', 'critical', 'Inventory System', 'Haut-Katanga', now() + interval '5 days', '/dashboard'),
  ('Monthly Report Deadline', 'The monthly TB surveillance report is due in 3 days.', 'deadline', 'warning', 'System', NULL, now() + interval '3 days', '/dashboard'),
  ('Anomaly Detected in Data', 'Unusual spike in reported cases in Equateur province — possible data quality issue.', 'danger', 'info', 'Data Quality', 'Equateur', NULL, '/dashboard')
ON CONFLICT DO NOTHING;

INSERT INTO activity_log (title, type) VALUES
  ('AI assistant analyzed TB trends', 'ai'),
  ('New alert: TB detection rate below threshold', 'alert'),
  ('System updated KPI dashboard', 'system'),
  ('User logged in', 'user')
ON CONFLICT DO NOTHING;
