-- Enable pg_net extension (required for net.http_post in trigger)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Add changelog column to existing deployments table (if not exists)
ALTER TABLE public.deployments ADD COLUMN IF NOT EXISTS changelog JSONB DEFAULT '[]'::jsonb;

-- Recreate the trigger function with changelog support
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

  -- pg_net signature: net.http_post(url, headers, body, timeout_milliseconds)
  SELECT id INTO request_id FROM net.http_post(
    push_endpoint,
    headers_json,
    body_json,
    5000
  );

  RAISE NOTICE 'notify_push_on_deploy: pg_net request_id=%', request_id;

  UPDATE public.deployments SET push_sent = true WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
