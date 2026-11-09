-- ============================================================================
-- SIVAX — Seed Initial Admin Users
-- ============================================================================
-- Run this AFTER 001_create_users_table.sql in the Supabase SQL Editor.
-- Creates 4 admin users with the specified credentials.
-- ============================================================================

-- Ensure pgcrypto is available (Supabase has it by default)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Helper function: create auth user + profile ──────────────────────────

CREATE OR REPLACE FUNCTION public.create_seed_user(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_role user_role DEFAULT 'admin',
  p_organization TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Check if user already exists by email
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      p_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      now(),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('full_name', p_full_name, 'role', p_role)
    );

    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', p_email),
      'email',
      p_email,
      now(),
      now(),
      now()
    );
  END IF;

  -- Upsert profile (ON CONFLICT works here because public.users has PK on id)
  INSERT INTO public.users (id, email, full_name, role, organization)
  VALUES (v_user_id, p_email, p_full_name, p_role, p_organization)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    full_name = EXCLUDED.full_name,
    organization = EXCLUDED.organization;

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ─── Create the 4 admin users ─────────────────────────────────────────────

SELECT public.create_seed_user('fidelensadi@solisbg.com', 'Test1234!', 'Fidel Ensadi', 'admin', 'SolisBG');
SELECT public.create_seed_user('joseph.musenga@villagereach.org', 'Test12345!', 'Joseph Musenga', 'admin', 'VillageReach');
SELECT public.create_seed_user('berly.mwimba@villagereach.org', 'Test123456!', 'Berly Mwimba', 'admin', 'VillageReach');
SELECT public.create_seed_user('alain.mugoto@villagereach.org', 'Test1234567!', 'Alain Mugoto', 'admin', 'VillageReach');

-- ─── Verify ───────────────────────────────────────────────────────────────

SELECT email, full_name, role, organization FROM public.users ORDER BY created_at;
