import { verifyBearerToken } from '@/lib/security/cron-auth'
/**
 * Queue-based Ghostwriter API
 * Generates articles from news queue items instead of digests.
 *
 * Thin SSE wrapper around generateQueueArticle() — the canonical selection +
 * pipeline + dedup orchestration lives in lib/claude/queue-article.ts so the
 * scheduled cron auto-post can run the exact same logic in-process (without an
 * HTTP subrequest, which fails from the cron's host).
 */

export const maxDuration = 800 // 13 minutes — pipeline: planning + parallel section writing + proofreading + dedup

import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { generateQueueArticle } from '@/lib/claude/queue-article'

export async function POST(request: NextRequest) {
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = verifyBearerToken(authHeader, process.env.CRON_SECRET)

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // Empty/invalid body → fall back to defaults (useSelected etc.)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        for await (const event of generateQueueArticle(body)) {
          send(event)
        }
      } catch (error) {
        console.error('[Ghostwriter-Queue] Error:', error)
        send({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
