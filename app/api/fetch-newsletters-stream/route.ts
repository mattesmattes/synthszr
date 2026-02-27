import { NextRequest } from 'next/server'
import { isAdminRequest } from '@/lib/auth/session'
import { runNewsletterFetch, FetchProgress } from '@/lib/newsletter/fetcher'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let targetDate: string | undefined
  let force = false
  let hoursBack: number | undefined
  try {
    const body = await request.json()
    targetDate = body.targetDate
    force = body.force === true
    if (typeof body.hoursBack === 'number' && body.hoursBack > 0) {
      hoursBack = body.hoursBack
    }
  } catch {
    // No body - use defaults
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: FetchProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      await runNewsletterFetch({ targetDate, force, hoursBack, onProgress: send })
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
