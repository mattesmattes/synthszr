import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter, type AIModel } from '@/lib/claude/ghostwriter'
import { getSynthesesForDigest } from '@/lib/synthesis/pipeline'

const VALID_MODELS: AIModel[] = ['claude-opus-4', 'claude-sonnet-4', 'gemini-2.5-pro', 'gemini-3-pro-preview']

// Canonical URLs for newsletter sources that may not have direct article URLs
const NEWSLETTER_CANONICAL_URLS: Record<string, string> = {
  'techmeme': 'https://techmeme.com',
  'stratechery': 'https://stratechery.com',
  'ben evans': 'https://www.ben-evans.com',
  'benedict evans': 'https://www.ben-evans.com',
  'the information': 'https://www.theinformation.com',
  'axios': 'https://www.axios.com',
  'morning brew': 'https://www.morningbrew.com',
  'tldr': 'https://tldr.tech',
  'platformer': 'https://www.platformer.news',
  'the verge': 'https://www.theverge.com',
  'techcrunch': 'https://techcrunch.com',
  'wired': 'https://www.wired.com',
  'ars technica': 'https://arstechnica.com',
  'hacker news': 'https://news.ycombinator.com',
  // German sources
  'handelsblatt': 'https://www.handelsblatt.com',
  'morning briefing': 'https://www.handelsblatt.com/newsletter',
  'spiegel': 'https://www.spiegel.de',
  'faz': 'https://www.faz.net',
  'zeit': 'https://www.zeit.de',
  'heise': 'https://www.heise.de',
  't3n': 'https://t3n.de',
  'gruenderszene': 'https://www.businessinsider.de/gruenderszene',
  // More international sources
  'wsj': 'https://www.wsj.com',
  'wall street journal': 'https://www.wsj.com',
  'bloomberg': 'https://www.bloomberg.com',
  'medium': 'https://medium.com',
  // Note: No generic 'substack' - we extract specific newsletter URLs below
}

// Extract specific Substack newsletter URL from email
// e.g., "Machine Learning Pills <mlpills@substack.com>" → { name: "Machine Learning Pills", url: "https://mlpills.substack.com" }
function extractSubstackInfo(email: string | null): { name: string; url: string } | null {
  if (!email || !email.includes('@substack.com')) return null

  // Extract subdomain from email (before @substack.com)
  const subdomainMatch = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!subdomainMatch) return null

  // Clean subdomain (remove + variants like "getfivethings+tech")
  const subdomain = subdomainMatch[1].split('+')[0]

  // Extract newsletter name (before the < in email)
  const nameMatch = email.match(/^"?([^"<]+)/)
  const name = nameMatch?.[1]?.trim() || subdomain

  return {
    name,
    url: `https://${subdomain}.substack.com`
  }
}

