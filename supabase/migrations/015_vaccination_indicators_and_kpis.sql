-- ─── Migration 015: Vaccination indicators + real KPIs ──────────────────────
-- 1. Add vaccination indicators to dim_indicators (confirmed DHIS2 UIDs)
-- 2. Add domain column to dim_indicators for categorization
-- 3. Replace TB mock KPIs with vaccination KPIs (computed from ETL data)
-- 4. Replace TB mock alerts with vaccination alerts
-- 5. Add a view for computing KPIs from fact_indicator_values

-- ─── 1. Add domain column to dim_indicators ────────────────────────────────
ALTER TABLE dim_indicators ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT 'health';

-- ─── 2. Seed vaccination indicators ────────────────────────────────────────
-- These UIDs are confirmed to have real data in SNIS RDC (DHIS2 2.40.11.1)
-- Source: direct DHIS2 audit — see ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §11

INSERT INTO dim_indicators (id, source, label, unit, category, icon_key, domain) VALUES
  -- Coverage indicators (percent)
  ('k26tJ22Ncpd', 'dhis2', 'Taux de couverture vaccinale en Pentavalent 1', 'percent', 'health', 'syringe', 'vaccination'),
  ('v9b9aYsA5PM', 'dhis2', 'Taux de couverture vaccinale en Pentavalent 3', 'percent', 'health', 'syringe', 'vaccination'),
  ('cWJXYKCXrLx', 'dhis2', 'Taux de couverture vaccinale en BCG', 'percent', 'health', 'syringe', 'vaccination'),
  ('tNZxs1kE6fy', 'dhis2', 'Taux de couverture vaccinale en VAP 4', 'percent', 'health', 'syringe', 'vaccination'),
  -- Dropout / loss indicators (percent)
  ('MULXtL8iom8', 'dhis2', 'Taux d''abandons DTC-HepB-Hib1-DTC-Hep-Hib3', 'percent', 'health', 'trending-down', 'vaccination'),
  ('FhQ8Hd5rCHj', 'dhis2', 'EPI - MR 1 to 2 dropout rate', 'percent', 'health', 'trending-down', 'vaccination'),
  ('YM7Tmn01ieL', 'dhis2', 'Taux de perte des vaccins', 'percent', 'health', 'alert', 'vaccination'),
  -- Population indicators
  ('nvPe9ZZiEaH', 'dhis2', 'Taux d''enfants complètement vaccinés', 'percent', 'health', 'check-circle', 'vaccination'),
  ('RMHgIqfBG7N', 'dhis2', 'Nombre d''enfants sous vaccinés (SV)', 'count', 'health', 'users', 'vaccination'),
  -- Doses administered (B 8.4 series, aggregated counts)
  ('W25tOXS0rxS', 'dhis2', 'BCG - doses administrées (agrégé)', 'count', 'health', 'syringe', 'vaccination'),
  ('uNdFg1eymsa', 'dhis2', 'DTC-HepB Hib 1 - doses administrées', 'count', 'health', 'syringe', 'vaccination'),
  ('WWxqaHSeiwd', 'dhis2', 'DTC-HepB Hib 3 - doses administrées', 'count', 'health', 'syringe', 'vaccination'),
  ('hF8wVIOJrT8', 'dhis2', 'Enfants récupérés par les CAC-BCG', 'count', 'health', 'users', 'vaccination')
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  icon_key = EXCLUDED.icon_key;

-- Update existing indicators with domain
UPDATE dim_indicators SET domain = 'malaria' WHERE id IN ('rOt4BctnRqS', 'l5Gjya9Udz7', 'rPYLomUceL4');
UPDATE dim_indicators SET domain = 'maternal' WHERE id = 'eVbOZqoI7JP';

-- ─── 3. Replace TB mock KPIs with vaccination KPIs ──────────────────────────
-- Delete the TB seed KPIs (they will be replaced by computed values)
DELETE FROM kpis WHERE title IN (
  'Total Cases',
  'Treatment Success Rate',
  'Case Detection Rate',
  'High-Risk Provinces'
);

-- Insert vaccination KPI placeholders (will be updated by the ETL / API)
-- These serve as the default structure; the /api/kpis route will compute
-- real values from fact_indicator_values when ETL data is available.
INSERT INTO kpis (title, value, change, trend, description, sort_order) VALUES
  ('Couverture Penta3', '—', '—', 'neutral', 'Taux de couverture vaccinale Pentavalent 3 (national)', 1),
  ('Couverture BCG', '—', '—', 'neutral', 'Taux de couverture vaccinale BCG (national)', 2),
  ('Abandon Penta1-Penta3', '—', '—', 'neutral', 'Taux d''abandon entre Penta1 et Penta3 (national)', 3),
  ('Enfants sous-vaccinés', '—', '—', 'neutral', 'Nombre d''enfants sous-vaccinés (national)', 4)
ON CONFLICT DO NOTHING;

-- ─── 4. Replace TB mock alerts with vaccination alerts ─────────────────────
-- Delete the TB seed alerts
DELETE FROM alerts WHERE title IN (
  'TB Detection Rate Below Threshold',
  'Predicted Outbreak Risk',
  'Treatment Stockout Imminent',
  'Monthly Report Deadline',
  'Anomaly Detected in Data'
);

-- Insert vaccination alert placeholders (will be computed from real data)
INSERT INTO alerts (title, message, type, severity, source, region, action_url) VALUES
  ('Couverture Penta3 sous le seuil', 'La couverture Penta3 nationale est sous le seuil OMS de 90%. Analyse recommandée par province.', 'analysis', 'warning', 'DHIS2 SNIS RDC', NULL, '/dashboard'),
  ('Abandon Penta1-Penta3 élevé', 'Le taux d''abandon entre Penta1 et Penta3 dépasse 10% dans plusieurs provinces. Diagnostic recommandé.', 'analysis', 'warning', 'DHIS2 SNIS RDC', NULL, '/dashboard')
ON CONFLICT DO NOTHING;

-- ─── 5. Clean up TB activity log ───────────────────────────────────────────
DELETE FROM activity_log WHERE title LIKE '%TB%';
DELETE FROM activity_log WHERE title LIKE '%tuberculosis%';

INSERT INTO activity_log (title, type) VALUES
  ('ETL vaccination configuré — 13 indicateurs DHIS2 ajoutés', 'system'),
  ('KPIs dashboard migrés vers données vaccination réelles', 'system')
ON CONFLICT DO NOTHING;

-- ─── 6. View: latest KPI values from fact_indicator_values ─────────────────
-- This view computes the latest value per indicator at national level,
-- plus the previous period value for trend calculation.
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
WHERE fiv.org_unit_id = (SELECT id FROM dim_org_units WHERE level = 1 LIMIT 1)
  AND fiv.period = (
    SELECT MAX(fiv2.period) FROM fact_indicator_values fiv2
    WHERE fiv2.indicator_id = fiv.indicator_id
      AND fiv2.org_unit_id = fiv.org_unit_id
  );

-- ─── 7. View: per-province latest values ───────────────────────────────────
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
  AND fiv.period = (
    SELECT MAX(fiv2.period) FROM fact_indicator_values fiv2
    WHERE fiv2.indicator_id = fiv.indicator_id
      AND fiv2.org_unit_id = fiv.org_unit_id
  );
