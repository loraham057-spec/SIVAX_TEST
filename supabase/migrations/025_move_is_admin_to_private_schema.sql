-- ─── Migration 025: Move is_admin() out of the exposed public schema ─────────
--
-- public.is_admin() must be SECURITY DEFINER to inspect public.users without
-- causing RLS recursion. Granting authenticated users EXECUTE is necessary for
-- RLS evaluation, but also exposes the function through PostgREST RPC because
-- the public schema is API-exposed.
--
-- Fix: move the helper to a private, non-API schema and update every policy
-- that uses it. Authenticated users retain the minimum USAGE + EXECUTE rights
-- needed for RLS evaluation, but the function is no longer reachable through
-- /rest/v1/rpc/is_admin.
--
-- Run this migration AFTER migrations 024 and 023.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- ─── public.users ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins_read_all" ON public.users;
CREATE POLICY "admins_read_all" ON public.users
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "admins_update_all" ON public.users;
CREATE POLICY "admins_update_all" ON public.users
  FOR UPDATE TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "admins_delete" ON public.users;
CREATE POLICY "admins_delete" ON public.users
  FOR DELETE TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "admins_insert" ON public.users;
CREATE POLICY "admins_insert" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

-- ─── public.notifications ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_read_admin" ON public.notifications;
CREATE POLICY "notifications_read_admin" ON public.notifications
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (private.is_admin());

DROP POLICY IF EXISTS "notifications_delete_admin" ON public.notifications;
CREATE POLICY "notifications_delete_admin" ON public.notifications
  FOR DELETE TO authenticated
  USING (private.is_admin());

-- ─── public.push_subscriptions ──────────────────────────────────────────────
DROP POLICY IF EXISTS "push_subs_admin_all" ON public.push_subscriptions;
CREATE POLICY "push_subs_admin_all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (private.is_admin())
  WITH CHECK (private.is_admin());

-- ─── Server configuration and audit tables ─────────────────────────────────
DROP POLICY IF EXISTS "app_config_read_admin" ON public.app_config;
CREATE POLICY "app_config_read_admin" ON public.app_config
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "app_settings_read_admin" ON public.app_settings;
CREATE POLICY "app_settings_read_admin" ON public.app_settings
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "data_export_audit_log_read_admin" ON public.data_export_audit_log;
CREATE POLICY "data_export_audit_log_read_admin" ON public.data_export_audit_log
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "deployments_read_admin" ON public.deployments;
CREATE POLICY "deployments_read_admin" ON public.deployments
  FOR SELECT TO authenticated
  USING (private.is_admin());

DROP POLICY IF EXISTS "settings_audit_log_read_admin" ON public.settings_audit_log;
CREATE POLICY "settings_audit_log_read_admin" ON public.settings_audit_log
  FOR SELECT TO authenticated
  USING (private.is_admin());

-- All dependencies now use private.is_admin(), so remove the API-exposed helper.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.is_admin();
