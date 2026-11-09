-- ─── Migration 029: v_province_latest_values = dernier mois complet ──────────
--
-- Problème : la vue prenait MAX(period) toutes périodes confondues. Elle
-- remontait donc des agrégats annuels ('2026', valeur 0 pour VAP4 à Kinshasa),
-- des mois futurs ('202612' pour les enfants sous-vaccinés, projection DHIS2)
-- et des valeurs de 2023 présentées comme "dernières".
--
-- Correctif : ne considérer que les périodes mensuelles (YYYYMM) strictement
-- antérieures au mois précédent (le mois courant et le précédent sont encore
-- en cours de rapportage) et pas plus vieilles que 24 mois.

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
  WHERE period ~ '^\d{6}$'
    AND period <  to_char(date_trunc('month', now()) - interval '1 month', 'YYYYMM')
    AND period >= to_char(date_trunc('month', now()) - interval '24 months', 'YYYYMM')
  ORDER BY indicator_id, org_unit_id, period DESC
) fiv
JOIN dim_indicators di ON fiv.indicator_id = di.id
JOIN dim_org_units dou ON fiv.org_unit_id = dou.id
WHERE dou.level = 2
  AND fiv.org_unit_id != 'ymGeqzoPhN3';

ALTER VIEW public.v_province_latest_values SET (security_invoker = true);

-- Les lectures par page filtrent (source, indicator_id[], period[], org_unit_id[]).
CREATE INDEX IF NOT EXISTS idx_fiv_source_ind_period_ou
  ON fact_indicator_values (source, indicator_id, period, org_unit_id)
  INCLUDE (value);
