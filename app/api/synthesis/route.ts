import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { runSynthesisPipeline } from '@/lib/synthesis/pipeline'

export const maxDuration = 300 // Allow up to 5 minutes for synthesis

/**
 * POST /api/synthesis
 * Trigger synthesis pipeline for a digest
 */
export async function POST(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { digestId, options } = body

    if (!digestId) {
      return NextResponse.json(
        { error: 'digestId is required' },
        { status: 400 }
      )
    }

    console.log(`[API] Starting synthesis pipeline for digest ${digestId}`)

    // Pipeline now creates exactly 1 synthesis per article
    const result = await runSynthesisPipeline(digestId, {
      maxItemsToProcess: options?.maxItems || 50,
      maxCandidatesPerItem: options?.maxCandidates || 5,
      minSimilarity: options?.minSimilarity || 0.5,
      maxAgeDays: options?.maxAge || 90,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] Synthesis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET handler removed — developed_syntheses table is dropped.
