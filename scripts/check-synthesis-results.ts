import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Get the latest digest (should be from 28.1)
  const { data: digest } = await supabase
    .from('daily_digests')
    .select('id, digest_date')
    .order('digest_date', { ascending: false })
    .limit(1)
    .single()

  if (!digest) {
    console.log('Kein Digest gefunden!')
    return
  }

  console.log('=== Synthese-Ergebnisse für', digest.digest_date, '===\n')

  // Count synthesis candidates
  const { count: candidateCount, data: candidates } = await supabase
    .from('synthesis_candidates')
    .select('id, originality_score, relevance_score, synthesis_type, reasoning, daily_repo!synthesis_candidates_source_item_id_fkey(title)', { count: 'exact' })
    .eq('digest_id', digest.id)
    .order('originality_score', { ascending: false })
    .limit(10)

  console.log('Synthesis Candidates gespeichert:', candidateCount)

  if (candidates && candidates.length > 0) {
    console.log('\nTop Candidates:')
    for (const c of candidates) {
      const title = (c.daily_repo as { title?: string } | null)?.title || 'Unknown'
      const total = (c.originality_score || 0) + (c.relevance_score || 0)
      console.log(`  [O:${c.originality_score} R:${c.relevance_score} T:${total}] ${c.synthesis_type}`)
      console.log(`    "${title.slice(0, 50)}..."`)
      console.log(`    → ${c.reasoning?.slice(0, 80)}...`)
      console.log('')
    }
  }

  // Count developed syntheses
  const { count: synthesisCount } = await supabase
    .from('developed_syntheses')
    .select('id', { count: 'exact', head: true })
    .eq('digest_id', digest.id)

  console.log('\nDeveloped Syntheses:', synthesisCount)

  // Check for items queued to news_queue
  const { count: queuedCount } = await supabase
    .from('news_queue')
    .select('id', { count: 'exact', head: true })
    .gte('queued_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  console.log('Items in News Queue (letzte 24h):', queuedCount)
}

check()
