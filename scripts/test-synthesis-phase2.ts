import { config } from 'dotenv'
config({ path: '.env.local' })

// Need to set this before importing modules that use it
process.env.NODE_ENV = 'development'

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DIGEST_ID = '9c9132c9-6fdb-4a9b-902e-395fd9397e9f'

async function testPhase2() {
  console.log('=== Testing Synthesis Phase 2 ===\n')

  // 1. Check existing candidates
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
      daily_repo!synthesis_candidates_source_item_id_fkey(id, title, content),
      related:daily_repo!synthesis_candidates_related_item_id_fkey(id, title, content)
    `)
    .eq('digest_id', DIGEST_ID)

  if (candidatesError) {
    console.log('Error fetching candidates:', candidatesError.message)
    return
  }

  console.log(`Found ${dbCandidates?.length || 0} candidates in database`)

  if (!dbCandidates || dbCandidates.length === 0) {
    console.log('No candidates to process!')
    return
  }

  // 2. Check existing syntheses
  const { data: existingSyntheses } = await supabase
    .from('developed_syntheses')
    .select('candidate_id')
    .eq('digest_id', DIGEST_ID)

  const processedCandidateIds = new Set<string>()
  if (existingSyntheses) {
    for (const s of existingSyntheses) {
      if (s.candidate_id) processedCandidateIds.add(s.candidate_id)
    }
  }

  console.log(`Already processed candidates: ${processedCandidateIds.size}`)

  // 3. Filter to unprocessed candidates
  const unprocessedCandidates = dbCandidates.filter(c => !processedCandidateIds.has(c.id))
  console.log(`Unprocessed candidates: ${unprocessedCandidates.length}`)

  if (unprocessedCandidates.length === 0) {
    console.log('\nAll candidates already processed!')
    return
  }

  // 4. Show first candidate details
  const first = unprocessedCandidates[0]
  console.log('\n--- First unprocessed candidate ---')
  console.log('Candidate ID:', first.id)
  console.log('Type:', first.synthesis_type)
  console.log('Scores: O=' + first.originality_score + ' R=' + first.relevance_score)

  const sourceData = first.daily_repo as { id: string; title: string; content: string } | null
  const relatedData = first.related as { id: string; title: string; content: string } | null

  console.log('Source:', sourceData?.title?.slice(0, 60) + '...')
  console.log('Related:', relatedData?.title?.slice(0, 60) + '...')

  // 5. Try to develop one synthesis
  console.log('\n--- Attempting to develop synthesis ---')

  // Get the active prompt
  const { data: prompt } = await supabase
    .from('synthesis_prompts')
    .select('*')
    .eq('is_active', true)
    .single()

  if (!prompt) {
    console.log('ERROR: No active synthesis prompt found!')
    return
  }

  console.log('Active prompt:', prompt.name)

  // Import and call the develop function
  const { developSynthesis } = await import('../lib/synthesis/develop')

  try {
    const candidate = {
      sourceItem: {
        id: first.source_item_id,
        title: sourceData?.title || '',
        content: sourceData?.content || '',
      },
      relatedItem: {
        id: first.related_item_id,
        title: relatedData?.title || '',
        content: relatedData?.content || '',
        collected_at: '',
        source_type: 'unknown',
        source_email: null,
        similarity: first.similarity_score,
      },
      similarityScore: first.similarity_score,
      originalityScore: first.originality_score,
      relevanceScore: first.relevance_score,
      synthesisType: first.synthesis_type,
      reasoning: '',
      daysAgo: 0,
      totalScore: first.originality_score + first.relevance_score,
    }

    console.log('Calling developSynthesis...')
    const result = await developSynthesis(
      candidate as any,
      prompt.development_prompt,
      prompt.core_thesis
    )

    console.log('\n✓ Synthesis developed successfully!')
    console.log('Headline:', result.headline)
    console.log('Content:', result.content.slice(0, 200) + '...')
  } catch (error) {
    console.log('\n✗ Error developing synthesis:', error)
  }
}

testPhase2().catch(console.error)
