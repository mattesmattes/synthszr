import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter } from '@/lib/claude/ghostwriter'

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
    const { digestId, promptId, vocabularyIntensity = 50 } = body

    if (!digestId) {
      return new Response(JSON.stringify({ error: 'Digest ID erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = await createClient()

    // Get the digest content
    const { data: digest, error: digestError } = await supabase
      .from('daily_digests')
      .select('*')
      .eq('id', digestId)
      .single()

    if (digestError || !digest) {
      return new Response(JSON.stringify({ error: 'Digest nicht gefunden' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get original sources for this digest's date to ensure links are available
    const { data: sources } = await supabase
      .from('daily_repo')
      .select('title, source_url, source_email, source_type')
      .eq('newsletter_date', digest.digest_date)
      .order('collected_at', { ascending: true })

    // Build a source reference list for the ghostwriter - ONLY include sources with valid URLs
    // This prevents the AI from creating broken links using email addresses
    let sourceReference = ''
    if (sources && sources.length > 0) {
      const sourcesWithUrls = sources.filter(s => s.source_url && s.source_url.startsWith('http'))
      if (sourcesWithUrls.length > 0) {
        sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN MIT LINKS (nutze NUR diese URLs):\n'
        sourceReference += sourcesWithUrls.map((s, i) => {
          return `${i + 1}. [${s.title}](${s.source_url})`
        }).join('\n')
      }
    }

    // Get the ghostwriter prompt
    let promptText: string
    if (promptId) {
      const { data: prompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('id', promptId)
        .single()
      promptText = prompt?.prompt_text || ''
    } else {
      // Get active prompt
      const { data: activePrompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('is_active', true)
        .single()
      promptText = activePrompt?.prompt_text || getDefaultGhostwriterPrompt()
    }

    // Get vocabulary dictionary
    const { data: vocabulary } = await supabase
      .from('vocabulary_dictionary')
      .select('term, preferred_usage, avoid_alternatives, context')
      .order('category')

    // Build vocabulary context based on intensity (0-100)
    let vocabularyContext = ''
    if (vocabulary && vocabulary.length > 0 && vocabularyIntensity > 0) {
      const intensity = Math.min(100, Math.max(0, vocabularyIntensity))

      // Determine intensity instructions
      let intensityInstruction = ''
      if (intensity <= 25) {
        intensityInstruction = 'Nutze diese Begriffe nur gelegentlich und wenn sie natürlich passen.'
      } else if (intensity <= 50) {
        intensityInstruction = 'Nutze diese Begriffe moderat und achte auf einen natürlichen Lesefluss.'
      } else if (intensity <= 75) {
        intensityInstruction = 'Nutze diese Begriffe aktiv und baue sie bewusst in den Text ein.'
      } else {
        intensityInstruction = 'Nutze diese Begriffe intensiv und durchgängig im gesamten Text. Jeder Absatz sollte mindestens einen Begriff enthalten.'
      }

      vocabularyContext = `\n\nVOKABULAR-RICHTLINIEN (Intensität: ${intensity}%):\n${intensityInstruction}\n\nBegriffe:\n`
      vocabularyContext += vocabulary.map(v => {
        let entry = `- "${v.term}"`
        if (v.preferred_usage) entry += `: ${v.preferred_usage}`
        if (v.avoid_alternatives) entry += ` | Vermeide: ${v.avoid_alternatives}`
        if (v.context) entry += ` (${v.context})`
        return entry
      }).join('\n')
    }

    // Combine prompt with vocabulary
    const fullPrompt = promptText + vocabularyContext

    // Combine digest content with source reference
    const fullDigestContent = digest.analysis_content + sourceReference

    // Stream the response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamGhostwriter(fullDigestContent, fullPrompt)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' })}\n\n`
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
    console.error('Ghostwriter error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function getDefaultGhostwriterPrompt(): string {
  return `Du bist ein erfahrener Tech-Blogger und schreibst für den Synthzr Newsletter.

STIL UND TONALITÄT:
- Schreibe in einem persönlichen, aber professionellen Ton
- Nutze aktive Sprache und direkte Ansprache
- Vermeide Buzzwords und leere Phrasen
- Sei konkret und praxisorientiert

STRUKTUR:
- Beginne mit einem fesselnden Hook
- Gliedere den Artikel in klare Abschnitte
- Nutze Zwischenüberschriften für bessere Lesbarkeit
- Schließe mit einem Call-to-Action oder Ausblick

FORMAT:
- Schreibe auf Deutsch
- Nutze Markdown für Formatierung
- Ziel: 800-1200 Wörter`
}
