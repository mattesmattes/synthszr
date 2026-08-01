-- ============================================================
-- Security-Audit — Vollständigkeits-Sweep (Runde 2)
--
-- Ein anon-Probe über ALLE 67 im Code genutzten Tabellen fand 10
-- weitere, die der öffentliche anon-Key noch lesen konnte und die in
-- keiner Dashboard-Advisor-Liste standen. Alle sind ADMIN-ONLY:
-- jeder App-Zugriff läuft serverseitig über createAdminClient
-- (service_role, bypasst RLS) -> keine öffentliche anon-Policy nötig.
--
-- Voraussetzung (deployed): Code-Fix, der die letzten 7 anon-Pfade
-- auf service_role stellt (credentials, analysis/editor/image-prompts,
-- image-generator, stock-synthszr batch-ratings/batch-quotes).
-- ============================================================

-- Bestehende Policies entfernen (idempotent; podcast_jobs hatte in
-- Stufe 1 RLS bekommen, aber eine permissive Policy neutralisierte es).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'paywall_credentials','subscriber_preference_tokens','podcast_jobs',
      'ranking_suggestions','stock_synthszr_cache','stylistic_rules',
      'analysis_prompts','editor_in_chief_prompts','image_prompts','edit_diffs'
    )
  LOOP EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename); END LOOP;
END $$;

ALTER TABLE public.paywall_credentials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_preference_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.podcast_jobs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_suggestions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_synthszr_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stylistic_rules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_prompts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_in_chief_prompts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_prompts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_diffs                   ENABLE ROW LEVEL SECURITY;
