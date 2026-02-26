import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * POST /api/podcast/translate-metadata
 * Translates German blog post title + excerpt to English podcast-style metadata.
 *
 * Body: { title: string, excerpt: string }
 * Returns: { title: string, subtitle: string }
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json()
  const { title, excerpt, script } = body as { title: string; excerpt: string; script?: string }

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // Use the first ~1500 chars of the script for description context
  const scriptContext = script ? script.slice(0, 1500) : null

  try {
    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Translate the following German podcast episode metadata to English. Keep it engaging and podcast-friendly.
Respond with ONLY a raw JSON object (no markdown, no code fences, no explanation):
{"title":"...","subtitle":"...","description":"..."}

Rules:
- title: short punchy episode title (max 80 chars)
- subtitle: one-line teaser (max 120 chars)
- description: exactly 2 engaging English sentences for show notes${scriptContext ? ' — base it on the script excerpt below' : ''}

German title: ${title}
German excerpt: ${excerpt || title}${scriptContext ? `\nScript excerpt (first part): ${scriptContext}` : ''}`,
        },
        {
          role: 'assistant',
          content: '{',
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    // Prepend the '{' we used as assistant prefix to complete the JSON
    const raw = ('{' + text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    console.log('[Translate Metadata] Raw response:', raw.slice(0, 300))

    const parsed = JSON.parse(raw)

    return NextResponse.json({
      title: parsed.title || title,
      subtitle: parsed.subtitle || '',
      description: parsed.description || '',
    })
  } catch (error) {
    console.error('[Translate Metadata] Error:', error)
    // Fallback: return original values
    return NextResponse.json({
      title,
      subtitle: '',
      description: '',
    })
  }
}
