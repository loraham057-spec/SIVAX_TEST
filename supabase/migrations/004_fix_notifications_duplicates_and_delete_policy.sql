-- Fix: Add delete policy for users on their own notifications
-- Fix: Deduplicate welcome notifications (keep only one per user)

-- Add missing delete policy
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- Remove duplicate welcome notifications (keep the oldest one per user)
DELETE FROM public.notifications
WHERE id NOT IN (
  SELECT (MIN(id::text))::uuid FROM public.notifications
  WHERE title = 'Welcome to SIVAX'
  GROUP BY user_id
)
AND title = 'Welcome to SIVAX';

-- Verify
SELECT id, user_id, title, created_at
FROM public.notifications
ORDER BY created_at DESC;
