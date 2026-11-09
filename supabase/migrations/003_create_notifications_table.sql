-- ============================================================================
-- SIVAX — Notifications Table
-- ============================================================================
-- Run this AFTER 001_create_users_table.sql (depends on public.is_admin()).
-- Stores system notifications for push, in-app display, and analytics.
-- ============================================================================

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE notification_type AS ENUM (
  'system',        -- maintenance, mises à jour, annonces
  'alert',         -- alertes sanitaires (seuils dépassés, épidémies)
  'ml_insight',    -- résultats d'analyse ML / prédictions
  'data_quality',  -- anomalies dans les données DHIS2
  'user',          -- mentions, assignations de tâches
  'powerbi',       -- rapports générés, erreurs d'embed
  'security'       -- connexions suspectes, changements de mot de passe
);

CREATE TYPE notification_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- ─── Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Destinataire (null = broadcast à tous les utilisateurs)
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Classification
  type            notification_type NOT NULL DEFAULT 'system',
  priority        notification_priority NOT NULL DEFAULT 'medium',

  -- Contenu
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  summary         TEXT,                    -- résumé court pour push (max ~100 chars)
  icon            TEXT,                    -- nom d'icône lucide (ex: 'AlertTriangle', 'Sparkles')
  color           TEXT,                    -- couleur thématique (ex: 'destructive', 'warning', 'info')

  -- Action (lien deep vers une page de l'app)
  action_url      TEXT,                    -- ex: '/alerts/123' ou '/assistant?conversation=456'
  action_label    TEXT,                    -- texte du bouton (ex: "Voir l'alerte")

  -- Métadonnées flexibles (contexte spécifique au type)
  metadata        JSONB DEFAULT '{}',

  -- État
  read_at         TIMESTAMPTZ,             -- null = non lu
  dismissed_at    TIMESTAMPTZ,             -- null = non ignoré
  clicked_at      TIMESTAMPTZ,             -- null = pas cliqué (analytics d'engagement)

  -- Push notification
  push_sent_at    TIMESTAMPTZ,             -- null = pas encore envoyé en push
  push_status     TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'delivered', 'failed', 'not_applicable'
  push_error      TEXT,                    -- message d'erreur si push failed

  -- Expiration (pour nettoyer automatiquement)
  expires_at      TIMESTAMPTZ,             -- null = n'expire jamais

  -- Source (qui a créé la notification)
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null = généré par le système
  source          TEXT NOT NULL DEFAULT 'system',  -- 'system', 'ml_pipeline', 'dhis2_sync', 'admin', 'scheduled'

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX idx_notifications_user_id
  ON public.notifications (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX idx_notifications_unread
  ON public.notifications (user_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_type
  ON public.notifications (type);

CREATE INDEX idx_notifications_priority
  ON public.notifications (priority, created_at DESC);

CREATE INDEX idx_notifications_broadcast
  ON public.notifications (created_at DESC)
  WHERE user_id IS NULL;

CREATE INDEX idx_notifications_push_pending
  ON public.notifications (push_status, push_sent_at)
  WHERE push_status = 'pending';

CREATE INDEX idx_notifications_expires
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── Updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_notification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notification_updated_at ON public.notifications;
CREATE TRIGGER trigger_notification_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_notification_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications + broadcasts
DROP POLICY IF EXISTS "notifications_read_own" ON public.notifications;
CREATE POLICY "notifications_read_own" ON public.notifications
  FOR SELECT USING (
    user_id = auth.uid() OR user_id IS NULL
  );

-- Admins can read all notifications
DROP POLICY IF EXISTS "notifications_read_admin" ON public.notifications;
CREATE POLICY "notifications_read_admin" ON public.notifications
  FOR SELECT USING (public.is_admin());

-- Users can update only read/dismissed/clicked status of their own notifications (including broadcast null)
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Only admins can create notifications
DROP POLICY IF EXISTS "notifications_insert_admin" ON public.notifications;
CREATE POLICY "notifications_insert_admin" ON public.notifications
  FOR INSERT WITH CHECK (public.is_admin());

-- Admins can delete notifications
DROP POLICY IF EXISTS "notifications_delete_admin" ON public.notifications;
CREATE POLICY "notifications_delete_admin" ON public.notifications
  FOR DELETE USING (public.is_admin());

-- Users can delete their own notifications
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- ─── Auto-cleanup function (call via pg_cron or manually) ─────────────────

CREATE OR REPLACE FUNCTION public.cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.notifications WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─── Seed: welcome notifications for existing users ───────────────────────

INSERT INTO public.notifications (user_id, type, priority, title, body, summary, icon, color, action_url, action_label, source, metadata)
SELECT
  u.id,
  'system',
  'low',
  'Welcome to SIVAX',
  'Your admin account has been set up. You can now manage users, configure Power BI, and access analytics.',
  'Welcome to SIVAX — your admin account is ready.',
  'Sparkles',
  'info',
  '/settings',
  'Get started',
  'system',
  jsonb_build_object('welcome', true)
FROM public.users u
WHERE u.role = 'admin'
AND NOT EXISTS (
  SELECT 1 FROM public.notifications n
  WHERE n.user_id = u.id AND n.title = 'Welcome to SIVAX'
);

-- ─── Verify ───────────────────────────────────────────────────────────────

SELECT id, user_id, type, priority, title, read_at, created_at
FROM public.notifications
ORDER BY created_at DESC
LIMIT 10;
