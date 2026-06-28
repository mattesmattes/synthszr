-- Härtet claim_ranking_job (Finding aus dem Phase-0-Whole-Branch-Review):
-- Die RPC war SECURITY DEFINER mit Default-EXECUTE an PUBLIC → ein anonymer
-- Aufruf lief als Owner und unterlief die RLS-Absicherung von ranking_jobs
-- (empirisch: anon POST /rpc/claim_ranking_job → 200). Ab Phase 1 = DoS-/
-- Exfiltrations-Risiko (Budgets, spend, error_message, attempts++).
-- Einziger realer Caller ist createAdminClient() (service_role, BYPASSRLS) —
-- DEFINER ist unnötig.
ALTER FUNCTION claim_ranking_job(timestamptz) SECURITY INVOKER;
ALTER FUNCTION claim_ranking_job(timestamptz) SET search_path = pg_catalog, public;
REVOKE EXECUTE ON FUNCTION claim_ranking_job(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_ranking_job(timestamptz) TO service_role;
