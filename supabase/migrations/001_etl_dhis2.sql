-- ETL: DHIS2 snapshot schema
-- Creates a star schema for storing synced DHIS2 indicator values,
-- with an observability table for ETL run tracking.

-- ─── Dimensions ──────────────────────────────────────────

create table if not exists dim_org_units (
  id text primary key,                          -- DHIS2 org unit UID
  name text not null,
  level int not null default 1,                 -- 1=national, 2=province, 3=zone de santé
  parent_id text references dim_org_units(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists dim_indicators (
  id text primary key,                          -- DHIS2 data element / indicator UID
  source text not null default 'dhis2',         -- 'dhis2', 'logistics', 'weather'…
  label text not null,
  unit text not null default 'count',           -- 'count' | 'percent'
  category text not null default 'health',
  icon_key text not null default 'activity',
  created_at timestamptz not null default now()
);

-- ─── Fact table ──────────────────────────────────────────

create table if not exists fact_indicator_values (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'dhis2',
  indicator_id text not null references dim_indicators(id) on delete cascade,
  org_unit_id text not null references dim_org_units(id) on delete cascade,
  period text not null,                         -- YYYYMM (monthly)
  value numeric not null,
  synced_at timestamptz not null default now(),
  unique (source, indicator_id, org_unit_id, period)  -- idempotent upsert
);

create index if not exists idx_fiv_indicator on fact_indicator_values (indicator_id);
create index if not exists idx_fiv_org_unit on fact_indicator_values (org_unit_id);
create index if not exists idx_fiv_period on fact_indicator_values (period desc);

-- ─── ETL run observability ───────────────────────────────

create table if not exists etl_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                         -- 'dhis2', 'logistics'…
  scope text not null default 'full',            -- 'full', 'incremental', 'backfill'
  status text not null default 'running',        -- 'running', 'success', 'failed'
  rows_loaded int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ─── Row Level Security ──────────────────────────────────
-- These tables are managed exclusively by the backend (service_role key),
-- which bypasses RLS. No public policies — anon/authenticated keys are blocked.

alter table dim_org_units enable row level security;
alter table dim_indicators enable row level security;
alter table fact_indicator_values enable row level security;
alter table etl_runs enable row level security;

-- ─── Seed: current indicators (SNIS RDC national) ────────

insert into dim_indicators (id, source, label, unit, category, icon_key) values
  ('rOt4BctnRqS', 'dhis2', 'Cas de paludisme (présumés et confirmés)', 'count', 'health', 'activity'),
  ('l5Gjya9Udz7', 'dhis2', 'Paludisme confirmé traité', 'count', 'health', 'syringe'),
  ('rPYLomUceL4', 'dhis2', 'Paludisme confirmé (microscopie/TDR)', 'count', 'health', 'package'),
  ('eVbOZqoI7JP', 'dhis2', 'Accouchements assistés par personnel qualifié', 'percent', 'health', 'users')
on conflict (id) do nothing;

insert into dim_org_units (id, name, level) values
  ('ymGeqzoPhN3', 'République Démocratique du Congo', 1)
on conflict (id) do nothing;
