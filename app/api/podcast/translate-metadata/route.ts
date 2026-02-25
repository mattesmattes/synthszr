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
  const { title, excerpt } = body as { title: string; excerpt: string }

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  try {
    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Translate the following German podcast episode metadata to English. Keep it engaging and podcast-friendly.
Return only valid JSON with keys "title", "subtitle", and "description". No markdown, no explanation.
- title: short, punchy episode title (max 80 chars)
- subtitle: one-line teaser (max 120 chars)
- description: 2-3 sentence episode show notes describing the content

Title: ${title}
Excerpt: ${excerpt || title}`,
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const parsed = JSON.parse(text.trim())

    return NextResponse.json({
      title: parsed.title || title,
      subtitle: parsed.subtitle || '',
      description: parsed.description || excerpt || '',
    })
  } catch (error) {
    console.error('[Translate Metadata] Error:', error)
    // Fallback: return original values
    return NextResponse.json({
      title,
      subtitle: excerpt || '',
      description: excerpt || '',
    })
  }
}
