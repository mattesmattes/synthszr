import { NextRequest } from 'next/server'
import { isAdminRequest } from '@/lib/auth/session'
import { runNewsletterFetch, runArticleExtraction, FetchProgress, ArticleToExtract } from '@/lib/newsletter/fetcher'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes per request — frontend sends multiple batched requests

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let body: {
    targetDate?: string
    force?: boolean
    hoursBack?: number
    mode?: 'scan' | 'extract'
    articles?: ArticleToExtract[]
    fetchDate?: string
    globalOffset?: number
    globalTotal?: number
  } = {}

  try {
    body = await request.json()
  } catch {
    // No body - use defaults
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: FetchProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      if (body.mode === 'extract') {
        // Extract mode: process a batch of article URLs
        if (!body.articles || body.articles.length === 0) {
          send({ type: 'complete', phase: 'done', summary: { newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 } })
        } else {
          await runArticleExtraction({
            articles: body.articles,
            fetchDate: body.fetchDate || new Date().toISOString().split('T')[0],
            force: body.force,
            globalOffset: body.globalOffset || 0,
            globalTotal: body.globalTotal || body.articles.length,
            onProgress: send,
          })
        }
      } else {
        // Scan mode (default): fetch emails, parse newsletters, return article URLs
        await runNewsletterFetch({
          targetDate: body.targetDate,
          force: body.force,
          hoursBack: body.hoursBack,
          scanOnly: body.mode === 'scan',
          onProgress: send,
        })
      }

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
