create table if not exists app_settings (
  key text primary key,
  encrypted_value text not null,
  is_secret boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists settings_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  keys_changed text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists data_export_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  resource text not null,
  format text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table app_settings enable row level security;
alter table settings_audit_log enable row level security;
alter table data_export_audit_log enable row level security;

create index if not exists idx_settings_audit_created_at
  on settings_audit_log(created_at desc);
create index if not exists idx_data_export_audit_created_at
  on data_export_audit_log(created_at desc);
