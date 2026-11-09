-- 028_learned_aliases.sql
-- Shared learned aliases for the AI agent.
-- When a user's spelling of a geography or indicator name doesn't match any
-- known entity, the agent asks a clarification question. The confirmed answer
-- is stored here so ALL users benefit: the next time anyone writes the same
-- (mis)spelling, the agent resolves it directly instead of asking again.

CREATE TABLE IF NOT EXISTS agent_learned_aliases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- What kind of entity the alias points to: 'geo' (org unit) | 'metric' (indicator)
    alias_type              TEXT NOT NULL CHECK (alias_type IN ('geo', 'metric')),
    -- Normalized alias text (lowercase, accents stripped, whitespace collapsed)
    alias_normalized        TEXT NOT NULL,
    -- DHIS2 ID of the confirmed target (org unit or indicator)
    target_id               TEXT NOT NULL,
    target_name             TEXT NOT NULL,
    -- Org unit level (geo aliases only; NULL for metrics)
    target_level            INT,
    -- Number of times a user explicitly confirmed this mapping
    confirmations           INT NOT NULL DEFAULT 1,
    -- Conversation that first taught this alias (traceability)
    created_by_conversation TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    last_confirmed_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (alias_type, alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_ala_type_alias ON agent_learned_aliases (alias_type, alias_normalized);

-- Enable RLS: reads allowed for authenticated users (aliases are shared
-- knowledge, not personal data); writes only via the backend service role.
ALTER TABLE agent_learned_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read learned aliases"
    ON agent_learned_aliases FOR SELECT
    TO authenticated
    USING (true);

-- Service role bypasses RLS (used by the backend for writes)
