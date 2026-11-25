-- Security Audit Hardening Migration (2026-11-25)
-- Addresses RLS, view security_invoker, RPC EXECUTE grants, draft leakage policies,
-- and cross-language agent comment uniqueness surfaced in security-audit run-1.

-- 1. Restore security_invoker and revoke anon/authenticated access on news_queue_selectable
-- (recreated without security_invoker / REVOKE in 20261125070000_scoring_v2.sql)
ALTER VIEW IF EXISTS public.news_queue_selectable SET (security_invoker = true);
REVOKE ALL ON public.news_queue_selectable FROM PUBLIC, anon, authenticated;

-- 2. Track RLS and REVOKE grants for paid_subscriptions in migrations
ALTER TABLE IF EXISTS public.paid_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paid_subscriptions FROM PUBLIC, anon, authenticated;

-- 3. Track RLS and REVOKE grants for mattes_corpus_chunks and match_mattes_chunks RPC
ALTER TABLE IF EXISTS public.mattes_corpus_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mattes_corpus_chunks FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_mattes_chunks'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.match_mattes_chunks(vector(768), float, int)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 4. Track RLS and REVOKE grants for discovered_companies (feeds prebuild codegen)
ALTER TABLE IF EXISTS public.discovered_companies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovered_companies FROM PUBLIC, anon, authenticated;

-- 5. Prevent anon reads of draft/unpublished post translations and post images
DROP POLICY IF EXISTS ct_public_read ON public.content_translations;
CREATE POLICY ct_public_read ON public.content_translations
  FOR SELECT TO anon
  USING (
    translation_status = 'completed'
    AND (
      generated_post_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.generated_posts gp
        WHERE gp.id = content_translations.generated_post_id
          AND gp.status = 'published'
      )
    )
  );

DROP POLICY IF EXISTS pi_public_read ON public.post_images;
CREATE POLICY pi_public_read ON public.post_images
  FOR SELECT TO anon
  USING (
    generation_status = 'completed'
    AND (
      post_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.generated_posts gp
        WHERE gp.id = post_images.post_id
          AND gp.status = 'published'
      )
    )
  );

-- 6. Enforce cross-language uniqueness for agent comments per section
-- (replaces lang-scoped post_comments_agent_section_uniq from 20261026090000_agent_comments.sql)
DROP INDEX IF EXISTS public.post_comments_agent_section_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS post_comments_agent_section_uniq
  ON public.post_comments (agent_id, post_id, section_anchor)
  WHERE agent_id IS NOT NULL;
