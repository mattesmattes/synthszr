-- Security Audit Hardening Part 2 (2026-11-25)
-- 1. Pin search_path on get_balanced_queue_selection()
-- 2. Add svix_id column + unique partial index on email_events for atomic webhook dedup
-- 3. Prevent concurrent double-send races on newsletter_sends (status = 'sending')

ALTER FUNCTION public.get_balanced_queue_selection(integer, numeric)
  SET search_path = pg_catalog, public;

ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS svix_id text;

CREATE UNIQUE INDEX IF NOT EXISTS email_events_svix_id_uidx
  ON public.email_events (svix_id)
  WHERE svix_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_sends_one_sending_per_post_uidx
  ON public.newsletter_sends (post_id)
  WHERE post_id IS NOT NULL AND status = 'sending';
