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

    // Build content string - use full content (no truncation for comprehensive analysis)
    // Format source URLs as markdown links so Claude can reference them properly
    const contentParts = items.map((item, i) => {
      let sourceDisplay: string
      if (item.source_url) {
        // Create markdown link for articles with URLs
        try {
          const linkText = item.source_email || new URL(item.source_url).hostname
          sourceDisplay = `[${linkText}](${item.source_url})`
        } catch {
          // Fallback if URL parsing fails
          sourceDisplay = `[Link](${item.source_url})`
        }
      } else {
        sourceDisplay = item.source_email || 'Unbekannte Quelle'
      }
      return `## ${i + 1}. ${item.title}\n**Quelle:** ${sourceDisplay} (${item.source_type})\n\n${item.content || 'Kein Inhalt'}\n\n---`
    })
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
