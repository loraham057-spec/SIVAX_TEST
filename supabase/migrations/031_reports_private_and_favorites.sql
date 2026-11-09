-- Report Engine: strictly private reports + personal favorites.
--
-- 1. Each user only sees the reports they generated (RLS defense in depth;
--    the API routes enforce the same filter with the service role client).
-- 2. Favorites become personal (report_favorites) instead of a global
--    boolean on the report row.

drop policy if exists "reports_select_authenticated" on public.reports;
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using (user_id = auth.uid());

create table if not exists public.report_favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, report_id)
);

alter table public.report_favorites enable row level security;

drop policy if exists "report_favorites_own" on public.report_favorites;
create policy "report_favorites_own"
  on public.report_favorites for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Carry over existing owner favorites to the new table.
insert into public.report_favorites (user_id, report_id)
  select user_id, id from public.reports
  where favorite = true and user_id is not null
  on conflict do nothing;

comment on column public.reports.favorite is
  'Deprecated — replaced by public.report_favorites (personal favorites).';
