-- ============================================================
-- Security-Audit #6 — historische permissive Policies bereinigen
--
-- Fund (User-Review via pg_policies): 9 Tabellen mit
-- `TO public FOR ALL USING(true)` → erlaubten anon nicht nur Lesen,
-- sondern auch INSERT/UPDATE/DELETE (mehrere irreführend
-- "Service role full access" benannt, obwohl roles={public}).
-- Plus 3 überflüssige anon-Policies auf subscribers.
--
-- Sicher verifiziert (kein Code-Bruch):
--  - users/user_artists/analogy_videos/edit_examples/pattern_conflicts:
--    nirgends im Code genutzt.
--  - applied_patterns/learned_patterns/ranking_runs: nur service_role
--    (createAdminClient bypasst RLS).
--  - ui_translations: anon-READ bleibt über separate SELECT-Policy.
--  - subscribers: subscribe + confirm nutzen service_role.
-- ============================================================

-- 1) Permissive FOR-ALL-public-Policies entfernen (anon read+write!)
DROP POLICY IF EXISTS "Allow all analogy_videos operations" ON public.analogy_videos;
DROP POLICY IF EXISTS "Service role full access"            ON public.applied_patterns;
DROP POLICY IF EXISTS "Service role full access"            ON public.edit_examples;
DROP POLICY IF EXISTS "Service role full access"            ON public.learned_patterns;
DROP POLICY IF EXISTS "Service role full access"            ON public.pattern_conflicts;
DROP POLICY IF EXISTS "Service role full access"            ON public.ranking_runs;
DROP POLICY IF EXISTS "Anon can manage ui_translations"     ON public.ui_translations;
DROP POLICY IF EXISTS "Allow all on user_artists"           ON public.user_artists;
DROP POLICY IF EXISTS "Allow all on users"                  ON public.users;

-- 2) subscribers: überflüssige anon-Policies entfernen
--    (App nutzt durchgängig service_role; UPDATE mit check=true war
--     ein Vektor, SELECT leakte pending-Subscriber-PII)
DROP POLICY IF EXISTS "Allow public to subscribe"           ON public.subscribers;
DROP POLICY IF EXISTS "Allow status update on confirmation" ON public.subscribers;
DROP POLICY IF EXISTS "Allow confirmation token lookup"     ON public.subscribers;

-- 3) RLS sicherstellen (falls eine Tabelle sie noch nicht aktiv hatte —
--    sonst wäre der Policy-Drop wirkungslos). service_role bypasst RLS,
--    daher laufen alle Admin-/Pipeline-Zugriffe unverändert weiter.
ALTER TABLE public.analogy_videos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applied_patterns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_examples     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learned_patterns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ui_translations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_artists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribers       ENABLE ROW LEVEL SECURITY;

-- ui_translations behält die bestehende Lese-Policy "Anyone can read
-- ui_translations" (SELECT TO public USING true) → anon-READ bleibt intakt,
-- nur der anon-WRITE-Pfad ist zu. Kein weiteres Statement nötig.
