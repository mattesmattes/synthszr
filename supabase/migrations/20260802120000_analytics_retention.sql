-- SEC-008: Retention-Cleanup für öffentlich beschreibbare Analytics-Tabellen.
-- analytics_events und podcast_plays wachsen unbegrenzt durch anonyme Writes
-- (/api/track/event, /api/track/podcast-play). cleanup_analytics_retention()
-- löscht Zeilen jenseits der Retention-Frist (180d / 400d). SECURITY INVOKER,
-- da der einzige Caller createAdminClient() (service_role, BYPASSRLS) via
-- scheduled-tasks-Cron ist — DEFINER ist unnötig. EXECUTE nur für service_role.

CREATE OR REPLACE FUNCTION public.cleanup_analytics_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.analytics_events WHERE created_at < now() - interval '180 days';
  DELETE FROM public.podcast_plays WHERE played_at < now() - interval '400 days';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_analytics_retention() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_analytics_retention() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_analytics_retention() TO service_role;
