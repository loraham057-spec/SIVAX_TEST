-- ─── Migration 022: Org unit hierarchy (zones de santé + aires de santé) ──────
--
-- DHIS2 RDC hierarchy:
--   Level 1: National (1)         → République Démocratique du Congo
--   Level 2: Province (26)        → Kinshasa, Haut Katanga, etc.
--   Level 3: Zone de santé (519)  → sous-division provinciale
--   Level 4: Aire de santé (10K+) → sous-division de zone
--   Level 5: Centre/Poste (25K+)  → facility level (not loaded by default)
--
-- This migration:
--   1. Adds denormalized province_id / zone_id columns for fast filtering
--   2. Adds a materialized path for tree traversal
--   3. Creates views for zones and aires de santé
--   4. Creates indexes for dependent filter queries

-- ─── 1. Add hierarchy columns to dim_org_units ────────────────────────────────

alter table dim_org_units
  add column if not exists province_id text references dim_org_units(id) on delete set null,
  add column if not exists zone_id text references dim_org_units(id) on delete set null,
  add column if not exists path text;  -- e.g. 'ymGeqzoPhN3/TwSa8zUu09Q/abc123'

-- Index for dependent filter queries
create index if not exists idx_dim_ou_level on dim_org_units (level);
create index if not exists idx_dim_ou_parent on dim_org_units (parent_id);
create index if not exists idx_dim_ou_province on dim_org_units (province_id);
create index if not exists idx_dim_ou_zone on dim_org_units (zone_id);
create index if not exists idx_dim_ou_path on dim_org_units (path);

-- ─── 2. Views for zones and aires de santé ────────────────────────────────────

-- Zones de santé (level 3) with their province
create or replace view v_zones as
select
  z.id,
  z.name,
  z.level,
  z.parent_id as province_id,
  p.name as province_name
from dim_org_units z
join dim_org_units p on z.parent_id = p.id
where z.level = 3;

-- Aires de santé (level 4) with their zone and province
create or replace view v_aires as
select
  a.id,
  a.name,
  a.level,
  a.parent_id as zone_id,
  z.name as zone_name,
  z.parent_id as province_id,
  p.name as province_name
from dim_org_units a
join dim_org_units z on a.parent_id = z.id
join dim_org_units p on z.parent_id = p.id
where a.level = 4;

-- Full hierarchy view (all levels with province/zone context)
create or replace view v_org_unit_hierarchy as
select
  ou.id,
  ou.name,
  ou.level,
  ou.parent_id,
  ou.path,
  case when ou.level >= 2 then ou.id end as province_id_self,
  case when ou.level >= 2 then (select name from dim_org_units where id = ou.id) end as province_name_self,
  ou.province_id,
  (select name from dim_org_units where id = ou.province_id) as province_name,
  ou.zone_id,
  (select name from dim_org_units where id = ou.zone_id) as zone_name
from dim_org_units ou
order by ou.level, ou.name;

-- ─── 3. Function to compute path from parent ──────────────────────────────────
-- Called by the ETL after inserting org units to populate the path column.

create or replace function compute_org_unit_path(ou_id text)
returns text as $$
declare
  current record;
  path_parts text[] := '{}';
begin
  select id, parent_id into current from dim_org_units where id = ou_id;
  if not found then return null; end if;

  loop
    path_parts := array_prepend(current.id, path_parts);
    exit when current.parent_id is null;
    select id, parent_id into current from dim_org_units where id = current.parent_id;
    if not found then exit; end if;
  end loop;

  return array_to_string(path_parts, '/');
end;
$$ language plpgsql immutable;

-- ─── 4. Bulk path computation (call after ETL loads hierarchy) ────────────────

create or replace function populate_org_unit_paths()
returns int as $$
declare
  updated_count int := 0;
  rec record;
begin
  for rec in select id from dim_org_units where path is null loop
    update dim_org_units set path = compute_org_unit_path(rec.id) where id = rec.id;
    updated_count := updated_count + 1;
  end loop;
  return updated_count;
end;
$$ language plpgsql;

-- ─── 5. Function to populate province_id / zone_id denormalized columns ──────

create or replace function populate_hierarchy_ids()
returns int as $$
declare
  updated_count int := 0;
begin
  -- Level 2 (provinces): province_id = self
  update dim_org_units set province_id = id where level = 2 and province_id is null;
  updated_count := updated_count + row_count;

  -- Level 3 (zones): province_id = parent
  update dim_org_units set province_id = parent_id where level = 3 and province_id is null;
  updated_count := updated_count + row_count;

  -- Level 3 (zones): zone_id = self
  update dim_org_units set zone_id = id where level = 3 and zone_id is null;
  updated_count := updated_count + row_count;

  -- Level 4 (aires): zone_id = parent, province_id = parent's parent
  update dim_org_units d
  set zone_id = d.parent_id,
      province_id = (select parent_id from dim_org_units where id = d.parent_id)
  where d.level = 4 and d.zone_id is null;
  updated_count := updated_count + row_count;

  return updated_count;
end;
$$ language plpgsql;
