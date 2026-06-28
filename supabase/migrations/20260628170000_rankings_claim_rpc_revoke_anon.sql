-- Nachzug zum Security-Fix: Supabase grantet EXECUTE auf neue public-Funktionen
-- per ALTER DEFAULT PRIVILEGES explizit an anon + authenticated — REVOKE FROM
-- PUBLIC allein entfernt das nicht. Daher explizit von beiden Rollen entziehen,
-- sodass nur service_role die Job-Claim-RPC ausführen kann (anon → 403).
REVOKE EXECUTE ON FUNCTION claim_ranking_job(timestamptz) FROM anon, authenticated;
