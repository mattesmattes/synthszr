import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamAnalysis } from '@/lib/claude/client'

// Canonical URLs for newsletter sources that may not have direct article URLs
const NEWSLETTER_CANONICAL_URLS: Record<string, string> = {
  'techmeme': 'https://techmeme.com',
  'stratechery': 'https://stratechery.com',
  'ben evans': 'https://www.ben-evans.com',
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
  'handelsblatt': 'https://www.handelsblatt.com',
  'morning briefing': 'https://www.handelsblatt.com/newsletter',
  'spiegel': 'https://www.spiegel.de',
  'faz': 'https://www.faz.net',
  'zeit': 'https://www.zeit.de',
  'heise': 'https://www.heise.de',
  't3n': 'https://t3n.de',
  'wsj': 'https://www.wsj.com',
  'wall street journal': 'https://www.wsj.com',
  'bloomberg': 'https://www.bloomberg.com',
  'medium': 'https://medium.com',
  'substack': 'https://substack.com',
}

// Find a canonical URL for a source based on title or email
function findCanonicalUrl(title: string, email: string | null): string | null {
  const searchText = `${title} ${email || ''}`.toLowerCase()
  for (const [key, url] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
    if (searchText.includes(key)) {
      return url
    }
  }
  return null
}

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

    const { data: rawItems } = await supabase
      .from('daily_repo')
      .select('id, title, content, source_type, source_email, source_url, collected_at')
      .eq('newsletter_date', targetDate)
      .order('collected_at', { ascending: false })

    if (!rawItems || rawItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Keine Inhalte für dieses Datum gefunden' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ENFORCE 30% MAX SOURCE DIVERSITY
    // Group items by source domain
    const getSourceDomain = (item: typeof rawItems[0]): string => {
      if (item.source_url) {
        try {
          return new URL(item.source_url).hostname.replace('www.', '')
        } catch {}
      }
      if (item.source_email) {
        const match = item.source_email.match(/@([^>]+)/)
        if (match) return match[1]
      }
      return 'unknown'
    }

    const itemsBySource = new Map<string, typeof rawItems>()
    for (const item of rawItems) {
      const domain = getSourceDomain(item)
      if (!itemsBySource.has(domain)) {
        itemsBySource.set(domain, [])
      }
      itemsBySource.get(domain)!.push(item)
    }

    // Calculate max items per source (30% of total, minimum 2)
    const maxPerSource = Math.max(2, Math.floor(rawItems.length * 0.3))
    console.log(`[Analyze] Source diversity: max ${maxPerSource} items per source (30% of ${rawItems.length})`)

    // Filter items to enforce diversity
    const diverseItems: typeof rawItems = []
    const sourceStats: Record<string, { total: number; used: number }> = {}

    for (const [domain, domainItems] of itemsBySource) {
      sourceStats[domain] = { total: domainItems.length, used: 0 }

      // Take up to maxPerSource items from this source
      const itemsToUse = domainItems.slice(0, maxPerSource)
      diverseItems.push(...itemsToUse)
      sourceStats[domain].used = itemsToUse.length

      if (domainItems.length > maxPerSource) {
        console.log(`[Analyze] LIMITED ${domain}: ${domainItems.length} → ${maxPerSource} items`)
      }
    }

    // Shuffle to mix sources (don't have all items from one source together)
    const items = diverseItems.sort(() => Math.random() - 0.5)

    console.log(`[Analyze] After diversity filter: ${items.length} items (from ${rawItems.length})`)
    console.log(`[Analyze] Source distribution:`, Object.entries(sourceStats)
      .map(([d, s]) => `${d}: ${s.used}/${s.total}`)
      .join(', '))

    // Build content string with token limit awareness
    // Gemini has 1M+ token context, but we still limit for reasonable processing
    // Limit each item to 20k chars, and total to ~2M chars
    const MAX_CHARS_PER_ITEM = 20000
    const MAX_TOTAL_CHARS = 2000000

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
        // Try to find a canonical URL for known sources
        const canonicalUrl = findCanonicalUrl(item.title, item.source_email)
        if (canonicalUrl) {
          const sourceName = item.source_email?.split('<')[0].trim() || 'Newsletter'
          sourceDisplay = `[${sourceName}](${canonicalUrl})`
        } else {
          sourceDisplay = `${item.source_email || 'Newsletter'} (kein direkter Link verfügbar)`
        }
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

    // Track which items are actually being processed
    const processedItemIds = items.slice(0, contentParts.length).map(item => item.id)
    console.log(`[Analyze] Processing ${contentParts.length}/${items.length} items, ${totalChars} chars`)
    console.log(`[Analyze] Item IDs being processed: ${processedItemIds.join(', ')}`)
    const fullContent = contentParts.join('\n\n')

    // Stream the response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // FIRST: Send the item IDs so the client knows which items are in this digest
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'sources',
            itemIds: processedItemIds
          })}\n\n`))

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
