-- ─── Migration 024: Add RLS policies for tables with RLS enabled but no policies ─
--
-- Problem: 5 tables have RLS enabled but no policies, meaning no role
-- (except service_role which bypasses RLS) can read or write to them.
-- The linter flags this as INFO because it's not necessarily a bug,
-- but these tables should have explicit policies for clarity and to
-- allow authenticated access where appropriate.
--
-- Tables fixed:
-- 1. app_config        — server-side config (admin read/write only)
-- 2. app_settings      — encrypted settings (admin read/write only)
-- 3. data_export_audit_log — audit trail (admin read, service_role write)
-- 4. deployments       — deployment tracking (admin read, service_role write)
-- 5. settings_audit_log — audit trail (admin read, service_role write)
--
-- Note: dim_indicators, dim_org_units, fact_indicator_values, and etl_runs
-- already have RLS policies defined in migration 017. They appear in the
-- linter because migration 017 hasn't been applied yet.

-- ============================================================================
-- 1. app_config — key/value config table (push tokens, app URL)
-- ============================================================================
-- Only admins can read. Writes are done via service_role (bypasses RLS).
DROP POLICY IF EXISTS "app_config_read_admin" ON public.app_config;
CREATE POLICY "app_config_read_admin" ON public.app_config
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================================
-- 2. app_settings — encrypted application settings
-- ============================================================================
-- Only admins can read. Writes are done via service_role (bypasses RLS).
DROP POLICY IF EXISTS "app_settings_read_admin" ON public.app_settings;
CREATE POLICY "app_settings_read_admin" ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================================
-- 3. data_export_audit_log — tracks Power BI report exports
-- ============================================================================
-- Admins can read the audit trail. Inserts are done via service_role.
DROP POLICY IF EXISTS "data_export_audit_log_read_admin" ON public.data_export_audit_log;
CREATE POLICY "data_export_audit_log_read_admin" ON public.data_export_audit_log
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================================
-- 4. deployments — tracks app deployments (for push notifications)
-- ============================================================================
-- Admins can read deployment history. Inserts are done via service_role
-- (CI/CD webhook) and the trigger function handles push notifications.
DROP POLICY IF EXISTS "deployments_read_admin" ON public.deployments;
CREATE POLICY "deployments_read_admin" ON public.deployments
  FOR SELECT TO authenticated USING (public.is_admin());

-- ============================================================================
-- 5. settings_audit_log — tracks who changed which settings
-- ============================================================================
-- Admins can read the audit trail. Inserts are done via service_role.
DROP POLICY IF EXISTS "settings_audit_log_read_admin" ON public.settings_audit_log;
CREATE POLICY "settings_audit_log_read_admin" ON public.settings_audit_log
  FOR SELECT TO authenticated USING (public.is_admin());
