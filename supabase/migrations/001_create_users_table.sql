-- ============================================================================
-- SIVAX — User Management Schema for Supabase
-- ============================================================================
-- Run this in the Supabase SQL Editor after creating your project.
-- ============================================================================

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'analyst', 'viewer');

-- ─── Users Table ──────────────────────────────────────────────────────────
-- Extends auth.users with application-specific profile data.
-- The `id` column references auth.users(id) so each profile maps to an auth user.

CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL DEFAULT '',
  role        user_role NOT NULL DEFAULT 'viewer',
  organization TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- ─── Updated_at Trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON public.users;
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ─── Auto-create profile on signup ────────────────────────────────────────
-- When a new user registers via Supabase Auth, automatically create a profile
-- row with the default 'viewer' role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'viewer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_on_auth_user_created ON auth.users;
CREATE TRIGGER trigger_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Helper function to check admin role without RLS recursion
-- SECURITY DEFINER bypasses RLS when querying public.users
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Policy: Users can read their own profile
DROP POLICY IF EXISTS "users_read_self" ON public.users;
CREATE POLICY "users_read_self" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Policy: Admins can read all profiles
DROP POLICY IF EXISTS "admins_read_all" ON public.users;
CREATE POLICY "admins_read_all" ON public.users
  FOR SELECT USING (public.is_admin());

-- Policy: Users can update their own profile (name, avatar only — NOT role)
DROP POLICY IF EXISTS "users_update_self" ON public.users;
CREATE POLICY "users_update_self" ON public.users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy: Admins can update any profile (including role changes)
DROP POLICY IF EXISTS "admins_update_all" ON public.users;
CREATE POLICY "admins_update_all" ON public.users
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Policy: Admins can delete profiles
DROP POLICY IF EXISTS "admins_delete" ON public.users;
CREATE POLICY "admins_delete" ON public.users
  FOR DELETE USING (public.is_admin());

-- Policy: Admins can insert new profiles
DROP POLICY IF EXISTS "admins_insert" ON public.users;
CREATE POLICY "admins_insert" ON public.users
  FOR INSERT WITH CHECK (public.is_admin());

-- ─── Initial Admin User ───────────────────────────────────────────────────
-- After running this migration:
-- 1. Create your first admin user via Supabase Dashboard > Authentication > Add User
-- 2. Then run this SQL to promote them to admin:
--    UPDATE public.users SET role = 'admin' WHERE email = 'your-email@example.com';
