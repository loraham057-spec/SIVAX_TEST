-- SIVAX Report Engine — persisted generated reports.
-- The full canonical ReportDocument is stored as JSONB; list columns are
-- denormalized for fast history queries.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  title text not null,
  report_type text not null,
  template text not null default 'sivax',
  status text not null default 'COMPLETED',
  period_start text,
  period_end text,
  scope text,
  audience text,
  prompt text,
  document jsonb,
  favorite boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_reports_created_at on public.reports (created_at desc);
create index if not exists idx_reports_user_id on public.reports (user_id);

alter table public.reports enable row level security;

-- Authenticated users can read all reports (shared analytical library);
-- writes go through the service role (Next.js API routes).
drop policy if exists "reports_select_authenticated" on public.reports;
create policy "reports_select_authenticated"
  on public.reports for select
  to authenticated
  using (true);
