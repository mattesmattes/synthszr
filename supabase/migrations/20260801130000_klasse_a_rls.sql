-- ============================================================
-- Security-Audit — Klasse-A-RLS (Stufe 2, finaler Schritt)
--
-- Voraussetzung (deployed & prod-verifiziert):
--   - 1e9f544  serverseitige Content-Pipeline auf service_role
--   - 8a4d4b9  newsletter_sources-CRUD auf authentifizierte Route
-- Alle App-Zugriffe auf diese Tabellen laufen jetzt entweder über
-- createAdminClient (service_role, bypasst RLS) oder sind öffentliche
-- anon-SELECTs mit dem unten als Policy abgebildeten Filter.
--
-- Auth ist custom JWT (kein Supabase-Auth) -> Policies können nur
-- TO anon nutzen; service_role bypasst RLS generell.
-- ============================================================

-- 1) Bestehende Policies auf allen Klasse-A-Tabellen entfernen.
--    Idempotent: manche Tabellen hatten evtl. schon RLS + permissive
--    anon-Policy (wie gmail_tokens/settings in Stufe 1); ohne Drop
--    bliebe die permissive Policy neben der neuen bestehen (OR-Logik).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'daily_repo','daily_digests','news_queue','ghostwriter_prompts',
        'vocabulary_dictionary','newsletter_settings','translation_queue',
        'edit_history','post_podcasts',
        'posts','generated_posts','content_translations','post_images',
        'static_pages','languages','newsletter_sources'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 2) ADMIN-ONLY: RLS aktiv, KEINE Policy -> anon/authenticated komplett deny.
--    (service_role bypasst -> Admin-Routes & Cron funktionieren weiter.)
ALTER TABLE public.daily_repo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_digests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_queue            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostwriter_prompts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_podcasts         ENABLE ROW LEVEL SECURITY;

-- 3) PUBLIC-READ: RLS aktiv + anon-SELECT-Policy mit exakt dem Filter,
--    den die öffentlichen Reader-Seiten ohnehin verwenden (verifiziert).
--    SELECT-only -> keine anon-Writes; service_role bypasst alles.
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_public_read ON public.posts
  FOR SELECT TO anon USING (published = true);

ALTER TABLE public.generated_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY genposts_public_read ON public.generated_posts
  FOR SELECT TO anon USING (status = 'published');

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_public_read ON public.content_translations
  FOR SELECT TO anon USING (translation_status = 'completed');

ALTER TABLE public.post_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY pi_public_read ON public.post_images
  FOR SELECT TO anon USING (generation_status = 'completed');

ALTER TABLE public.static_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY sp_public_read ON public.static_pages
  FOR SELECT TO anon USING (true);

ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY lang_public_read ON public.languages
  FOR SELECT TO anon USING (is_active = true);

ALTER TABLE public.newsletter_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY ns_public_read ON public.newsletter_sources
  FOR SELECT TO anon USING (enabled = true);
