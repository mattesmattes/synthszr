/** Fenster, in dem ein aktiv getriebener Job für den Cron tabu ist (länger als jeder Tick). */
export const LEASE_STALE_MS = 6 * 60 * 1000

/** Darf der Cron den Job übernehmen (Stempel alt genug)? */
export function isLeaseStale(lastAdvancedAt: string | null, nowMs: number): boolean {
  if (!lastAdvancedAt) return true
  return nowMs - new Date(lastAdvancedAt).getTime() >= LEASE_STALE_MS
}

/** ISO-Schwelle für die claim_ranking_job-RPC. */
export function staleBeforeIso(nowMs: number): string {
  return new Date(nowMs - LEASE_STALE_MS).toISOString()
}
