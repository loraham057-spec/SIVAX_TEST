-- Report Engine: persist the failure reason of a generation job so that
-- status polling works across replicas and process restarts.

alter table public.reports add column if not exists error text;
