-- Migration 012: Agent audit log
-- Tracks every AI command: who, what, when, result, risk level.

create type agent_action_status as enum ('approved', 'auto_executed', 'rejected', 'failed');

create table if not exists agent_audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete set null,
  user_email  text,
  -- The command that was issued
  action      text not null,
  args        jsonb not null default '{}',
  category    text not null,
  risk_level  text not null check (risk_level in ('low', 'medium', 'high')),
  -- Execution outcome
  status      agent_action_status not null,
  result      text,
  error       text,
  -- Timing
  created_at  timestamptz not null default now(),
  duration_ms integer
);

-- Indexes for common queries
create index idx_audit_log_user      on agent_audit_log(user_id);
create index idx_audit_log_action    on agent_audit_log(action);
create index idx_audit_log_created   on agent_audit_log(created_at desc);
create index idx_audit_log_status    on agent_audit_log(status);

-- Row Level Security
alter table agent_audit_log enable row level security;

-- Users can see their own audit entries
create policy "Users can view own audit log"
  on agent_audit_log for select
  using (auth.uid() = user_id);

-- Admins can see all audit entries
create policy "Admins can view all audit log"
  on agent_audit_log for select
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

-- Only service role (backend) can insert audit entries
create policy "Service role can insert audit log"
  on agent_audit_log for insert
  with check (true);

-- Only service role can update audit entries (e.g. to set result)
create policy "Service role can update audit log"
  on agent_audit_log for update
  using (true);

-- Users cannot delete audit entries (immutable log)
-- No DELETE policy = no deletion via API