export async function POST(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks on Vercel)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { digestId, promptId, vocabularyIntensity = 50, model: requestedModel } = body

    if (!digestId) {
      return new Response(JSON.stringify({ error: 'Digest ID erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate and default the model
    const model: AIModel = VALID_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-pro'
    console.log(`[Ghostwriter] Requested model: ${requestedModel}, using: ${model}`)

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

    // Get original sources for this digest
    // IMPORTANT: Use sources_used if available (matches what syntheses were created for)
    // Otherwise fall back to newsletter_date (legacy behavior)
    let sources: Array<{ title: string; source_url: string | null; source_email: string | null; source_type: string }> | null = null

    if (digest.sources_used && digest.sources_used.length > 0) {
      console.log(`[Ghostwriter] Using ${digest.sources_used.length} items from sources_used`)
      const { data } = await supabase
        .from('daily_repo')
        .select('title, source_url, source_email, source_type')
        .in('id', digest.sources_used)
      sources = data
    } else {
      console.log(`[Ghostwriter] Fallback: Loading items by newsletter_date`)
      const { data } = await supabase
        .from('daily_repo')
        .select('title, source_url, source_email, source_type')
        .eq('newsletter_date', digest.digest_date)
        .order('collected_at', { ascending: true })
      sources = data
    }

    // Build a source reference list for the ghostwriter
    // Use canonical URLs for known newsletters without direct article URLs
    let sourceReference = ''
    let diversityWarning = ''

    if (sources && sources.length > 0) {
      // Analyze source diversity by SPECIFIC newsletter (not platform)
      // Count by the specific sender email address
      const sourceCount: Record<string, number> = {}

      for (const s of sources) {
        if (s.source_email) {
          // Extract email address from format like "Newsletter Name <email@domain.com>"
          const emailMatch = s.source_email.match(/<([^>]+)>/)
          const sourceId = emailMatch ? emailMatch[1].toLowerCase() : s.source_email.toLowerCase().trim()
          sourceCount[sourceId] = (sourceCount[sourceId] || 0) + 1
        } else if (s.source_url) {
          // Fallback to URL domain for articles without email
          try {
            const domain = new URL(s.source_url).hostname.replace('www.', '')
            sourceCount[domain] = (sourceCount[domain] || 0) + 1
          } catch {
            // Invalid URL, skip
          }
        }
      }

      // Check if any SPECIFIC newsletter exceeds 30%
      const threshold = sources.length * 0.3
      const overrepresentedSources: string[] = []

      for (const [sourceId, count] of Object.entries(sourceCount)) {
        if (count > threshold) {
          overrepresentedSources.push(`${sourceId} (${count}/${sources.length} = ${Math.round(count/sources.length*100)}%)`)
        }
      }

      if (overrepresentedSources.length > 0) {
        diversityWarning = '\n\n---\n\n⚠️ **QUELLEN-DIVERSITÄT WARNUNG:**\n'
        diversityWarning += 'Folgende Quellen sind überrepräsentiert (>30%):\n'
        diversityWarning += overrepresentedSources.map(s => `- ${s}`).join('\n')
        diversityWarning += '\n\n**WICHTIG:** Achte darauf, dass im finalen Blog-Post keine Quelle mehr als 30% der News ausmacht. '
        diversityWarning += 'Priorisiere News aus unterrepräsentierten Quellen und kürze ggf. News aus überrepräsentierten Quellen.\n'
      }

      const sourcesWithUrls = sources.map(s => {
        // If source has a valid URL, use it
        if (s.source_url && s.source_url.startsWith('http')) {
          return { title: s.title, url: s.source_url, sourceName: null }
        }

        // First check for Substack (extract specific newsletter URL)
        const substackInfo = extractSubstackInfo(s.source_email)
        if (substackInfo) {
          return { title: s.title, url: substackInfo.url, sourceName: substackInfo.name }
        }

        // Otherwise, try to find a canonical URL based on title or email
        const titleLower = s.title?.toLowerCase() || ''
        const emailLower = s.source_email?.toLowerCase() || ''

        for (const [key, canonicalUrl] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
          if (titleLower.includes(key) || emailLower.includes(key)) {
            const sourceName = s.source_email?.split('<')[0].trim() || key
            return { title: s.title, url: canonicalUrl, sourceName }
          }
        }
        return null
      }).filter((s): s is { title: string; url: string; sourceName: string | null } => s !== null)

      if (sourcesWithUrls.length > 0) {
        sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN MIT LINKS (nutze NUR diese URLs):\n'
        sourceReference += sourcesWithUrls.map((s, i) => {
          const sourceInfo = s.sourceName ? ` [via: ${s.sourceName}]` : ''
          return `${i + 1}. [${s.title}](${s.url})${sourceInfo}`
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

    // Get developed syntheses for this digest (if available)
    let synthesisContext = ''
    try {
      const syntheses = await getSynthesesForDigest(digestId)
      if (syntheses && syntheses.length > 0) {
        synthesisContext = '\n\n---\n\n## HINTERGRUND-RECHERCHE FÜR "MATTES SYNTHESE"\n\n'
        synthesisContext += 'Für jeden Artikel wurde eine historische Verbindung recherchiert. '
        synthesisContext += 'Diese Recherche dient als HINTERGRUNDWISSEN für deinen "Mattes Synthese" Kommentar.\n\n'
        synthesisContext += '**WICHTIG:** Übernimm die Recherche NICHT wörtlich! Nutze sie stattdessen als Basis:\n'
        synthesisContext += '- Nimm die historische Verbindung zur Kenntnis\n'
        synthesisContext += '- Reflektiere die aktuelle News vor diesem Hintergrund\n'
        synthesisContext += '- Ordne die News in den größeren Kontext ein\n'
        synthesisContext += '- Formuliere deinen EIGENEN Kommentar im Ghostwriter-Stil\n\n'

        for (const synthesis of syntheses) {
          // Show which article this synthesis belongs to
          if (synthesis.sourceArticleTitle) {
            synthesisContext += `**ARTIKEL:** "${synthesis.sourceArticleTitle.slice(0, 80)}..."\n`
          }
          synthesisContext += `**Recherchierte Verbindung:** ${synthesis.headline}\n`
          synthesisContext += `**Kontext:** ${synthesis.content}\n`
          if (synthesis.historicalReference) {
            synthesisContext += `**Historischer Bezug:** ${synthesis.historicalReference}\n`
          }
          synthesisContext += '\n---\n\n'
        }

        synthesisContext += 'Schreibe zu jedem Artikel mit Recherche-Hintergrund einen "Mattes Synthese" Kommentar, '
        synthesisContext += 'der die aktuelle News im Licht der historischen Verbindung reflektiert und einordnet.'
      }
    } catch (error) {
      console.log('[Ghostwriter] No syntheses available (table may not exist yet)')
    }

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

    // Add explicit enforcement rules that appear at the end of the digest content
    // These are harder for the AI to ignore since they're the last thing it sees before generating
    const enforcementRules = `

---

## QUALITÄTS-CHECKLISTE (MUSS EINGEHALTEN WERDEN):

1. **NEWS-LÄNGE:** Jeder News-Artikel MUSS exakt 5-7 Sätze haben. Nicht 3, nicht 4. Mindestens 5, maximal 7 Sätze.
   - Satz 1-2: Was ist passiert?
   - Satz 3-4: Kontext und Bedeutung
   - Satz 5-7: Einordnung und weiterführender Gedanke

2. **MATTES SYNTHESE:** Jeder Kommentar MUSS auf der mitgelieferten Hintergrund-Recherche basieren.
   - Nimm Bezug auf die historische Verbindung
   - Zeige, dass du den größeren Kontext verstehst
   - Formuliere eine eigenständige These

3. **QUELLEN-DIVERSITÄT:** Keine Quelle darf >30% der News ausmachen.

**WICHTIG:** Diese Regeln haben Priorität. Halte dich strikt daran.
`

    // Combine digest content with source reference, syntheses, and enforcement rules
    const fullDigestContent = digest.analysis_content + diversityWarning + sourceReference + synthesisContext + enforcementRules

    // Stream the response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial event with model info
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model, started: true })}\n\n`))

          for await (const chunk of streamGhostwriter(fullDigestContent, fullPrompt, model)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, model })}\n\n`))
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
