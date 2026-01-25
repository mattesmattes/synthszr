import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { developSynthesis } from '@/lib/synthesis/develop'
import { ScoredCandidate, SynthesisType } from '@/lib/synthesis/score'

/**
 * POST /api/admin/run-synthesis
 * Run synthesis Phase 2 directly with detailed logging
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json()
  const { digestId, maxItems = 2 } = body

  if (!digestId) {
    return NextResponse.json({ error: 'digestId required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const log: string[] = []
  const results: Array<{ headline: string; success: boolean; error?: string }> = []

  log.push(`Starting synthesis for digest ${digestId}`)

  // Get prompt
  const { data: prompt, error: promptErr } = await supabase
    .from('synthesis_prompts')
    .select('development_prompt, core_thesis')
    .eq('is_active', true)
    .single()

  if (promptErr || !prompt) {
    log.push(`ERROR: No active prompt - ${promptErr?.message}`)
    return NextResponse.json({ success: false, log, results })
  }
  log.push('Got active prompt')

  // Get already-processed source_item_ids
  const { data: existingSyntheses } = await supabase
    .from('developed_syntheses')
    .select('synthesis_candidates!inner(source_item_id)')
    .eq('digest_id', digestId)

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
  log.push(`Found ${processedSourceIds.size} already-processed source items`)

  // Get all candidates for this digest
  const { data: allCandidates, error: candErr } = await supabase
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
      related:daily_repo!synthesis_candidates_related_item_id_fkey(id, title, content, collected_at, source_type)
    `)
    .eq('digest_id', digestId)

  // Filter to only unprocessed candidates
  const dbCandidates = (allCandidates || [])
    .filter(c => !processedSourceIds.has(c.source_item_id))
    .slice(0, maxItems)

  if (candErr) {
    log.push(`ERROR: Failed to get candidates - ${candErr.message}`)
    return NextResponse.json({ success: false, log, results })
  }

  log.push(`Got ${dbCandidates?.length || 0} candidates`)

  if (!dbCandidates || dbCandidates.length === 0) {
    log.push('No candidates found - returning')
    return NextResponse.json({ success: false, log, results })
  }

  // Process each candidate
  for (let i = 0; i < dbCandidates.length; i++) {
    const candidate = dbCandidates[i]
    const sourceData = candidate.daily_repo as { id?: string; title?: string; content?: string } | null
    const relatedData = candidate.related as { id?: string; title?: string; content?: string; collected_at?: string; source_type?: string } | null

    log.push(`Processing candidate ${i + 1}: "${sourceData?.title?.slice(0, 40)}..."`)

    if (!sourceData?.content || !relatedData?.content) {
      log.push(`  SKIP: Missing content (source: ${!!sourceData?.content}, related: ${!!relatedData?.content})`)
      continue
    }

    const scoredCandidate: ScoredCandidate = {
      sourceItem: {
        id: candidate.source_item_id,
        title: sourceData.title || '',
        content: sourceData.content,
      },
      relatedItem: {
        id: candidate.related_item_id,
        title: relatedData.title || '',
        content: relatedData.content,
        collected_at: relatedData.collected_at || '',
        source_type: relatedData.source_type || 'unknown',
        source_email: null,
        similarity: candidate.similarity_score,
      },
      similarityScore: candidate.similarity_score,
      originalityScore: candidate.originality_score,
      relevanceScore: candidate.relevance_score,
      synthesisType: candidate.synthesis_type as SynthesisType,
      reasoning: candidate.reasoning || '',
      daysAgo: 0,
      totalScore: candidate.originality_score + candidate.relevance_score,
    }

    try {
      log.push(`  Calling developSynthesis...`)
      const synthesis = await developSynthesis(
        scoredCandidate,
        prompt.development_prompt,
        prompt.core_thesis,
        20000 // 20s timeout
      )
      log.push(`  SUCCESS: "${synthesis.headline}"`)
      results.push({ headline: synthesis.headline, success: true })

      // Store the synthesis
      const { error: storeErr } = await supabase
        .from('developed_syntheses')
        .insert({
          candidate_id: candidate.id,
          digest_id: digestId,
          synthesis_content: synthesis.content,
          synthesis_headline: synthesis.headline,
          historical_reference: synthesis.historicalReference || '',
          core_thesis_alignment: synthesis.coreThesisAlignment,
        })

      if (storeErr) {
        log.push(`  WARNING: Failed to store - ${storeErr.message}`)
      } else {
        log.push(`  Stored in database`)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      log.push(`  ERROR: ${errMsg}`)
      results.push({ headline: sourceData?.title?.slice(0, 40) || 'Unknown', success: false, error: errMsg })
    }
  }

  log.push(`Done. ${results.filter(r => r.success).length} syntheses created.`)

  return NextResponse.json({
    success: results.some(r => r.success),
    synthesesCreated: results.filter(r => r.success).length,
    log,
    results
  })
}
