import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getModelForUseCase } from '@/lib/ai/model-config'
import {
  createManualArticleJob,
  advanceArticleJob,
  getArticleJobStatus,
} from '@/lib/article-jobs/service'

// Each call advances the job by exactly ONE phase; writeSectionsBatch caps itself
// at 210s, so a single phase stays well under the 300s Vercel-Pro function limit.
// The browser drives the job by polling ?advance until status === 'done'.
export const maxDuration = 300

/**
 * POST            → create a manual article job, returns { jobId, itemCount }
 * POST ?advance=1 → advance { jobId } by one phase, returns the polled status
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const isAdvance = request.nextUrl.searchParams.get('advance') !== null

  if (isAdvance) {
    const jobId = body.jobId as string | undefined
    if (!jobId) return NextResponse.json({ error: 'jobId fehlt' }, { status: 400 })
    await advanceArticleJob(jobId)
    const status = await getArticleJobStatus(jobId)
    if (!status) return NextResponse.json({ error: 'Job nicht gefunden' }, { status: 404 })
    return NextResponse.json(status)
  }

  const model = await getModelForUseCase('ghostwriter')
  const result = await createManualArticleJob({
    queueItemIds: body.queueItemIds,
    useSelected: body.useSelected ?? true,
    maxItems: body.maxItems ?? 25,
    vocabularyIntensity: body.vocabularyIntensity ?? 50,
    model,
    effort: body.effort ?? 'high',
  })
  if ('error' in result) {
    const msg = result.error === 'no_items'
      ? 'Keine Items in der Queue. Bitte zuerst Items auswählen oder die Synthese-Pipeline ausführen.'
      : result.error
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json(result)
}
