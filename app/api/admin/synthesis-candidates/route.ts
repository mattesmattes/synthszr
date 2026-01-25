/**
 * Synthesis Candidates API
 * GET: Fetch synthesis candidates by digest date with scores
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'Date parameter required' }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    // First get the digest for this date
    const { data: digest, error: digestError } = await supabase
      .from('daily_digests')
      .select('id')
      .eq('digest_date', date)
      .single()

    if (digestError || !digest) {
      return NextResponse.json({ items: [], message: 'No digest found for this date' })
    }

    // Get synthesis candidates with joined daily_repo data for source info
    const { data, error } = await supabase
      .from('synthesis_candidates')
      .select(`
        id,
        source_item_id,
        originality_score,
        relevance_score,
        synthesis_type,
        reasoning,
        created_at,
        daily_repo!synthesis_candidates_source_item_id_fkey(
          id,
          title,
          source_email,
          source_url,
          newsletter_date
        )
      `)
      .eq('digest_id', digest.id)
      .order('originality_score', { ascending: false })

    if (error) {
      console.error('[SynthesisCandidates API] Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Transform to flat structure for the UI
    // Supabase returns a single object for FK joins, not an array
    type DailyRepoJoin = {
      id: string
      title: string
      source_email: string | null
      source_url: string | null
      newsletter_date: string
    } | null

    const items = (data || []).map(item => {
      const dailyRepo = item.daily_repo as unknown as DailyRepoJoin

      return {
        id: item.id,
        source_item_id: item.source_item_id,
        title: dailyRepo?.title || 'Unknown',
        source_email: dailyRepo?.source_email,
        source_url: dailyRepo?.source_url,
        newsletter_date: dailyRepo?.newsletter_date,
        originality_score: item.originality_score,
        relevance_score: item.relevance_score,
        synthesis_type: item.synthesis_type,
        reasoning: item.reasoning,
        created_at: item.created_at,
        digest_id: digest.id,
      }
    })

    return NextResponse.json({
      items,
      digest_id: digest.id,
      date
    })
  } catch (error) {
    console.error('[SynthesisCandidates API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
