import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import OpenAI from 'openai'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { sections } = await request.json()

    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      return new Response(JSON.stringify({ error: 'Keine Abschnitte übergeben' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build prompt with first 3 article sections
    const articleSections = sections.slice(0, 3).map((s: { heading: string; text: string }, i: number) =>
      `Artikel ${i + 1}: "${s.heading}"\n${s.text.slice(0, 500)}`
    ).join('\n\n')

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Du generierst exakt 3 Bullet Points für einen Blog-Excerpt.
Jeder Bullet fasst einen Artikel pointiert und journalistisch zusammen.
REGELN:
- Exakt 3 Bullets, einer pro Artikel
- Jeder Bullet: 55-70 Zeichen (NICHT länger!)
- Beginne jeden Bullet mit •
- Kein Doppelpunkt nach dem •
- Pointiert, keine langweiligen Zusammenfassungen
- Deutsch
- Keine Anführungszeichen
Antworte NUR mit den 3 Bullets, nichts sonst.`
        },
        {
          role: 'user',
          content: articleSections
        }
      ],
      max_completion_tokens: 200,
    })

    const result = response.choices[0]?.message?.content?.trim() || ''

    return new Response(JSON.stringify({ excerpt: result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[generate-excerpt] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Excerpt-Generierung fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
