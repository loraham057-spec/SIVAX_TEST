-- ─── Migration 023: Fix Supabase database linter security warnings ──────────
--
-- Addresses the following linter warnings:
-- 1. function_search_path_mutable (8 functions)
-- 2. extension_in_public (pg_net)
-- 3. rls_policy_always_true (agent_audit_log INSERT + UPDATE)
-- 4. anon_security_definer_function_executable (5 functions)
-- 5. authenticated_security_definer_function_executable (5 functions)
-- 6. security_definer_view (v_zones, v_aires, v_org_unit_hierarchy)
--
-- Note: auth_leaked_password_protection is a Supabase Auth dashboard setting
-- and cannot be fixed via SQL. It must be enabled in the Supabase dashboard:
-- Authentication → Settings → Leaked password protection → Enable.

-- ============================================================================
-- 1. Fix function_search_path_mutable
-- ============================================================================
-- Add an explicit search_path to 5 trigger functions that were missing it.
-- This prevents search_path hijacking attacks where a malicious schema could
-- shadow built-in functions.
-- (handle_new_user, is_admin, create_seed_user, cleanup_expired_notifications
--  already have search_path set in their original definitions.)

ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_notification_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_conversation_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_org_unit_path(TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION public.populate_org_unit_paths() SET search_path = public, pg_temp;
ALTER FUNCTION public.populate_hierarchy_ids() SET search_path = public, pg_temp;
-- notify_push_on_deploy is recreated below (section 2) with search_path set.

-- ============================================================================
-- 2. Fix extension_in_public — move pg_net to extensions schema
-- ============================================================================
-- pg_net is installed in the public schema, which exposes it via the REST API.
-- Move it to the standard Supabase `extensions` schema.
--
-- The notify_push_on_deploy function references net.http_post, so we must
-- recreate it with a schema-qualified call after moving the extension.

-- Step 2a: Recreate notify_push_on_deploy with extensions.net.http_post
-- and an explicit search_path (fixes both extension_in_public AND
-- function_search_path_mutable for this function).
CREATE OR REPLACE FUNCTION public.notify_push_on_deploy()
RETURNS TRIGGER AS $$
DECLARE
  app_url TEXT;
  push_token TEXT;
  push_endpoint TEXT;
  request_id bigint;
  body_json TEXT;
  headers_json JSONB;
BEGIN
  SELECT value INTO app_url FROM public.app_config WHERE key = 'app_url';
  SELECT value INTO push_token FROM public.app_config WHERE key = 'push_token';

  IF app_url IS NULL OR push_token IS NULL THEN
    RAISE WARNING 'notify_push_on_deploy: app_url or push_token not configured in app_config';
    RETURN NEW;
  END IF;

  push_endpoint := app_url || '/api/push/send';

  body_json := jsonb_build_object(
    'title', 'SIVAX — New Version Deployed',
    'body', 'A new version of SIVAX is now live. The app has been updated automatically.',
    'buildId', NEW.build_id,
    'url', app_url,
    'changelog', NEW.changelog,
    'sendEmail', true
  )::text;

  headers_json := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || push_token
  );

  RAISE NOTICE 'notify_push_on_deploy: calling % with build_id=%', push_endpoint, NEW.build_id;

  -- Use schema-qualified extensions.net.http_post (pg_net moved to extensions)
  SELECT id INTO request_id FROM extensions.net.http_post(
    push_endpoint,
    headers_json,
    body_json,
    5000
  );

  RAISE NOTICE 'notify_push_on_deploy: pg_net request_id=%', request_id;

  UPDATE public.deployments SET push_sent = true WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- Step 2b: Move pg_net extension to the extensions schema.
-- Drop and recreate — the function above already uses the schema-qualified path.
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net SCHEMA extensions;

-- ============================================================================
-- 3. Fix rls_policy_always_true — agent_audit_log
-- ============================================================================
-- The INSERT and UPDATE policies use WITH CHECK (true) / USING (true), which
-- allows ANY user (including anon) to insert or update audit log entries.
-- The service_role bypasses RLS entirely, so it does not need these policies.
-- Without a permissive policy, only the service_role can insert/update —
-- which is the intended behavior for an immutable audit log.

DROP POLICY IF EXISTS "Service role can insert audit log" ON public.agent_audit_log;
DROP POLICY IF EXISTS "Service role can update audit log" ON public.agent_audit_log;
-- No replacement policy needed: service_role bypasses RLS, and no other
-- role should be able to insert or modify audit log entries.

-- ============================================================================
-- 4. Fix anon/authenticated SECURITY DEFINER function execute permissions
-- ============================================================================
-- By default, PostgreSQL grants EXECUTE on functions to PUBLIC (all roles).
-- Revoking only anon/authenticated is insufficient because those roles still
-- inherit EXECUTE from PUBLIC. Revoke PUBLIC first, then grant back only the
-- minimum privileges required by RLS evaluation.

-- 4a. handle_new_user() — trigger function, called by auth.users INSERT trigger.
--     Must NOT be callable via REST API by any frontend role.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 4b. is_admin() — helper used in RLS policies. Authenticated users need
--     EXECUTE for policy evaluation, but anon and PUBLIC must not have it.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 4c. create_seed_user(...) — admin seeding function. Only its owner/service
--     infrastructure may invoke it; frontend roles must not.
REVOKE EXECUTE ON FUNCTION public.create_seed_user(TEXT, TEXT, TEXT, public.user_role, TEXT)
  FROM PUBLIC, anon, authenticated;

-- 4d. cleanup_expired_notifications() — maintenance, called via pg_cron or
--     service infrastructure only. Must NOT be callable via REST API.
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_notifications()
  FROM PUBLIC, anon, authenticated;

-- 4e. notify_push_on_deploy() — trigger function, called by deployments
--     INSERT trigger. Must NOT be callable via REST API.
REVOKE EXECUTE ON FUNCTION public.notify_push_on_deploy()
  FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 6. Fix security_definer_view — v_zones, v_aires, v_org_unit_hierarchy
-- ============================================================================
-- These views were created in migration 022_org_unit_hierarchy.sql with the
-- default SECURITY DEFINER property. Set security_invoker = true so they
-- respect the RLS policies of the querying user. The underlying table
-- dim_org_units already has an RLS SELECT policy for anon and authenticated
-- (migration 017), so the views will continue to return data correctly.

ALTER VIEW public.v_zones SET (security_invoker = true);
ALTER VIEW public.v_aires SET (security_invoker = true);
ALTER VIEW public.v_org_unit_hierarchy SET (security_invoker = true);
