-- ─── Migration 017: RLS policies for dashboard views and tables ────────────
-- The dashboard reads from views and tables using the anon key (via SSR).
-- RLS is enabled on these tables but no SELECT policy exists, so the anon
-- key returns 0 rows. This migration adds read-only policies for
-- authenticated users and anon (public read for dashboard data).

-- ─── Policies for dim_indicators ──────────────────────────────────────────
DROP POLICY IF EXISTS "dim_indicators_read" ON dim_indicators;
CREATE POLICY "dim_indicators_read" ON dim_indicators
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for dim_org_units ───────────────────────────────────────────
DROP POLICY IF EXISTS "dim_org_units_read" ON dim_org_units;
CREATE POLICY "dim_org_units_read" ON dim_org_units
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for fact_indicator_values ───────────────────────────────────
DROP POLICY IF EXISTS "fact_indicator_values_read" ON fact_indicator_values;
CREATE POLICY "fact_indicator_values_read" ON fact_indicator_values
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for etl_runs ────────────────────────────────────────────────
DROP POLICY IF EXISTS "etl_runs_read" ON etl_runs;
CREATE POLICY "etl_runs_read" ON etl_runs
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for kpis table ──────────────────────────────────────────────
DROP POLICY IF EXISTS "kpis_read" ON kpis;
CREATE POLICY "kpis_read" ON kpis
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for alerts table ────────────────────────────────────────────
DROP POLICY IF EXISTS "alerts_read" ON alerts;
CREATE POLICY "alerts_read" ON alerts
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Policies for activity_log table ──────────────────────────────────────
DROP POLICY IF EXISTS "activity_log_read" ON activity_log;
CREATE POLICY "activity_log_read" ON activity_log
  FOR SELECT TO anon, authenticated
  USING (true);

-- ─── Note on views ────────────────────────────────────────────────────────
-- Views inherit RLS from their underlying tables. Since we've added
-- SELECT policies on dim_indicators, dim_org_units, and fact_indicator_values,
-- the views v_latest_kpi_values and v_province_latest_values will now
-- return data to the anon key.
