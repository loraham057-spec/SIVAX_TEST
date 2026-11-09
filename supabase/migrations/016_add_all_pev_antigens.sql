-- Migration 016: Add all PEV vaccination coverage antigens from DHIS2 SNIS RDC
-- Source: DHIS2 API indicator search (filter: name ilike "couverture" + indicatorType = Percentage)
-- These indicators exist in DHIS2 but were not previously synced by the ETL.
-- The ETL (backend/app/etl/sources/dhis2.py) has been updated to include them.

INSERT INTO dim_indicators (id, source, label, unit, category, icon_key, domain) VALUES
  -- New PEV coverage antigens (all Percentage type in DHIS2)
  ('RZuHoUKI3fc', 'dhis2', 'Taux de couverture en VAP 1', 'percent', 'health', 'syringe', 'vaccination'),
  ('Dx7fV8rLg5F', 'dhis2', 'Taux de couverture en PCV-13 (1)', 'percent', 'health', 'syringe', 'vaccination'),
  ('biBItnhkMUe', 'dhis2', 'Taux de couverture en PCV-13 (3)', 'percent', 'health', 'syringe', 'vaccination'),
  ('k8womY2OabA', 'dhis2', 'Taux de couverture en ROTA 1', 'percent', 'health', 'syringe', 'vaccination'),
  ('HX6kfUl1auv', 'dhis2', 'Taux de couverture en ROTA 3', 'percent', 'health', 'syringe', 'vaccination'),
  ('PR35pwZEAny', 'dhis2', 'Taux de couverture en VPO 3', 'percent', 'health', 'syringe', 'vaccination'),
  ('F35ZsGcz2Lv', 'dhis2', 'Taux de couverture en VPI 1', 'percent', 'health', 'syringe', 'vaccination'),
  ('khtnBZ1Ispo', 'dhis2', 'Taux de couverture en VPI 2', 'percent', 'health', 'syringe', 'vaccination'),
  ('OKaDG2t6LtN', 'dhis2', 'Taux de couverture en VAR 1', 'percent', 'health', 'syringe', 'vaccination'),
  ('j2RPbYTGkAf', 'dhis2', 'Taux de couverture en VAA', 'percent', 'health', 'syringe', 'vaccination'),
  ('z4Iqy42FhNf', 'dhis2', 'Taux de couverture en Td 2+', 'percent', 'health', 'syringe', 'vaccination')
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  unit = EXCLUDED.unit,
  domain = EXCLUDED.domain,
  icon_key = EXCLUDED.icon_key;
