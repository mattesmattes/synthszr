import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createRankingJob, advanceRankingJob, getRankingExtractStatus } from '@/lib/rankings/jobs'

// Jeder advance-Call verarbeitet einen Batch bis ~135s (unter dem 300s-Limit).
// Der Browser treibt den Lauf per Polling von ?advance, bis status === 'done'.
export const maxDuration = 300

/** GET → Status (jüngster Daily-Job inkl. spend_tokens, Fenster-Fortschritt, Counts). */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  return NextResponse.json(await getRankingExtractStatus())
}

/**
 * POST            → tägl. Ranking-Job anlegen (idempotent), returns { created, reason? }
 * POST ?advance=1 → einen Batch weiter, returns { result, ...status }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const isAdvance = request.nextUrl.searchParams.get('advance') !== null
  if (isAdvance) {
    const result = await advanceRankingJob()
    const status = await getRankingExtractStatus()
    return NextResponse.json({ result, ...status })
  }

  const created = await createRankingJob({ mode: 'daily' })
  const status = await getRankingExtractStatus()
  return NextResponse.json({ ...created, ...status })
}
