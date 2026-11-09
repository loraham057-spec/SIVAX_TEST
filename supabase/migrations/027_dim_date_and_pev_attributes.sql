-- ─── Migration 027: dim_date + PEV attributes on dim_indicators ──────────────
--
-- Objectifs :
--   1. Créer dim_date (dimension temporelle pour Power BI)
--   2. Enrichir dim_indicators avec antigen, dose, pev_domain
--   3. Mapper les 13 indicateurs vaccinaux existants avec leurs attributs PEV
--   4. Créer une vue fact_indicator_values_dated qui joint period → dim_date
--
-- Cette migration prépare le modèle de données pour le rapport Power BI RDC.

-- ─── 1. dim_date ────────────────────────────────────────────────────────────
-- Dimension temporelle mensuelle de 2020-01 à 2027-12.
-- Power BI utilise cette dimension pour les hiérarchies année > trimestre > mois.

create table if not exists dim_date (
  date date primary key,                       -- premier jour du mois
  year int not null,                           -- 2020, 2021, ...
  quarter int not null,                        -- 1, 2, 3, 4
  month int not null,                          -- 1-12
  month_name text not null,                    -- 'Janvier', 'Février', ...
  year_month text not null,                    -- 'YYYYMM' (clé de jointure avec fact_indicator_values.period)
  year_quarter text not null,                  -- 'YYYY-Q1', 'YYYY-Q2', ...
  is_current_year boolean not null default false,
  created_at timestamptz not null default now(),
  unique (year_month)
);

create index if not exists idx_dim_date_year on dim_date (year);
create index if not exists idx_dim_date_year_month on dim_date (year_month);

-- Peupler dim_date de 2020-01 à 2027-12 (96 mois)
-- Utilise generate_series pour créer tous les premiers du mois
insert into dim_date (date, year, quarter, month, month_name, year_month, year_quarter, is_current_year)
select
  d::date,
  extract(year from d)::int as year,
  extract(quarter from d)::int as quarter,
  extract(month from d)::int as month,
  to_char(d, 'TMMonth') as month_name,          -- nom du mois en locale
  to_char(d, 'YYYYMM') as year_month,
  to_char(d, 'YYYY"-Q"Q') as year_quarter,
  extract(year from d)::int = extract(year from now())::int as is_current_year
from generate_series('2020-01-01'::date, '2027-12-01'::date, '1 month') as d
on conflict (date) do nothing;

-- ─── 2. Enrichir dim_indicators avec attributs PEV ──────────────────────────

alter table dim_indicators
  add column if not exists antigen text,        -- 'BCG', 'Penta', 'VAR', 'VAP', 'MR', 'POLIO', etc.
  add column if not exists dose text,           -- '1', '2', '3', 'BCG', 'VAP4', NULL pour agrégats
  add column if not exists pev_domain text;     -- 'coverage', 'dropout', 'wastage', 'stock', 'cold_chain', 'data_quality', 'surveillance'

-- ─── 3. Mapper les indicateurs vaccinaux existants ──────────────────────────
-- Source : migration 015 (UIDs DHIS2 confirmés dans SNIS RDC)

update dim_indicators set
  antigen = 'Penta', dose = '1', pev_domain = 'coverage'
  where id = 'k26tJ22Ncpd';  -- Couverture Penta1

update dim_indicators set
  antigen = 'Penta', dose = '3', pev_domain = 'coverage'
  where id = 'v9b9aYsA5PM';  -- Couverture Penta3

update dim_indicators set
  antigen = 'BCG', dose = 'BCG', pev_domain = 'coverage'
  where id = 'cWJXYKCXrLx';  -- Couverture BCG

update dim_indicators set
  antigen = 'VAP', dose = '4', pev_domain = 'coverage'
  where id = 'tNZxs1kE6fy';  -- Couverture VAP4

update dim_indicators set
  antigen = 'Penta', dose = '1-3', pev_domain = 'dropout'
  where id = 'MULXtL8iom8';  -- Abandon Penta1-Penta3

update dim_indicators set
  antigen = 'MR', dose = '1-2', pev_domain = 'dropout'
  where id = 'FhQ8Hd5rCHj';  -- Abandon MR1-MR2

update dim_indicators set
  antigen = null, dose = null, pev_domain = 'wastage'
  where id = 'YM7Tmn01ieL';  -- Taux de perte vaccins

update dim_indicators set
  antigen = null, dose = null, pev_domain = 'coverage'
  where id = 'nvPe9ZZiEaH';  -- Enfants complètement vaccinés

update dim_indicators set
  antigen = null, dose = null, pev_domain = 'coverage'
  where id = 'RMHgIqfBG7N';  -- Enfants sous-vaccinés

update dim_indicators set
  antigen = 'BCG', dose = null, pev_domain = 'coverage'
  where id = 'W25tOXS0rxS';  -- BCG doses administrées

update dim_indicators set
  antigen = 'Penta', dose = '1', pev_domain = 'coverage'
  where id = 'uNdFg1eymsa';  -- Penta1 doses administrées

update dim_indicators set
  antigen = 'Penta', dose = '3', pev_domain = 'coverage'
  where id = 'WWxqaHSeiwd';  -- Penta3 doses administrées

update dim_indicators set
  antigen = 'BCG', dose = null, pev_domain = 'coverage'
  where id = 'hF8wVIOJrT8';  -- Enfants récupérés CAC-BCG

-- ─── 4. Vue fact_indicator_values_dated ─────────────────────────────────────
-- Jointure entre fact_indicator_values et dim_date pour Power BI.
-- Power BI se connecte à cette vue au lieu de la table brute.

create or replace view v_fact_indicator_values_dated as
select
  fiv.id,
  fiv.source,
  fiv.indicator_id,
  di.label as indicator_label,
  di.unit as indicator_unit,
  di.domain as indicator_domain,
  di.pev_domain,
  di.antigen,
  di.dose,
  di.icon_key,
  fiv.org_unit_id,
  dou.name as org_unit_name,
  dou.level as org_unit_level,
  dou.province_id,
  p.name as province_name,
  dou.zone_id,
  z.name as zone_name,
  fiv.period,
  dd.date as period_date,
  dd.year,
  dd.quarter,
  dd.month,
  dd.month_name,
  dd.year_month,
  dd.year_quarter,
  fiv.value,
  fiv.synced_at
from fact_indicator_values fiv
join dim_indicators di on fiv.indicator_id = di.id
join dim_org_units dou on fiv.org_unit_id = dou.id
left join dim_org_units p on dou.province_id = p.id
left join dim_org_units z on dou.zone_id = z.id
left join dim_date dd on fiv.period = dd.year_month;

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
-- dim_date est gérée par le backend (service_role). Pas d'accès public.

alter table dim_date enable row level security;

-- ─── 6. Commentaires ─────────────────────────────────────────────────────────

comment on table dim_date is 'Dimension temporelle mensuelle (2020-2027) pour Power BI. Jointure via year_month = fact_indicator_values.period';
comment on column dim_indicators.antigen is 'Antigène vaccinal: BCG, Penta, VAR, VAP, MR, POLIO, etc. NULL pour indicateurs non-antigène';
comment on column dim_indicators.dose is 'Dose: 1, 2, 3, BCG, VAP4, 1-3 (dropout). NULL pour agrégats';
comment on column dim_indicators.pev_domain is 'Domaine PEV: coverage, dropout, wastage, stock, cold_chain, data_quality, surveillance';
comment on view v_fact_indicator_values_dated is 'Vue étoile pour Power BI: fact + dim_indicators + dim_org_units + dim_date';
