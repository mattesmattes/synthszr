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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const digestId = request.nextUrl.searchParams.get('digestId')
  if (!digestId) {
    return NextResponse.json({ error: 'digestId required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const debug: Record<string, unknown> = {}

  // Step 1: Check digest exists
  const { data: digest, error: digestErr } = await supabase
    .from('daily_digests')
    .select('id, digest_date')
    .eq('id', digestId)
    .single()

  debug.step1_digest = {
    found: !!digest,
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

  // Summary
  const readyForPhase2 =
    (dbCandidates?.length || 0) > 0 &&
    remainingCandidates.length > 0 &&
    !!prompt

  return NextResponse.json({
    digestId,
    readyForPhase2,
    summary: {
      totalCandidates: dbCandidates?.length || 0,
      alreadyProcessed: processedSourceIds.size,
      remaining: remainingCandidates.length,
      hasPrompt: !!prompt
    },
    debug
  })
}
