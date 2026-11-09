-- ─── Migration 021: Fix SECURITY DEFINER views ───────────────────────────────
--
-- Problem: Supabase database linter flags v_province_latest_values and
-- v_latest_kpi_values as SECURITY DEFINER (ERROR level).
-- By default, PostgreSQL views run with the view owner's permissions,
-- bypassing RLS policies of the querying user. This is a security risk:
-- a user could access data through the view that RLS would otherwise deny.
--
-- Fix: Set security_invoker = true on both views so they run with the
-- permissions of the querying user. The underlying tables
-- (fact_indicator_values, dim_indicators, dim_org_units) already have
-- RLS SELECT policies for anon and authenticated roles (migration 017),
-- so the views will continue to return data correctly.
--
-- Source: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view

ALTER VIEW public.v_province_latest_values SET (security_invoker = true);
ALTER VIEW public.v_latest_kpi_values SET (security_invoker = true);
