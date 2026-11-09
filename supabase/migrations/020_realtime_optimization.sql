-- ─── Migration 020: Realtime optimization ───────────────────────────────────
--
-- Problem: realtime.list_changes is called 529 704 times (87% of total DB time).
-- Root cause: Supabase publishes ALL tables to the supabase_realtime publication
-- by default. Every WAL change on any table triggers a realtime scan, even though
-- only the `notifications` table is actually subscribed to by the frontend.
--
-- Fix: Remove all tables from the realtime publication except `notifications`.
-- This eliminates ~99% of the realtime.list_changes calls.
--
-- Tables in the database:
--   users, push_subscriptions, deployments, app_config
--   alerts, activity_log, kpis
--   dim_org_units, dim_indicators, fact_indicator_values, etl_runs
--   app_settings, settings_audit_log, data_export_audit_log
--   agent_audit_log, agent_conversations, agent_chat_messages
--   agent_conversation_memory
--   notifications  ← ONLY this one needs Realtime
--
-- Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md — Supabase pg_stat_statements audit

-- ─── 1. Drop all non-essential tables from the realtime publication ─────────
-- PostgreSQL's ALTER PUBLICATION ... DROP TABLE does not support IF EXISTS,
-- so we use a DO block with dynamic SQL to drop each table only if it is
-- currently a member of the supabase_realtime publication.

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'users',
        'push_subscriptions',
        'deployments',
        'app_config',
        'alerts',
        'activity_log',
        'kpis',
        'dim_org_units',
        'dim_indicators',
        'fact_indicator_values',
        'etl_runs',
        'app_settings',
        'settings_audit_log',
        'data_export_audit_log',
        'agent_audit_log',
        'agent_conversations',
        'agent_chat_messages',
        'agent_conversation_memory'
      )
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', tbl);
  END LOOP;
END $$;

-- ─── 2. Ensure notifications stays in the realtime publication ──────────────
-- This is the ONLY table the frontend subscribes to via Realtime
-- (use-notifications.ts and use-app-badge.ts).
-- We add it only if it's not already there (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ─── 3. Reset pg_stat_statements to measure impact ─────────────────────────
-- The stats are cumulative since the last reset, so old slow queries will
-- still appear until the stats are cleared. Run this AFTER applying both
-- migrations 019 and 020 to get a clean baseline.
SELECT pg_stat_statements_reset();

-- ─── 4. Verify the publication contents ─────────────────────────────────────
-- After running this, the following query should return only `notifications`:
--   SELECT schemaname, tablename
--   FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime';
