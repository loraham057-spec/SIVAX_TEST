-- Migration 014: Agent chat conversations and messages
-- Persists chat history per user, supporting multiple conversations.

-- ─── Conversations ────────────────────────────────────────
create table if not exists agent_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  title       text not null default 'Nouvelle conversation',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_conversations_user    on agent_conversations(user_id);
create index idx_conversations_updated on agent_conversations(updated_at desc);

alter table agent_conversations enable row level security;

-- Users can CRUD their own conversations
create policy "Users can view own conversations"
  on agent_conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on agent_conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own conversations"
  on agent_conversations for update
  using (auth.uid() = user_id);

create policy "Users can delete own conversations"
  on agent_conversations for delete
  using (auth.uid() = user_id);

-- ─── Chat messages ────────────────────────────────────────
create table if not exists agent_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references agent_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  suggestions     jsonb,
  created_at      timestamptz not null default now()
);

create index idx_chat_messages_conv     on agent_chat_messages(conversation_id);
create index idx_chat_messages_created  on agent_chat_messages(created_at);

alter table agent_chat_messages enable row level security;

-- Users can manage messages in their own conversations
create policy "Users can view own chat messages"
  on agent_chat_messages for select
  using (
    exists (
      select 1 from agent_conversations
      where agent_conversations.id = agent_chat_messages.conversation_id
      and agent_conversations.user_id = auth.uid()
    )
  );

create policy "Users can insert own chat messages"
  on agent_chat_messages for insert
  with check (
    exists (
      select 1 from agent_conversations
      where agent_conversations.id = agent_chat_messages.conversation_id
      and agent_conversations.user_id = auth.uid()
    )
  );

create policy "Users can delete own chat messages"
  on agent_chat_messages for delete
  using (
    exists (
      select 1 from agent_conversations
      where agent_conversations.id = agent_chat_messages.conversation_id
      and agent_conversations.user_id = auth.uid()
    )
  );

-- ─── Auto-update updated_at on conversation ───────────────
create or replace function update_conversation_updated_at()
returns trigger as $$
begin
  update agent_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_chat_messages_update_conv
  after insert on agent_chat_messages
  for each row
  execute function update_conversation_updated_at();
