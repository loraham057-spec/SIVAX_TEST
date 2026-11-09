-- ─── Migration 019: Performance optimizations ───────────────────────────────
--
-- Problem: v_province_latest_values takes 11-19s per query (Supabase pg_stat_statements).
-- Root cause: correlated subquery SELECT MAX(period) ... for each row does a full scan.
--
-- Fixes:
-- 1. Add composite indexes on fact_indicator_values for (indicator_id, org_unit_id, period)
-- 2. Add index on dim_org_units(level) — used by v_province_latest_values WHERE clause
-- 3. Add index on dim_indicators(domain) — used by domain filter queries
-- 4. Rewrite v_province_latest_values and v_latest_kpi_values using DISTINCT ON
--    (eliminates the correlated subquery entirely)
-- 5. Add composite index on notifications(user_id, created_at DESC) for the
--    combined "user notifications OR broadcast" query
--
-- Source: Supabase pg_stat_statements + index_advisor recommendations

-- ─── 1. Composite indexes on fact_indicator_values ─────────────────────────
-- These accelerate the MAX(period) lookup per (indicator_id, org_unit_id)
-- which is the bottleneck in both v_province_latest_values and v_latest_kpi_values.

-- Composite index: (indicator_id, org_unit_id, period DESC)
-- Covers: MAX(period) WHERE indicator_id = X AND org_unit_id = Y
CREATE INDEX IF NOT EXISTS idx_fiv_ind_ou_period
  ON fact_indicator_values (indicator_id, org_unit_id, period DESC);

-- Composite index: (org_unit_id, indicator_id, period DESC)
-- Covers: queries that filter by org_unit first (e.g. all indicators for a province)
CREATE INDEX IF NOT EXISTS idx_fiv_ou_ind_period
  ON fact_indicator_values (org_unit_id, indicator_id, period DESC);

-- ─── 2. Index on dim_org_units(level) ──────────────────────────────────────
-- Used by v_province_latest_values WHERE dou.level = 2
CREATE INDEX IF NOT EXISTS idx_dim_org_units_level
  ON dim_org_units (level);

-- Index on dim_org_units(name) — recommended by Supabase index_advisor
CREATE INDEX IF NOT EXISTS idx_dim_org_units_name
  ON dim_org_units (name);

-- ─── 3. Index on dim_indicators(domain) ────────────────────────────────────
-- Used by queries filtering v_province_latest_values by domain (e.g. domain = 'vaccination')
CREATE INDEX IF NOT EXISTS idx_dim_indicators_domain
  ON dim_indicators (domain);

-- ─── 4. Rewrite v_province_latest_values using DISTINCT ON ─────────────────
-- DISTINCT ON (indicator_id, org_unit_id) with ORDER BY ... period DESC
-- is equivalent to the correlated subquery but uses a single scan + sort,
-- which is dramatically faster with the composite index.
CREATE OR REPLACE VIEW v_province_latest_values AS
SELECT
  fiv.indicator_id,
  di.label,
  di.unit,
  di.domain,
  fiv.org_unit_id,
  dou.name AS org_unit_name,
  fiv.period AS latest_period,
  fiv.value AS latest_value
FROM (
  SELECT DISTINCT ON (indicator_id, org_unit_id)
    indicator_id,
    org_unit_id,
    period,
    value
  FROM fact_indicator_values
  ORDER BY indicator_id, org_unit_id, period DESC
) fiv
JOIN dim_indicators di ON fiv.indicator_id = di.id
JOIN dim_org_units dou ON fiv.org_unit_id = dou.id
WHERE dou.level = 2
  AND fiv.org_unit_id != 'ymGeqzoPhN3';

-- ─── 5. Rewrite v_latest_kpi_values using DISTINCT ON ──────────────────────
-- Same optimization: replace correlated subquery with DISTINCT ON + window function
CREATE OR REPLACE VIEW v_latest_kpi_values AS
SELECT
  latest.indicator_id,
  di.label,
  di.unit,
  di.domain,
  di.icon_key,
  latest.period AS latest_period,
  latest.value AS latest_value,
  prev.value AS prev_value,
  CASE
    WHEN prev.value IS NULL THEN NULL
    WHEN prev.value = 0 THEN NULL
    ELSE ROUND(((latest.value - prev.value) / prev.value) * 100, 1)
  END AS pct_change
FROM (
  SELECT DISTINCT ON (indicator_id, org_unit_id)
    indicator_id,
    org_unit_id,
    period,
    value
  FROM fact_indicator_values
  WHERE org_unit_id = 'ymGeqzoPhN3'
  ORDER BY indicator_id, org_unit_id, period DESC
) latest
JOIN dim_indicators di ON latest.indicator_id = di.id
LEFT JOIN LATERAL (
  SELECT value
  FROM fact_indicator_values fiv2
  WHERE fiv2.indicator_id = latest.indicator_id
    AND fiv2.org_unit_id = latest.org_unit_id
    AND fiv2.period < latest.period
  ORDER BY fiv2.period DESC
  LIMIT 1
) prev ON true;

-- ─── 6. Index on notifications for the combined user + broadcast query ─────
-- The query pattern is:
--   WHERE (user_id = $1 OR user_id IS NULL) ORDER BY created_at DESC LIMIT $2
-- The existing partial indexes don't cover the OR condition efficiently.
-- A composite index on (user_id, created_at DESC) covers the user-specific part,
-- and the existing idx_notifications_broadcast covers the NULL part.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ─── 7. Analyze tables to update planner statistics ─────────────────────────
ANALYZE dim_org_units;
ANALYZE dim_indicators;
ANALYZE fact_indicator_values;
ANALYZE notifications;
