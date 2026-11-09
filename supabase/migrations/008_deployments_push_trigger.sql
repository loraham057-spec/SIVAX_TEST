-- Enable pg_net extension (required for net.http_post in trigger)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Deployments table to track new deployments
CREATE TABLE IF NOT EXISTS public.deployments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id    TEXT NOT NULL UNIQUE,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  push_sent   BOOLEAN NOT NULL DEFAULT false,
  changelog   JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so no policy needed for inserts

-- Config table for push notification settings
CREATE TABLE IF NOT EXISTS public.app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Default config values (update these after running the migration)
INSERT INTO public.app_config (key, value) VALUES
  ('app_url', 'https://tbi.solisbg.com'),
  ('push_token', 'diav1-internal-push-2024')
ON CONFLICT (key) DO NOTHING;

-- Create a function that sends push + email notification via HTTP when a new deployment is inserted
-- Requires pg_net extension (available on Supabase free tier)
CREATE OR REPLACE FUNCTION public.notify_push_on_deploy()
RETURNS TRIGGER AS $$
DECLARE
  app_url TEXT;
  push_token TEXT;
  push_endpoint TEXT;
  body_json TEXT;
  headers_json JSONB;
BEGIN
  SELECT value INTO app_url FROM public.app_config WHERE key = 'app_url';
  SELECT value INTO push_token FROM public.app_config WHERE key = 'push_token';

  IF app_url IS NULL OR push_token IS NULL THEN
    RAISE WARNING 'notify_push_on_deploy: app_url or push_token not configured';
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

  -- pg_net signature: net.http_post(url, headers, body, timeout_milliseconds)
  -- Wrap in EXCEPTION block: if pg_net is unavailable, the INSERT must still succeed.
  BEGIN
    PERFORM net.http_post(
      push_endpoint,
      headers_json,
      body_json,
      5000
    );
    UPDATE public.deployments SET push_sent = true WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_push_on_deploy: net.http_post failed: %', SQLERRM;
    -- push_sent stays false; the generate-version.mjs script also calls
    -- /api/push/send directly as a fallback.
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_deployment_insert ON public.deployments;

-- Create trigger
CREATE TRIGGER on_deployment_insert
  AFTER INSERT ON public.deployments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_deploy();
