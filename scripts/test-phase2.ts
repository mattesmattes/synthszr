/**
 * Test Phase 2 of synthesis pipeline manually
 * This bypasses Phase 1 (which already created candidates) and tests just Phase 2
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DIGEST_ID = '9c9132c9-6fdb-4a9b-902e-395fd9397e9f'

async function testPhase2() {
  console.log('=== Testing Phase 2 Synthesis Development ===\n')

  // Check if ANTHROPIC_API_KEY is set
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('❌ ANTHROPIC_API_KEY not set locally')
    console.log('   This test would work on prod where the key is set')
    console.log('\n   To test locally, add ANTHROPIC_API_KEY to .env.local')
    return
  }

  // 1. Get candidates
  const { data: dbCandidates, error: candidatesError } = await supabase
    .from('synthesis_candidates')
    .select(`
      id,
      source_item_id,
      related_item_id,
      similarity_score,
      synthesis_type,
      originality_score,
      relevance_score,
      reasoning,
      daily_repo!synthesis_candidates_source_item_id_fkey(id, title, content),
      related:daily_repo!synthesis_candidates_related_item_id_fkey(id, title, content)
    `)
    .eq('digest_id', DIGEST_ID)
    .limit(1) // Just test with 1 candidate

  if (candidatesError || !dbCandidates?.length) {
    console.log('❌ Failed to get candidates:', candidatesError?.message)
    return
  }

  console.log(`✓ Got ${dbCandidates.length} candidate(s) for testing\n`)

  // 2. Get synthesis prompt
  const { data: prompt, error: promptError } = await supabase
    .from('synthesis_prompts')
    .select('development_prompt, core_thesis')
    .eq('is_active', true)
    .single()

  if (promptError || !prompt) {
    console.log('❌ Failed to get synthesis prompt:', promptError?.message)
    return
  }

  console.log('✓ Got active synthesis prompt\n')

  // 3. Try developing synthesis for first candidate
  const candidate = dbCandidates[0]
  const sourceData = candidate.daily_repo as { title?: string; content?: string } | null
  const relatedData = candidate.related as { title?: string; content?: string } | null

  console.log('Testing with candidate:')
  console.log(`  Source: "${sourceData?.title?.slice(0, 50)}..."`)
  console.log(`  Related: "${relatedData?.title?.slice(0, 50)}..."`)
  console.log(`  Type: ${candidate.synthesis_type}`)
  console.log(`  Score: ${candidate.originality_score + candidate.relevance_score}\n`)

  // 4. Import and call developSynthesis
  const { developSynthesis } = await import('../lib/synthesis/develop')

  const scoredCandidate = {
    sourceItem: {
      id: candidate.source_item_id,
      title: sourceData?.title || '',
      content: sourceData?.content || '',
    },
    relatedItem: {
      id: candidate.related_item_id,
      title: relatedData?.title || '',
      content: relatedData?.content || '',
      collected_at: '',
      source_type: 'unknown',
      source_email: null,
      similarity: candidate.similarity_score,
    },
    similarityScore: candidate.similarity_score,
    originalityScore: candidate.originality_score,
    relevanceScore: candidate.relevance_score,
    synthesisType: candidate.synthesis_type as 'evolution' | 'validation' | 'contrast' | 'pattern' | 'cross_domain',
    reasoning: candidate.reasoning || '',
    daysAgo: 0,
    totalScore: candidate.originality_score + candidate.relevance_score,
  }

  console.log('Calling Claude Opus to develop synthesis...\n')

  try {
    const synthesis = await developSynthesis(
      scoredCandidate,
      prompt.development_prompt,
      prompt.core_thesis
    )

    console.log('✓ Synthesis developed successfully!')
    console.log('\n--- Result ---')
    console.log(`Headline: ${synthesis.headline}`)
    console.log(`Content: ${synthesis.content.slice(0, 200)}...`)
    console.log(`Historical Reference: ${synthesis.historicalReference}`)
  } catch (error) {
    console.log('❌ Failed to develop synthesis:')
    console.log(error)
  }
}

testPhase2().catch(console.error)
