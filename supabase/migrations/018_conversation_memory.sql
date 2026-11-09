-- 018_conversation_memory.sql
-- Persistent conversation memory for the AI agent.
-- Stores analysis contexts, mentioned entities, user preferences, and topics
-- per conversation, enabling anaphora resolution and context-aware follow-ups.

CREATE TABLE IF NOT EXISTS agent_conversation_memory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    user_id         UUID,
    -- Type of memory: 'analysis' | 'entity' | 'preference' | 'topic' | 'clarification'
    memory_type     TEXT NOT NULL,
    -- Key within the type (e.g. 'indicator', 'geography', 'last_analysis', 'preferred_language')
    key             TEXT NOT NULL,
    -- JSONB value — flexible storage for any structured data
    value           JSONB NOT NULL,
    -- Salience score 0-1 — how important this memory is (higher = more relevant)
    salience        FLOAT DEFAULT 0.5,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    -- Optional TTL — memories can expire (NULL = never expires)
    expires_at      TIMESTAMPTZ
);

-- Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_acm_conversation ON agent_conversation_memory (conversation_id);
CREATE INDEX IF NOT EXISTS idx_acm_conversation_type ON agent_conversation_memory (conversation_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_acm_conversation_type_key ON agent_conversation_memory (conversation_id, memory_type, key);
CREATE INDEX IF NOT EXISTS idx_acm_user ON agent_conversation_memory (user_id);
CREATE INDEX IF NOT EXISTS idx_acm_salience ON agent_conversation_memory (salience DESC);

-- Enable RLS
ALTER TABLE agent_conversation_memory ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access their own conversation memories
CREATE POLICY "Users can read own memories"
    ON agent_conversation_memory FOR SELECT
    USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own memories"
    ON agent_conversation_memory FOR INSERT
    WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own memories"
    ON agent_conversation_memory FOR UPDATE
    USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own memories"
    ON agent_conversation_memory FOR DELETE
    USING (auth.uid() = user_id OR user_id IS NULL);

-- Service role bypasses RLS (used by the backend)
