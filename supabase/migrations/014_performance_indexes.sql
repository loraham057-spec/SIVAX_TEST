-- ─── Migration 014: performance indexes ─────────────────────────────────────
-- Covers the read patterns that were doing sequential scans:
--   · GET /api/etl/status        → ORDER BY started_at DESC LIMIT n
--   · GET /api/dhis2/analytics   → WHERE source = ? AND org_unit_id = ? ORDER BY period
--   · dim_org_units resolution   → lookups by parent for the hierarchy

-- ETL run history: the admin dashboard always reads the most recent runs.
CREATE INDEX IF NOT EXISTS idx_etl_runs_started_at
  ON etl_runs (started_at DESC);

-- Warehouse reads always filter on (source, org_unit_id) and sort by period.
-- The three single-column indexes from migration 001 cannot serve that
-- combination; this composite one does, and covers `value` so the heap is not
-- touched for the dashboard query.
CREATE INDEX IF NOT EXISTS idx_fiv_source_ou_period
  ON fact_indicator_values (source, org_unit_id, period DESC)
  INCLUDE (indicator_id, value);

-- Trend queries scoped to one indicator across periods.
CREATE INDEX IF NOT EXISTS idx_fiv_indicator_period
  ON fact_indicator_values (indicator_id, period DESC);

-- Hierarchy walks (national → province → zone de santé).
CREATE INDEX IF NOT EXISTS idx_dim_org_units_parent
  ON dim_org_units (parent_id);
