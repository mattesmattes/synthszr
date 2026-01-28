import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/debug-pipeline?digestId=xxx
 * Debug the synthesis pipeline step by step
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const digestId = request.nextUrl.searchParams.get('digestId')
  if (!digestId) {
    return NextResponse.json({ error: 'digestId required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const debug: Record<string, unknown> = {}

  // Check environment
  debug.env = {
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30),
  }

  // Step 0: Test admin client works
  const { data: testQuery, error: testErr } = await supabase
    .from('daily_digests')
    .select('id')
    .limit(1)

  debug.step0_adminClientTest = {
    works: !!testQuery && testQuery.length > 0,
    count: testQuery?.length || 0,
    error: testErr?.message
  }

  // Step 1: Check digest exists (without .single() to see all results)
  const { data: digestResults, error: digestErr } = await supabase
    .from('daily_digests')
    .select('id, digest_date')
    .eq('id', digestId)

  const digest = digestResults?.[0] || null

  debug.step1_digest = {
    found: !!digest,
    resultsCount: digestResults?.length || 0,
    date: digest?.digest_date,
    error: digestErr?.message
  }

  // Step 2: Get items for this digest date
  const { data: items, error: itemsErr } = await supabase
    .from('daily_repo')
    .select('id')
    .eq('newsletter_date', digest?.digest_date)

  debug.step2_items = {
    count: items?.length || 0,
    error: itemsErr?.message
  }

  // Step 3: Check existing candidates
  const { data: existingCandidates, error: candErr } = await supabase
    .from('synthesis_candidates')
    .select('source_item_id')
    .eq('digest_id', digestId)

  debug.step3_existingCandidates = {
    count: existingCandidates?.length || 0,
    error: candErr?.message
  }

  // Step 4: Run the EXACT query from pipeline Phase 2
  const { data: dbCandidates, error: dbCandErr } = await supabase
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
      daily_repo!synthesis_candidates_source_item_id_fkey(id, title, content, source_email, source_url),
      related:daily_repo!synthesis_candidates_related_item_id_fkey(id, title, content, collected_at, source_type, source_email)
    `)
    .eq('digest_id', digestId)

  debug.step4_dbCandidatesQuery = {
    count: dbCandidates?.length || 0,
    error: dbCandErr?.message,
    firstCandidate: dbCandidates?.[0] ? {
      id: dbCandidates[0].id,
      hasSource: !!(dbCandidates[0].daily_repo as { title?: string } | null)?.title,
      hasRelated: !!(dbCandidates[0].related as { title?: string } | null)?.title,
      type: dbCandidates[0].synthesis_type,
      score: dbCandidates[0].originality_score + dbCandidates[0].relevance_score
    } : null
  }

  // Step 5: Check existing syntheses
  const { data: existingSyntheses, error: synthErr } = await supabase
    .from('developed_syntheses')
    .select('candidate_id, synthesis_candidates!inner(source_item_id)')
    .eq('digest_id', digestId)

  debug.step5_existingSyntheses = {
    count: existingSyntheses?.length || 0,
    error: synthErr?.message
  }

  // Step 6: Calculate remaining candidates
  const processedSourceIds = new Set<string>()
  if (existingSyntheses) {
    for (const s of existingSyntheses) {
      const candidates = s.synthesis_candidates as unknown as { source_item_id: string }[] | { source_item_id: string } | null
      if (Array.isArray(candidates)) {
        for (const c of candidates) {
          if (c?.source_item_id) processedSourceIds.add(c.source_item_id)
        }
      } else if (candidates?.source_item_id) {
        processedSourceIds.add(candidates.source_item_id)
      }
    }
  }

  const remainingCandidates = (dbCandidates || []).filter(
    c => !processedSourceIds.has(c.source_item_id)
  )

  debug.step6_remainingCandidates = {
    processedSourceIds: processedSourceIds.size,
    remainingCount: remainingCandidates.length
  }

  // Step 7: Check synthesis prompt
  const { data: prompt, error: promptErr } = await supabase
    .from('synthesis_prompts')
    .select('id, name')
    .eq('is_active', true)
    .single()

  debug.step7_prompt = {
    found: !!prompt,
    name: prompt?.name,
    error: promptErr?.message
  }

  // Step 8: Test find_similar_items RPC function directly
  // This is the critical function that was failing
  debug.step8_findSimilarItemsTest = await testFindSimilarItems(supabase)

  // Summary
  const readyForPhase2 =
    (dbCandidates?.length || 0) > 0 &&
    remainingCandidates.length > 0 &&
    !!prompt

  const functionWorks = debug.step8_findSimilarItemsTest &&
    typeof debug.step8_findSimilarItemsTest === 'object' &&
    'works' in debug.step8_findSimilarItemsTest &&
    debug.step8_findSimilarItemsTest.works === true

  return NextResponse.json({
    digestId,
    readyForPhase2,
    functionWorks,
    summary: {
      totalCandidates: dbCandidates?.length || 0,
      alreadyProcessed: processedSourceIds.size,
      remaining: remainingCandidates.length,
      hasPrompt: !!prompt,
      findSimilarItemsWorks: functionWorks
    },
    debug
  })
}

/**
 * Test the find_similar_items RPC function directly
 */
async function testFindSimilarItems(supabase: ReturnType<typeof createAdminClient>) {
  try {
    // First check if pgvector extension is enabled
    const { data: extensionCheck, error: extErr } = await supabase.rpc('pg_available_extensions' as never)
    const pgvectorInfo = extErr ? `Error checking: ${extErr.message}` : 'Check via SQL Editor needed'

    // Check if function exists by querying pg_proc
    const { data: funcCheck, error: funcErr } = await supabase
      .from('daily_repo')
      .select('id')
      .limit(0)  // Just to warm up connection

    // Get a sample item with embedding
    const { data: sampleItem, error: sampleErr } = await supabase
      .from('daily_repo')
      .select('id, title, embedding')
      .not('embedding', 'is', null)
      .limit(1)
      .single()

    if (sampleErr || !sampleItem) {
      return {
        works: false,
        error: 'No sample item with embedding found',
        sampleError: sampleErr?.message
      }
    }

    // Try calling the function with correct parameters
    const { data, error } = await supabase.rpc('find_similar_items', {
      query_embedding: sampleItem.embedding,
      item_id: sampleItem.id,
      max_age_days: 90,
      match_threshold: 0.3,
      match_count: 3,
    })

    if (error) {
      return {
        works: false,
        error: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        hint: error.hint,
        sampleItemId: sampleItem.id,
        sampleTitle: sampleItem.title?.slice(0, 50)
      }
    }

    return {
      works: true,
      resultsCount: data?.length || 0,
      sampleItemId: sampleItem.id,
      sampleTitle: sampleItem.title?.slice(0, 50),
      firstResult: data?.[0] ? {
        id: data[0].id,
        title: data[0].title?.slice(0, 40),
        similarity: data[0].similarity
      } : null
    }
  } catch (err) {
    return {
      works: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      errorType: err instanceof Error ? err.constructor.name : typeof err
    }
  }
}
