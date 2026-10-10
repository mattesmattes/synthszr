import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSession } from '@/lib/auth/session'
import { withUsageLogging } from '@/lib/ai/usage-log'

export const runtime = 'nodejs'

/**
 * POST /api/podcast/translate-metadata
 * Translates German blog post title + excerpt to English podcast-style metadata.
 *
 * Body: { title: string, excerpt: string, script?: string }
 * Returns: { title: string, subtitle: string, description: string }
 *          oder 502 { error } — nie still die deutschen Werte.
 *
 * PROD-BEFUND 2026-10-10: Kein Assistant-Prefill („{") mehr. claude-haiku-5-5
 * (seit 2026-10-08 für podcast_metadata_translation eingestellt) lehnt Prefill
 * mit 400 ab; der catch-Zweig gab dann still den deutschen Titel zurück, und die
 * Podigee-Export-Seite zeigte Titel und Show Notes auf Deutsch. Deshalb liest
 * extractJsonObject das JSON aus der freien Antwort, und ein Fehler wird als
 * 502 gemeldet, damit die Seite ihn sichtbar macht.
 */

/** Erstes {...}-Objekt aus einer Modellantwort (Code-Fences und Vorrede egal). */
function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Keine JSON-Antwort des Modells')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}
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
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = withUsageLogging(new Anthropic(), 'podcast_metadata_translation')
    const model = await getModelForUseCase('podcast_metadata_translation')

    const message = await client.messages.create({
      model,
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
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    console.log('[Translate Metadata] Raw response:', text.slice(0, 300))

    const parsed = extractJsonObject(text)
    const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
    if (!str(parsed.title)) throw new Error('Modellantwort ohne englischen Titel')

    return NextResponse.json({
      title: str(parsed.title),
      subtitle: str(parsed.subtitle),
      description: str(parsed.description),
    })
  } catch (error) {
    console.error('[Translate Metadata] Error:', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Englische Übersetzung fehlgeschlagen: ${detail}` }, { status: 502 })
  }
}
