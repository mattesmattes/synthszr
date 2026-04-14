import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { prepareAnalysisInput, streamAnalysis } from '@/lib/analysis/processor'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function POST(request: NextRequest) {
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { date, promptId } = body

    const supabase = cronSecretValid ? createAdminClient() : await createClient()
    // prepareAnalysisInput uses admin-level reads (analysis_prompts, daily_repo).
    // For user sessions this still works because RLS allows reads for these tables;
    // if that ever changes, switch to createAdminClient() unconditionally.
    const prepared = await prepareAnalysisInput(
      supabase as unknown as ReturnType<typeof createAdminClient>,
      date,
      promptId
    )

    if (!prepared.ok) {
      return new Response(JSON.stringify({ error: prepared.error }), {
        status: prepared.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { fullContent, processedItemIds, promptText } = prepared.data

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'sources',
            itemIds: processedItemIds,
          })}\n\n`))

          for await (const chunk of streamAnalysis(fullContent, promptText)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Analyse fehlgeschlagen' })}\n\n`
            )
          )
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Analyse fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
