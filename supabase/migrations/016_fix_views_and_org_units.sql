-- ─── Migration 016: Fix views and org unit levels ──────────────────────────
-- 1. Ensure national org unit is level 1
-- 2. Fix v_latest_kpi_values to use the root org unit (not just level=1)
-- 3. Fix v_province_latest_values to filter on level=2 properly

-- ─── 1. Fix national org unit level ────────────────────────────────────────
UPDATE dim_org_units SET level = 1, name = 'République Démocratique du Congo'
WHERE id = 'ymGeqzoPhN3';

-- ─── 2. Fix v_latest_kpi_values ────────────────────────────────────────────
-- Use the root org unit directly instead of filtering on level=1
-- (in case the root OU level is not set correctly)
CREATE OR REPLACE VIEW v_latest_kpi_values AS
SELECT
  fiv.indicator_id,
  di.label,
  di.unit,
  di.domain,
  di.icon_key,
  fiv.period AS latest_period,
  fiv.value AS latest_value,
  LAG(fiv.value) OVER (PARTITION BY fiv.indicator_id, fiv.org_unit_id ORDER BY fiv.period) AS prev_value,
  CASE
    WHEN LAG(fiv.value) OVER (PARTITION BY fiv.indicator_id, fiv.org_unit_id ORDER BY fiv.period) IS NULL THEN NULL
    WHEN LAG(fiv.value) OVER (PARTITION BY fiv.indicator_id, fiv.org_unit_id ORDER BY fiv.period) = 0 THEN NULL
    ELSE ROUND(
      ((fiv.value - LAG(fiv.value) OVER (PARTITION BY fiv.indicator_id, fiv.org_unit_id ORDER BY fiv.period))
       / LAG(fiv.value) OVER (PARTITION BY fiv.indicator_id, fiv.org_unit_id ORDER BY fiv.period)) * 100,
      1
    )
  END AS pct_change
FROM fact_indicator_values fiv
JOIN dim_indicators di ON fiv.indicator_id = di.id
WHERE fiv.org_unit_id = 'ymGeqzoPhN3'
  AND fiv.period = (
    SELECT MAX(fiv2.period) FROM fact_indicator_values fiv2
    WHERE fiv2.indicator_id = fiv.indicator_id
      AND fiv2.org_unit_id = fiv.org_unit_id
  );

-- ─── 3. Fix v_province_latest_values ───────────────────────────────────────
-- Filter on level=2 (provinces) and exclude the national org unit
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
FROM fact_indicator_values fiv
JOIN dim_indicators di ON fiv.indicator_id = di.id
JOIN dim_org_units dou ON fiv.org_unit_id = dou.id
WHERE dou.level = 2
  AND fiv.org_unit_id != 'ymGeqzoPhN3'
  AND fiv.period = (
    SELECT MAX(fiv2.period) FROM fact_indicator_values fiv2
    WHERE fiv2.indicator_id = fiv.indicator_id
      AND fiv2.org_unit_id = fiv.org_unit_id
  );
