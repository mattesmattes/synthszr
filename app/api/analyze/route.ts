import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { streamAnalysis } from '@/lib/claude/client'

export const runtime = 'nodejs'
export const maxDuration = 800 // 13 minutes — allows gemini-2.5-flash to process large repos

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
  // Note: No generic 'substack' - we extract specific newsletter URLs
}

// Extract specific Substack newsletter URL from email
// e.g., "Machine Learning Pills <mlpills@substack.com>" → { name: "Machine Learning Pills", url: "https://mlpills.substack.com" }
function extractSubstackInfo(email: string | null): { name: string; url: string } | null {
  if (!email || !email.includes('@substack.com')) return null

  // Extract subdomain from email (before @substack.com)
  const subdomainMatch = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!subdomainMatch) return null

  // Clean subdomain (remove + variants like "getfivethings+tech")
  let subdomain = subdomainMatch[1].split('+')[0]

  // Extract newsletter name (before the < in email)
  const nameMatch = email.match(/^"?([^"<]+)/);
  const name = nameMatch?.[1]?.trim() || subdomain

  return {
    name,
    url: `https://${subdomain}.substack.com`
  }
}

// Find a canonical URL for a source based on title or email
function findCanonicalUrl(title: string, email: string | null): { name: string; url: string } | null {
  // First check for Substack (extract specific newsletter URL)
  const substackInfo = extractSubstackInfo(email)
  if (substackInfo) return substackInfo

  // Then check canonical URLs
  const searchText = `${title} ${email || ''}`.toLowerCase()
  for (const [key, url] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
    if (searchText.includes(key)) {
      const name = email?.split('<')[0].trim() || key
      return { name, url }
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { date, promptId } = body

    // Use admin client for cron requests (no session, cronSecretValid=true), regular client for user requests
    const supabase = cronSecretValid ? createAdminClient() : await createClient()

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

    // PRE-FILTER: Remove garbage items before sending to Gemini
    // These waste token budget and cause the model to produce shorter output.
    // Pattern-based: newsletter footers, tracking pixels, ads, DSGVO notices
    const GARBAGE_TITLE_PATTERNS = [
      /^hidden tracker/i,
      /referral hub/i,
      /\| subscribe$/i,
      /^subscribe$/i,
      /privacy choices/i,
      /^unsubscribe/i,
      /view (in|this) (browser|email)/i,
      /^(marketing brew|tech brew|tldr \w+|morning brew)\s*[\|–]\s*(subscribe|weekly|daily|referral)/i,
      /^your (free |privacy |cookie )/i,
      /^(faq|help center)\s*[\|–]/i,
    ]
    const MIN_CONTENT_LENGTH = 120  // Tracking pixels and empty items are < 120 chars

    const filteredItems = rawItems.filter(item => {
      // Remove items with no meaningful content
      if (!item.content || item.content.length < MIN_CONTENT_LENGTH) return false
      // Remove items whose title matches known garbage patterns
      const title = item.title || ''
      if (GARBAGE_TITLE_PATTERNS.some(p => p.test(title))) return false
      return true
    })

    console.log(`[Analyze] Garbage filter: ${rawItems.length} → ${filteredItems.length} items (removed ${rawItems.length - filteredItems.length} garbage items)`)

    if (filteredItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Keine relevanten Inhalte nach Filterung gefunden' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ENFORCE 30% MAX SOURCE DIVERSITY
    // Group items by SPECIFIC newsletter (not platform)
    // e.g., "Machine Learning Pills" and "Lenny's Newsletter" are separate sources,
    // even though both are on Substack
    const getSourceIdentifier = (item: typeof rawItems[0]): string => {
      // Primary: Use the specific sender email as unique identifier
      // This correctly separates different Substack newsletters
      if (item.source_email) {
        // Extract email address from format like "Newsletter Name <email@domain.com>"
        const emailMatch = item.source_email.match(/<([^>]+)>/)
        if (emailMatch) return emailMatch[1].toLowerCase()
        // Or use the whole string if no angle brackets
        return item.source_email.toLowerCase().trim()
      }
      // Fallback: Use URL domain for articles without email source
      if (item.source_url) {
        try {
          return new URL(item.source_url).hostname.replace('www.', '')
        } catch {}
      }
      return 'unknown'
    }

    const itemsBySource = new Map<string, typeof rawItems>()
    for (const item of filteredItems) {
      const sourceId = getSourceIdentifier(item)
      if (!itemsBySource.has(sourceId)) {
        itemsBySource.set(sourceId, [])
      }
      itemsBySource.get(sourceId)!.push(item)
    }

    // Calculate max items per source (30% of total, minimum 2)
    const maxPerSource = Math.max(2, Math.floor(filteredItems.length * 0.3))
    console.log(`[Analyze] Source diversity: max ${maxPerSource} items per source (30% of ${filteredItems.length})`)

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

    console.log(`[Analyze] After diversity filter: ${items.length} items (from ${filteredItems.length} filtered, ${rawItems.length} total)`)
    console.log(`[Analyze] Source distribution:`, Object.entries(sourceStats)
      .map(([d, s]) => `${d}: ${s.used}/${s.total}`)
      .join(', '))

    // Build content string with token limit awareness
    // Limit per item and total to stay within Vercel's 5-min function timeout
    // gemini-2.0-flash handles ~600k chars comfortably within limits
    const MAX_CHARS_PER_ITEM = 10000
    const MAX_TOTAL_CHARS = 600000

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
        // Try to find a canonical URL for known sources (including specific Substack newsletters)
        const sourceInfo = findCanonicalUrl(item.title, item.source_email)
        if (sourceInfo) {
          sourceDisplay = `[${sourceInfo.name}](${sourceInfo.url})`
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
