-- Fix: wrap net.http_post in EXCEPTION block so INSERT into deployments
-- doesn't fail when pg_net is unavailable.
-- The generate-version.mjs script also calls /api/push/send directly as fallback.

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
