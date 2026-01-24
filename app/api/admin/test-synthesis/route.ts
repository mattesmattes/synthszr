import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { developSynthesis } from '@/lib/synthesis/develop'
import { ScoredCandidate, SynthesisType } from '@/lib/synthesis/score'

/**
 * GET /api/admin/test-synthesis?digestId=xxx
 * Test developing a single synthesis to verify the pipeline works
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

  // Get one candidate
  const { data: candidates, error: candError } = await supabase
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
    .limit(1)

  if (candError || !candidates?.length) {
    return NextResponse.json({
      error: 'No candidates found',
      details: candError?.message
    }, { status: 404 })
  }

  // Get prompt
  const { data: prompt, error: promptError } = await supabase
    .from('synthesis_prompts')
    .select('development_prompt, core_thesis')
    .eq('is_active', true)
    .single()

  if (promptError || !prompt) {
    return NextResponse.json({
      error: 'No active prompt',
      details: promptError?.message
    }, { status: 404 })
  }

  const candidate = candidates[0]
  const sourceData = candidate.daily_repo as { id?: string; title?: string; content?: string } | null
  const relatedData = candidate.related as { id?: string; title?: string; content?: string; collected_at?: string; source_type?: string } | null

  if (!sourceData?.content || !relatedData?.content) {
    return NextResponse.json({
      error: 'Candidate missing content',
      source: !!sourceData?.content,
      related: !!relatedData?.content
    }, { status: 400 })
  }

  // Build scored candidate
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

  console.log('[Test] Developing synthesis for:', sourceData.title?.slice(0, 50))

  try {
    const synthesis = await developSynthesis(
      scoredCandidate,
      prompt.development_prompt,
      prompt.core_thesis,
      15000 // 15s timeout
    )

    return NextResponse.json({
      success: true,
      candidate: {
        source: sourceData.title?.slice(0, 60),
        related: relatedData.title?.slice(0, 60),
        type: candidate.synthesis_type,
        score: candidate.originality_score + candidate.relevance_score,
      },
      synthesis: {
        headline: synthesis.headline,
        content: synthesis.content.slice(0, 300) + '...',
        historicalReference: synthesis.historicalReference,
        alignment: synthesis.coreThesisAlignment,
      }
    })
  } catch (error) {
    console.error('[Test] Synthesis failed:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      candidate: {
        source: sourceData.title?.slice(0, 60),
        related: relatedData.title?.slice(0, 60),
      }
    }, { status: 500 })
  }
}
