import { createAdminClient } from '@/lib/supabase/admin'
import { staleBeforeIso } from '@/lib/rankings/jobs-lease'

interface RankingJob {
  id: string; phase: string; cursor: number
  attempts: number; max_attempts: number; status: string
}

/**
 * Advance-Skelett. Atomarer Claim via claim_ranking_job-RPC (FOR UPDATE SKIP LOCKED)
 * statt Select-then-Update → kein Race zwischen Cron und Browser-Treiber.
 * Phase 0: Claim + Dispatch-Stub. Phase 1+ füllt die case-Bodies.
 */
export async function advanceRankingJob(_jobId?: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: job, error } = await supabase
    .rpc('claim_ranking_job', { stale_before: staleBeforeIso(Date.now()) })
    .maybeSingle()
  if (error) { console.error('[RankingJobs] claim failed:', error); return 'claim_error' }
  if (!job) return 'no_job'

  const j = job as RankingJob
  switch (j.phase) {
    case 'extract':
    case 'enrich':
    case 'research':
    case 'aggregate':
    case 'assets':
    default:
      return 'noop_phase'   // Phase 1+ implementiert die Phasen-Bodies
  }
}
