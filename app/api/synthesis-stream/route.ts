import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { runSynthesisPipelineWithProgress } from '@/lib/synthesis/pipeline'

export const maxDuration = 300 // Allow up to 5 minutes for synthesis

/**
 * POST /api/synthesis-stream
 * Trigger synthesis pipeline with SSE streaming for progress updates
 */
export async function POST(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { digestId, options } = body

    if (!digestId) {
      return new Response(JSON.stringify({ error: 'digestId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`[API] Starting streaming synthesis pipeline for digest ${digestId}`)

    // Create a readable stream for SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        // Send keep-alive every 10 seconds to prevent Vercel timeout
        const keepAliveInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`))
          } catch {
            // Stream might be closed
          }
        }, 10000)

        try {
          await runSynthesisPipelineWithProgress(
            digestId,
            {
              maxItemsToProcess: options?.maxItems || 20, // Limited to 20 to stay under Vercel 5min timeout
              maxCandidatesPerItem: options?.maxCandidates || 5,
              minSimilarity: options?.minSimilarity || 0.65,
              maxAgeDays: options?.maxAge || 90,
            },
            // Progress callback
            (progress) => {
              sendEvent(progress)
            }
          )

          sendEvent({ type: 'complete' })
        } catch (error) {
          console.error('[API] Synthesis stream error:', error)
          sendEvent({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        } finally {
          clearInterval(keepAliveInterval)
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[API] Synthesis stream error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
