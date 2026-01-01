import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamAnalysis } from '@/lib/claude/client'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { date, promptId } = body

    const supabase = await createClient()

    // Get the prompt
    let promptText: string
    if (promptId) {
      const { data: prompt } = await supabase
        .from('analysis_prompts')
        .select('prompt_text')
        .eq('id', promptId)
        .single()
      promptText = prompt?.prompt_text || ''
    } else {
      // Get active prompt
      const { data: activePrompt } = await supabase
        .from('analysis_prompts')
        .select('prompt_text')
        .eq('is_active', true)
        .single()
      promptText = activePrompt?.prompt_text || getDefaultPrompt()
    }

    // Get content for the selected date (all items with this newsletter_date)
    const targetDate = date || new Date().toISOString().split('T')[0]

    const { data: items } = await supabase
      .from('daily_repo')
      .select('id, title, content, source_type, source_email, source_url, collected_at')
      .eq('newsletter_date', targetDate)
      .order('collected_at', { ascending: false })

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Keine Inhalte für dieses Datum gefunden' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build content string with token limit awareness
    // Claude limit: 200k tokens ≈ ~600k characters
    // Limit each item to 10k chars, and total to ~500k chars to leave room for prompt
    const MAX_CHARS_PER_ITEM = 10000
    const MAX_TOTAL_CHARS = 500000

    const contentParts: string[] = []
    let totalChars = 0

    for (let i = 0; i < items.length && totalChars < MAX_TOTAL_CHARS; i++) {
      const item = items[i]
      let sourceDisplay: string

      if (item.source_url && item.source_url.startsWith('http')) {
        try {
          const linkText = new URL(item.source_url).hostname.replace('www.', '')
          sourceDisplay = `[${linkText}](${item.source_url})`
        } catch {
          sourceDisplay = `[Link](${item.source_url})`
        }
      } else {
        sourceDisplay = `${item.source_email || 'Newsletter'} (kein direkter Link verfügbar)`
      }

      // Truncate content if too long
      const content = (item.content || 'Kein Inhalt').slice(0, MAX_CHARS_PER_ITEM)
      const truncated = item.content && item.content.length > MAX_CHARS_PER_ITEM ? ' [...]' : ''

      const part = `## ${i + 1}. ${item.title}\n**Quelle:** ${sourceDisplay} (${item.source_type})\n\n${content}${truncated}\n\n---`

      if (totalChars + part.length > MAX_TOTAL_CHARS) {
        console.log(`[Analyze] Stopping at ${i} items due to size limit (${totalChars} chars)`)
        break
      }

      contentParts.push(part)
      totalChars += part.length
    }

    console.log(`[Analyze] Processing ${contentParts.length}/${items.length} items, ${totalChars} chars`)
    const fullContent = contentParts.join('\n\n')

    // Stream the response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
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

function getDefaultPrompt(): string {
  return `ZIEL: Erstelle eine AUSFÜHRLICHE MATERIALSAMMLUNG für meinen Synthzr Newsletter.

KERNTHESE: AI macht nicht alles effizienter – die Synthese aus Marketing, Design, Business und Code führt zu völlig neuen Produkten/Services und verändert die Wertschöpfung von IT- und Agenturdienstleistern komplett.

WICHTIG - DAS IST KEINE ZUSAMMENFASSUNG:
- Extrahiere die VOLLSTÄNDIGEN relevanten Passagen und Zitate aus jeder Quelle
- Behalte die Originalformulierungen bei (übersetze nur falls nicht auf Deutsch)
- JEDE erwähnte Information MUSS mit dem Quelllink versehen sein
- Längere Abschnitte sind ERWÜNSCHT - das ist Rohmaterial für späteren Blogpost

FORMAT FÜR JEDE QUELLE:
## [Titel der Quelle](URL)
**Kernaussagen:**
- [Vollständiges Zitat oder Passage mit Kontext]
- [Weitere relevante Passage]

**Originalzitate:**
> "Direktes Zitat aus der Quelle" – [Quelle](URL)

**Relevanz für Synthese-These:**
[Warum ist das für die Kernthese interessant?]

---

Ignoriere unwichtige oder themenfremde Inhalte, aber bei relevanten Quellen: MEHR IST BESSER.`
}
