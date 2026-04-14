import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeContent, streamAnalysis } from '@/lib/claude/client'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

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
}

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

const MIN_CONTENT_LENGTH = 120
const MAX_TOTAL_CHARS = 2000000

function extractSubstackInfo(email: string | null): { name: string; url: string } | null {
  if (!email || !email.includes('@substack.com')) return null
  const subdomainMatch = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!subdomainMatch) return null
  const subdomain = subdomainMatch[1].split('+')[0]
  const nameMatch = email.match(/^"?([^"<]+)/)
  const name = nameMatch?.[1]?.trim() || subdomain
  return { name, url: `https://${subdomain}.substack.com` }
}

function findCanonicalUrl(title: string, email: string | null): { name: string; url: string } | null {
  const substackInfo = extractSubstackInfo(email)
  if (substackInfo) return substackInfo
  const searchText = `${title} ${email || ''}`.toLowerCase()
  for (const [key, url] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
    if (searchText.includes(key)) {
      const name = email?.split('<')[0].trim() || key
      return { name, url }
    }
  }
  return null
}

export interface PreparedAnalysisInput {
  fullContent: string
  processedItemIds: string[]
  promptText: string
}

export type PreparedAnalysisResult =
  | { ok: true; data: PreparedAnalysisInput }
  | { ok: false; status: number; error: string }

export async function prepareAnalysisInput(
  supabase: SupabaseAdminClient,
  date: string | undefined,
  promptId: string | undefined
): Promise<PreparedAnalysisResult> {
  let promptText: string
  if (promptId) {
    const { data: prompt } = await supabase
      .from('analysis_prompts')
      .select('prompt_text')
      .eq('id', promptId)
      .single()
    promptText = prompt?.prompt_text || ''
  } else {
    const { data: activePrompt } = await supabase
      .from('analysis_prompts')
      .select('prompt_text')
      .eq('is_active', true)
      .single()
    promptText = activePrompt?.prompt_text || getDefaultPrompt()
  }

  const targetDate = date || new Date().toISOString().split('T')[0]
  const prevDate = new Date(targetDate + 'T12:00:00Z')
  prevDate.setDate(prevDate.getDate() - 1)
  const previousDate = prevDate.toISOString().split('T')[0]

  const { data: rawItems } = await supabase
    .from('daily_repo')
    .select('id, title, content, source_type, source_email, source_url, collected_at')
    .in('newsletter_date', [targetDate, previousDate])
    .order('collected_at', { ascending: false })

  if (!rawItems || rawItems.length === 0) {
    return { ok: false, status: 400, error: 'Keine Inhalte für dieses Datum gefunden' }
  }

  const filteredItems = rawItems.filter(item => {
    if (!item.content || item.content.length < MIN_CONTENT_LENGTH) return false
    const title = item.title || ''
    if (GARBAGE_TITLE_PATTERNS.some(p => p.test(title))) return false
    return true
  })

  console.log(`[Analyze] Garbage filter: ${rawItems.length} → ${filteredItems.length} items`)

  if (filteredItems.length === 0) {
    return { ok: false, status: 400, error: 'Keine relevanten Inhalte nach Filterung gefunden' }
  }

  const items = filteredItems.sort(() => Math.random() - 0.5)

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
      const sourceInfo = findCanonicalUrl(item.title, item.source_email)
      if (sourceInfo) {
        sourceDisplay = `[${sourceInfo.name}](${sourceInfo.url})`
      } else {
        sourceDisplay = `${item.source_email || 'Newsletter'} (kein direkter Link verfügbar)`
      }
    }

    const content = item.content || 'Kein Inhalt'
    const part = `## ${i + 1}. ${item.title}\n**Quelle:** ${sourceDisplay} (${item.source_type})\n\n${content}\n\n---`

    if (totalChars + part.length > MAX_TOTAL_CHARS) {
      console.log(`[Analyze] Stopping at ${i} items due to size limit (${totalChars} chars)`)
      break
    }

    contentParts.push(part)
    totalChars += part.length
  }

  const processedItemIds = items.slice(0, contentParts.length).map(item => item.id)
  console.log(`[Analyze] Processing ${contentParts.length}/${items.length} items, ${totalChars} chars`)

  return {
    ok: true,
    data: {
      fullContent: contentParts.join('\n\n'),
      processedItemIds,
      promptText,
    },
  }
}

export interface AnalysisProcessResult {
  success: boolean
  content?: string
  itemIds?: string[]
  error?: string
}

/**
 * Run analysis in-process (no HTTP subrequest). Used by the scheduler to avoid
 * cross-origin redirects stripping the cron Authorization header.
 */
export async function processAnalysis(
  date?: string,
  promptId?: string
): Promise<AnalysisProcessResult> {
  const supabase = createAdminClient()
  const prepared = await prepareAnalysisInput(supabase, date, promptId)
  if (!prepared.ok) {
    return { success: false, error: prepared.error }
  }

  try {
    const result = await analyzeContent(prepared.data.fullContent, prepared.data.promptText)
    return {
      success: true,
      content: result.content,
      itemIds: prepared.data.processedItemIds,
    }
  } catch (error) {
    console.error('[Analyze] in-process analysis failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Analyse fehlgeschlagen',
    }
  }
}

export { streamAnalysis }

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
