/**
 * News Queue Service
 * Handles queue management with source diversification
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  NewsQueueItem,
  NewsQueueItemInsert,
  NewsQueueSourceDistribution,
  NewsQueueSelectableItem,
  BalancedQueueSelection
} from '@/lib/supabase/types'
import { recordQueueEvents, readStatusSnapshot } from '@/lib/news-queue/events'
import type { QueueEvent, QueueEventActor } from '@/lib/news-queue/events'

const SOURCE_LIMIT_PERCENTAGE = 1.0 // No source limit — all items pass through

/**
 * Patterns that indicate a queue item is NOT a real article
 * These should be filtered out during selection
 */
const JUNK_TITLE_PATTERNS = [
  // NYT games and puzzles
  /^play spelling bee$/i,
  /^connections\s*[-–]\s*group words/i,
  /^wordle/i,
  /^the mini/i,
  /^strands/i,

  // Meta/utility pages
  /^help center$/i,
  /^privacy policy$/i,
  /^terms of (service|use)/i,
  /^terms and conditions$/i,
  /^cookies policy$/i,
  /^subscribe to/i,
  /^subscribe$/i,
  /^introducing the .* app$/i,
  /^unsubscribe$/i,
  /referral hub/i,

  // Too short/generic (single words that are never article titles)
  /^x$/i,
  /^home$/i,
  /^about$/i,
  /^contact$/i,
  /^help$/i,
  /^here$/i,
  /^sale$/i,
  /^men$/i,
  /^brands$/i,
  /^beauty$/i,
  /^design$/i,
  /^reviews$/i,
  /^every$/i,
  /^LINK$/i,
  /^CONNECT$/i,
  /^read more$/i,
  /^learn more$/i,
  /^get up to speed$/i,
  /^tune in now$/i,
  /^view on medium$/i,
  /^rewind$/i,
  /^bootcamp$/i,
  /^careers$/i,
  /^observability$/i,

  // Spam indicators
  /missing something[✨★⭐]/i,
  /^your outfit/i,
  /limited time offer/i,
  /click here/i,

  // Forum/discussion pages (not articles)
  /^open thread \d+$/i,
  /^forum$/i,

  // Newsletter footer/utility links
  /^refer a friend/i,
  /^register (here|today)/i,
  /^become a (sponsor|tns sponsor)/i,
  /^submit your ai tool$/i,
  /^become a sponsor$/i,
  /^advertise to/i,
  /^list your software/i,
  /^find top ai developers/i,
  /^get the .* app/i,
  /^(morning brew|tech brew|business insider).*subscribe/i,
  /^\w+ subscriptions?:? (enjoy|subscribe)/i,
  /^request a demo/i,
  /^save the date$/i,
  /^word of the day$/i,
  /^what our readers are saying$/i,
  /^forward it to/i,
  /^jetzt unterstützen$/i,
  /^(und|and) make us a preferred source$/i,
  /^open in your browser$/i,
  /^store locator$/i,
  /^simple app$/i,
  /^from our partner$/i,
  /^catch the episode$/i,
  /^watch the (full |)episode$/i,
  /^featured story$/i,
  /explore the latest obituaries/i,

  // E-commerce products (Edgars etc.)
  /^ladies .*(jacket|coat|boot|blazer|parfum|puffer)/i,
  /^men .*(jacket|coat|boot)/i,
  /edgars account/i,

  // Discount/promo
  /^\d+% off your/i,
  /^get \d+% (back|off)/i,
  /🐣.*special.*off/i,

  // Newsletter author names (not articles)
  /^(dan ni|stephen flanders|sam klebanov|holly van leuven|matty merritt|brendan cosgrove|whizy kim|alex gove|connie loizos|arjun iyer|kayla bondy|david cassel|adrian bridgwater)$/i,
  // McKinsey author pages
  /^(kweilin ellingrud|scott blackburn|shubham singhal|arvind govindarajan|olivia white|jacqueline brassey|erica coe|kana enomoto|lucy pérez|eric kutcher)$/i,

  // Social media handles as titles
  /^@\w+:$/,

  // Raw tracking URLs as titles
  /^https?:\/\/(email\.mckinsey|e\.customeriomail|links\.morningbrew|elink\d*\.|hep\d*\.r\.sp|email-st\.seekingalpha|info\.thenewstack|cm\.stackedmarketer|semafor\.com\/s\/|l\.businessinsider|dev\.to\/ahoy)/i,

  // Solve puzzles / crosswords
  /^(sat|sun|mon|tue|wed|thu|fri),.*solve this/i,
]

/**
 * Check if a title indicates junk content (not a real article)
 * Exported so it can be used in the synthesis pipeline to prevent junk from being queued
 */
export function isJunkTitle(title: string): boolean {
  const normalizedTitle = title.trim()
  // Title is just a URL (not an article)
  if (normalizedTitle.startsWith('http://') || normalizedTitle.startsWith('https://')) return true
  // Title is too short to be an article (single word under 15 chars)
  if (normalizedTitle.length < 15 && !normalizedTitle.includes(' ')) return true
  return JUNK_TITLE_PATTERNS.some(pattern => pattern.test(normalizedTitle))
}

/**
 * Aggregator newsletters that curate links from other sources.
 * For these, we attribute items to the original source (via source_url domain)
 * instead of the aggregator newsletter email.
 */
const AGGREGATOR_EMAILS = new Set([
  'newsletter@techmeme.com',
])

/**
 * Check if an email belongs to a known aggregator newsletter
 */
function isAggregatorEmail(email: string | null): boolean {
  if (!email) return false
  const match = email.match(/<([^>]+)>/)
  const addr = match ? match[1].toLowerCase() : email.toLowerCase().trim()
  return AGGREGATOR_EMAILS.has(addr)
}

/**
 * Extract domain display name from a URL
 * e.g., "https://www.reuters.com/article/..." → "reuters.com"
 */
export function domainFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return null
  }
}

/**
 * Derive a usable source URL from available data.
 * Falls back to email domain homepage when source_url is missing.
 * Also handles plain text source names containing domains (e.g. "Dev.to Startup" → "https://dev.to")
 */
export function deriveSourceUrl(sourceUrl: string | null, sourceIdentifier: string): string | null {
  if (sourceUrl) {
    const domain = domainFromUrl(sourceUrl)
    if (domain) return sourceUrl
  }
  if (sourceIdentifier && sourceIdentifier !== 'unknown') {
    // Email address: extract domain
    const atIdx = sourceIdentifier.indexOf('@')
    if (atIdx !== -1) {
      let domain = sourceIdentifier.slice(atIdx + 1)
      // Strip mail-related subdomains (e.g. mail.theresanaiforthat.com → theresanaiforthat.com)
      domain = domain.replace(/^(link\.mail\.|mail\.|newsletter\.|email\.|e\.)/, '')
      if (domain && domain.includes('.')) return `https://${domain}`
    }
    // Plain text source name: try to find a domain-like word (e.g. "dev.to", "techcrunch.com")
    const words = sourceIdentifier.split(/\s+/)
    for (const word of words) {
      if (word.includes('.') && !word.includes('@') && word.length > 3) {
        try {
          const url = new URL(`https://${word}`)
          if (url.hostname.includes('.')) return url.origin
        } catch { /* not a valid domain */ }
      }
    }
  }
  return null
}

/**
 * Extract normalized source identifier from email or plain source name.
 * e.g., "Newsletter Name <email@domain.com>" → "email@domain.com"
 *       "Hacker News" → "hacker news" (plain webcrawl source name)
 * For aggregator newsletters (e.g. Techmeme), uses the article URL domain instead.
 */
export function normalizeSourceIdentifier(email: string | null, url: string | null): string {
  // For aggregators, attribute to the original source URL domain
  if (isAggregatorEmail(email) && url) {
    const domain = domainFromUrl(url)
    if (domain) return domain
  }

  if (email) {
    // Extract email address from format like "Name <email@domain.com>"
    const match = email.match(/<([^>]+)>/)
    if (match) return match[1].toLowerCase()
    // If it contains @, treat as email
    if (email.includes('@')) return email.toLowerCase().trim()
    // Plain text source name (e.g. "Hacker News", "Dev.to Machine Learning" from webcrawl)
    const trimmed = email.trim()
    if (trimmed.length > 0) return trimmed.toLowerCase()
  }

  if (url) {
    const domain = domainFromUrl(url)
    if (domain) return domain
  }

  return 'unknown'
}

/**
 * Extract human-readable source name from email or plain source name.
 * For aggregator newsletters, uses the article URL domain instead.
 */
export function extractSourceDisplayName(email: string | null, url?: string | null): string | null {
  // For aggregators, use the original article domain as display name
  if (isAggregatorEmail(email) && url) {
    const domain = domainFromUrl(url)
    if (domain) return domain
  }

  if (!email) return null

  // Extract name from "Newsletter Name <email@domain.com>" format
  const match = email.match(/^"?([^"<]+)"?\s*</)
  if (match) {
    const name = match[1].trim()
    if (!name.includes('@') && name.length > 0) {
      return name
    }
  }

  // Plain text source name without email format (e.g. "Hacker News" from webcrawl)
  const trimmed = email.trim()
  if (!trimmed.includes('@') && !trimmed.includes('<') && trimmed.length > 0) {
    return trimmed
  }

  return null
}

/**
 * Add items to the news queue from daily_repo
 */
export async function addToQueue(
  items: Array<{
    dailyRepoId?: string
    title: string
    excerpt?: string
    content?: string
    sourceEmail?: string | null
    sourceUrl?: string | null
    /**
     * Anzeigename, wenn die Quelle ihn KENNT und er nicht aus der Adresse
     * abzuleiten ist. Techmeme nennt die Publikation im Klartext („Reuters");
     * ohne diesen Weg stünde in der Queue nur „reuters.com", weil
     * extractSourceDisplayName ohne E-Mail null liefert. Der
     * source_identifier bleibt davon unberührt — die Quellenverteilung rechnet
     * weiter mit der Domain.
     */
    sourceDisplayName?: string | null
    /**
     * Bündel-Zuordnung schon beim Anlegen. Der Techmeme-Lauf kennt die
     * Story-Zugehörigkeit bereits — sie nachträglich zu setzen hieße, die eben
     * geschriebenen Zeilen über ihre URL wiederzufinden.
     */
    bundleType?: 'topic' | 'recap' | 'deep_dive' | 'cover_story' | null
    /** Abweichender Anfangsstatus (Techmeme-Themen starten auf 'selected'). */
    status?: 'pending' | 'selected'
    synthesisScore?: number
    relevanceScore?: number
    uniquenessScore?: number
    sourcePubRate?: number
    contentLength?: number
    emailReceivedAt?: string | null
    /**
     * Kürzere Verfallszeit als der Tabellen-Default (Techmeme-Herkunft:
     * Befund 2026-08-19 — eine 18h alte Story mit hohem Score gewann gegen
     * frischere, schwächer bewertete Konkurrenz im Tages-Lauf. Ohne Deckel
     * bleibt ein liegengebliebenes Item bis zum Default-Verfall wählbar).
     */
    expiresInHours?: number
    metadata?: Record<string, unknown>
  }>
): Promise<{ added: number; skipped: number; errors: string[] }> {
  const supabase = createAdminClient()
  const errors: string[] = []
  let added = 0
  let skipped = 0

  // Batch-lookup premium tiers for all source emails
  const sourceEmails = [...new Set(items.map(i =>
    normalizeSourceIdentifier(i.sourceEmail ?? null, i.sourceUrl ?? null)
  ).filter(e => e !== 'unknown'))]

  const tierBonusMap = new Map<string, number>()
  if (sourceEmails.length > 0) {
    const { data: premiumSources } = await supabase
      .from('newsletter_sources')
      .select('email, premium_tier')
      .in('email', sourceEmails)
      .not('premium_tier', 'is', null)

    for (const s of premiumSources || []) {
      const bonus = s.premium_tier === 1 ? 3.0 : s.premium_tier === 2 ? 2.0 : s.premium_tier === 3 ? 1.0 : 0
      tierBonusMap.set(s.email, bonus)
    }
  }

  // Build all records first
  const records: NewsQueueItemInsert[] = items.map(item => {
    const sourceIdentifier = normalizeSourceIdentifier(item.sourceEmail ?? null, item.sourceUrl ?? null)
    const sourceDisplayName = item.sourceDisplayName
      ?? extractSourceDisplayName(item.sourceEmail ?? null, item.sourceUrl ?? null)
    return {
      daily_repo_id: item.dailyRepoId || null,
      title: item.title,
      excerpt: item.excerpt || null,
      content: item.content || null,
      source_identifier: sourceIdentifier,
      source_display_name: sourceDisplayName,
      source_url: item.sourceUrl || null,
      synthesis_score: item.synthesisScore || 0,
      relevance_score: item.relevanceScore || 0,
      uniqueness_score: item.uniquenessScore || 0,
      source_bonus: tierBonusMap.get(sourceIdentifier) || 0,
      source_pub_rate: item.sourcePubRate ?? 0,
      content_length: item.contentLength ?? (item.content?.length || 0),
      email_received_at: item.emailReceivedAt || null,
      ...(item.bundleType ? { bundle_type: item.bundleType } : {}),
      ...(item.status ? { status: item.status, selected_at: new Date().toISOString() } : {}),
      ...(item.expiresInHours
        ? { expires_at: new Date(Date.now() + item.expiresInHours * 60 * 60 * 1000).toISOString() }
        : {}),
      metadata: item.metadata || {}
    }
  })

  // Items, die auf 'selected' STARTEN, bekommen ein select-Event — sonst
  // hätte die Herkunft (origin.ts) für sie nur den metadata-Fallback.
  // Techmeme-Themen (buildQueueItem: status 'selected', metadata.techmeme=true)
  // sind KEINE Handauswahl (Betreiber-Vorgabe 2026-10-05: unberührtes Techmeme
  // ist kein Hand-Item) → actor 'techmeme'; alle anderen → 'operator'.
  // Zuordnung Rückgabezeile ↔ Eingabe-Item über daily_repo_id (Newsletter)
  // bzw. source_url (Techmeme hat kein daily_repo_id); ohne beides gibt es
  // keinen Schlüssel und stillschweigend kein Event (bewusste Lücke).
  // source_url ist im selben Lauf nicht eindeutig (BEFUND 2026-10-06: dieselbe
  // Quelle kann in zwei Techmeme-Stories stehen, einmal selected, einmal
  // pending) — deshalb zählt zusätzlich der zurückgegebene Status der Zeile.
  // from_status: null ist nur für Neuanlagen exakt. Trifft ein selected-Item
  // per onConflict 'daily_repo_id' auf eine bestehende Zeile, wird deren
  // Status überschrieben, das Event sagt trotzdem null — heute unerreichbar
  // (einziger selected-Erzeuger ist Techmeme mit daily_repo_id null); ein
  // Snapshot-Roundtrip je 100er-Batch nur dafür lohnt nicht.
  const selectedActorByKey = new Map<string, QueueEventActor>()
  for (const item of items) {
    if (item.status !== 'selected') continue
    const key = item.dailyRepoId || item.sourceUrl
    if (!key) continue
    selectedActorByKey.set(key, item.metadata?.techmeme === true ? 'techmeme' : 'operator')
  }
  const selectEvents: QueueEvent[] = []
  const noteSelected = (row: { id: string; daily_repo_id: string | null; source_url: string | null; bundle_type: string | null; status: string }) => {
    if (row.status !== 'selected') return
    const actor = selectedActorByKey.get(row.daily_repo_id || row.source_url || '')
    if (!actor) return
    selectEvents.push({
      queue_item_id: row.id,
      event: 'select',
      actor,
      from_status: null,
      to_status: 'selected',
      from_role: null,
      to_role: row.bundle_type,
    })
  }
  const RETURNING = 'id, daily_repo_id, source_url, bundle_type, status'

  // Batch upsert: insert all at once, update scores on conflict
  const UPSERT_BATCH = 100
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH)
    try {
      const { data, error: upsertError } = await supabase
        .from('news_queue')
        .upsert(batch, {
          onConflict: 'daily_repo_id',
          ignoreDuplicates: false,
        })
        .select(RETURNING)

      if (upsertError) {
        // Fallback to individual inserts for this batch
        for (const record of batch) {
          try {
            const { data: inserted, error: insertError } = await supabase
              .from('news_queue')
              .insert(record)
              .select(RETURNING)
            if (insertError) {
              if (insertError.code === '23505') {
                skipped++
              } else {
                errors.push(`Failed: "${record.title.slice(0, 30)}...": ${insertError.message}`)
              }
            } else {
              added++
              for (const row of inserted || []) noteSelected(row)
            }
          } catch (err) {
            errors.push(`Error: "${record.title.slice(0, 30)}...": ${err}`)
          }
        }
      } else {
        added += data?.length || batch.length
        for (const row of data || []) noteSelected(row)
      }
    } catch (err) {
      errors.push(`Batch upsert error at offset ${i}: ${err}`)
    }
  }

  await recordQueueEvents(supabase, selectEvents)

  return { added, skipped, errors }
}

/**
 * Add items from daily_repo to queue (bulk operation)
 */
export async function queueFromDailyRepo(
  repoItemIds: string[]
): Promise<{ added: number; skipped: number; errors: string[] }> {
  const supabase = createAdminClient()

  // Fetch the items
  const { data: repoItems, error } = await supabase
    .from('daily_repo')
    .select('id, title, content, source_email, source_url, email_received_at, source_type')
    .in('id', repoItemIds)

  if (error || !repoItems) {
    return { added: 0, skipped: 0, errors: [`Failed to fetch items: ${error?.message}`] }
  }

  const items = repoItems.map(item => {
    // Manual articles (source_type='article') always get rank 9.0
    const isManual = item.source_type === 'article'
    return {
      dailyRepoId: item.id,
      title: item.title || 'Untitled',
      content: item.content || undefined,
      sourceEmail: item.source_email,
      sourceUrl: item.source_url,
      emailReceivedAt: item.email_received_at,
      synthesisScore: isManual ? 9.0 : undefined,
      relevanceScore: isManual ? 9.0 : undefined,
      uniquenessScore: isManual ? 9.0 : undefined,
    }
  })

  return addToQueue(items)
}

/**
 * Get source distribution statistics
 */
export async function getSourceDistribution(): Promise<NewsQueueSourceDistribution[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue_source_distribution')
    .select('*')

  if (error) {
    console.error('[NewsQueue] Failed to get source distribution:', error)
    return []
  }

  return data || []
}

/**
 * Get selectable items (respecting 35% source limit)
 */
export async function getSelectableItems(): Promise<NewsQueueSelectableItem[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue_selectable')
    .select('*')
    .limit(100)

  if (error) {
    console.error('[NewsQueue] Failed to get selectable items:', error)
    return []
  }

  return data || []
}

/**
 * Get balanced selection using database function
 * Falls back to simple score-based selection if balanced returns too few items
 */
export async function getBalancedSelection(
  maxItems: number = 25
): Promise<BalancedQueueSelection[]> {
  const supabase = createAdminClient()

  console.log(`[NewsQueue] Calling get_balanced_queue_selection(max_items=${maxItems}, target_source_limit=${SOURCE_LIMIT_PERCENTAGE})`)

  const { data, error } = await supabase
    .rpc('get_balanced_queue_selection', {
      max_items: maxItems,
      target_source_limit: SOURCE_LIMIT_PERCENTAGE
    })

  if (error) {
    console.error('[NewsQueue] Failed to get balanced selection:', error)
    // Fallback to simple selection on error
    return getSimpleSelection(supabase, maxItems)
  }

  console.log(`[NewsQueue] get_balanced_queue_selection returned ${data?.length || 0} items`)

  // Filter out junk items
  const filteredData = (data || []).filter((item: BalancedQueueSelection) => {
    if (isJunkTitle(item.title)) {
      console.log(`[NewsQueue] Filtering junk item: "${item.title.slice(0, 50)}"`)
      return false
    }
    return true
  })

  if (filteredData.length < (data?.length || 0)) {
    console.log(`[NewsQueue] Filtered out ${(data?.length || 0) - filteredData.length} junk items`)
  }

  if (filteredData.length > 0) {
    // Log source distribution
    const sources: Record<string, number> = {}
    for (const item of filteredData) {
      sources[item.source_identifier] = (sources[item.source_identifier] || 0) + 1
    }
    console.log(`[NewsQueue] Balanced selection sources:`, sources)
  }

  // If we don't have enough items after filtering, get more
  if (filteredData.length < maxItems) {
    console.log(`[NewsQueue] Only ${filteredData.length} valid items after filtering, getting more...`)
    // Request more items to compensate for filtering
    const extraNeeded = maxItems - filteredData.length
    const { data: extraData } = await supabase
      .rpc('get_balanced_queue_selection', {
        max_items: maxItems + extraNeeded * 2, // Request extra to account for more junk
        target_source_limit: SOURCE_LIMIT_PERCENTAGE
      })

    if (extraData) {
      const existingIds = new Set(filteredData.map((i: BalancedQueueSelection) => i.id))
      const extraFiltered = (extraData as BalancedQueueSelection[])
        .filter((item: BalancedQueueSelection) => !existingIds.has(item.id) && !isJunkTitle(item.title))
        .slice(0, extraNeeded)

      if (extraFiltered.length > 0) {
        console.log(`[NewsQueue] Added ${extraFiltered.length} extra items after filtering`)
        filteredData.push(...extraFiltered)
      }
    }
  }

  return filteredData
}

/**
 * Simple fallback selection - just gets top items by score without source balancing
 */
async function getSimpleSelection(
  supabase: ReturnType<typeof createAdminClient>,
  maxItems: number
): Promise<BalancedQueueSelection[]> {
  console.log(`[NewsQueue] Using simple selection fallback for ${maxItems} items`)

  // First, log the total count of eligible items
  const { count: totalPending } = await supabase
    .from('news_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())

  console.log(`[NewsQueue] Total pending items (not expired): ${totalPending}`)

  // Also check without expires_at filter
  const { count: totalPendingAll } = await supabase
    .from('news_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  console.log(`[NewsQueue] Total pending items (including expired): ${totalPendingAll}`)

  const { data, error } = await supabase
    .from('news_queue')
    .select('id, title, source_identifier, source_display_name, total_score, expires_at')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('total_score', { ascending: false })
    .limit(maxItems)

  if (error) {
    console.error('[NewsQueue] Simple selection also failed:', error)
    return []
  }

  console.log(`[NewsQueue] Simple selection returned ${data?.length || 0} items`)

  // Filter out junk and map to BalancedQueueSelection format
  const filtered = (data || []).filter(item => !isJunkTitle(item.title))

  if (filtered.length < (data?.length || 0)) {
    console.log(`[NewsQueue] Simple selection: filtered out ${(data?.length || 0) - filtered.length} junk items`)
  }

  return filtered.map((item, index) => ({
    id: item.id,
    title: item.title,
    source_identifier: item.source_identifier,
    source_display_name: item.source_display_name,
    total_score: item.total_score,
    selection_rank: index + 1
  }))
}

/**
 * Get items that have been manually selected (status='selected')
 * These are items the user explicitly chose for article generation.
 *
 * Pure read — does NOT mutate. Selections persist until used or explicitly
 * deselected; cleanup of genuinely abandoned selections is handled by the
 * resetStuckSelectedItems() cron (24h), not on every read, so a day's
 * selections never silently revert.
 */
export async function getSelectedItems(): Promise<NewsQueueItem[]> {
  const supabase = createAdminClient()

  const { data: selectedItems, error } = await supabase
    .from('news_queue')
    .select('*')
    .eq('status', 'selected')
    .order('total_score', { ascending: false })

  if (error) {
    console.error('[NewsQueue] Failed to get selected items:', error)
    return []
  }

  console.log(`[NewsQueue] getSelectedItems returning ${selectedItems?.length || 0} items`)

  return selectedItems || []
}

/**
 * Select items for article generation
 * Marks items as 'selected' and returns them
 * Note: Source limit validation is handled by getBalancedSelection() algorithm
 *
 * Betreiber-Vorgabe 2026-10-05: Wer 'selected' setzt, muss sich nennen — vier
 * Akteure (Admin-Route, Panel, Techmeme, Nachtlauf) setzen denselben Status,
 * und die Zeile kennt keinen davon. Deshalb ist `actor` Pflicht, kein Default:
 * ein stiller 'operator' würde Pipeline-Selects als Handauswahl verbuchen.
 * Hook ist best-effort: readStatusSnapshot und recordQueueEvents werfen nie
 * (Task 3), der Statuswechsel selbst bleibt davon unberührt.
 */
export async function selectItemsForArticle(
  itemIds: string[],
  opts: { actor: QueueEventActor }
): Promise<{ items: NewsQueueItem[]; error?: string }> {
  const supabase = createAdminClient()

  console.log(`[NewsQueue] selectItemsForArticle called with ${itemIds.length} item IDs`)

  // Note: We no longer validate source limits here because:
  // 1. getBalancedSelection() already handles this intelligently (35% rule after 4 items)
  // 2. Manual selection explicitly chooses items regardless of source
  // The previous check against news_queue_selectable was too restrictive for small queues

  // Label VOR dem Update lesen — nach dem Update ist from_role nicht mehr
  // ablesbar (BEFUND 2026-10-06). from_status ist durch den Filter
  // .eq('status','pending') ohnehin 'pending'; bei leerem Snapshot
  // (Lesefehler) bleibt es dabei.
  const vorher = await readStatusSnapshot(supabase, itemIds)

  // Mark items as selected
  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'selected',
      selected_at: new Date().toISOString()
    })
    .in('id', itemIds)
    .eq('status', 'pending')
    .select()

  if (error) {
    console.error(`[NewsQueue] selectItemsForArticle error:`, error)
    return { items: [], error: error.message }
  }

  console.log(`[NewsQueue] selectItemsForArticle updated ${data?.length || 0} items from pending to selected`)
  if (data && data.length < itemIds.length) {
    console.warn(`[NewsQueue] WARNING: Only ${data.length}/${itemIds.length} items were updated - some may not be in 'pending' status`)
  }

  const updated = (data || []) as NewsQueueItem[]
  await recordQueueEvents(supabase, updated.map((row): QueueEvent => ({
    queue_item_id: row.id,
    event: 'select',
    actor: opts.actor,
    from_status: vorher.get(row.id)?.status ?? 'pending',
    to_status: 'selected',
    from_role: vorher.get(row.id)?.bundle_type ?? null,
    to_role: row.bundle_type ?? null,
  })))

  return { items: updated }
}

/**
 * Mark items as used (after article generation)
 * Returns the count of items actually updated
 *
 * Event 'use' je getroffener Zeile. Default-Akteur 'pipeline', weil die
 * Masse der Aufrufe aus Cron/Sync kommt (syncPublishedPostsQueueItems);
 * die Admin-Route 'use' (Publish der Edit-Seite) übergibt 'operator'.
 * `reason` unterscheidet die Pipeline-Pfade ('sync' vs. Generierung).
 */
export async function markItemsAsUsed(
  itemIds: string[],
  postId: string,
  opts: { actor?: QueueEventActor; reason?: string } = {}
): Promise<{ updated: number; error?: string }> {
  const { actor = 'pipeline', reason } = opts

  if (!itemIds || itemIds.length === 0) {
    console.log('[NewsQueue] markItemsAsUsed called with empty itemIds')
    return { updated: 0 }
  }

  console.log(`[NewsQueue] Marking ${itemIds.length} items as used for post ${postId}`)
  console.log('[NewsQueue] Item IDs:', itemIds.slice(0, 5).join(', '), itemIds.length > 5 ? `... and ${itemIds.length - 5} more` : '')

  const supabase = createAdminClient()

  // Kein Status-Filter im Update (jede ID wird 'used', egal ob pending/selected/
  // expired) — deshalb muss from_status VOR dem Update gelesen werden.
  // readStatusSnapshot wirft nie (Task 3); Lesefehler → from_status null.
  const vorher = await readStatusSnapshot(supabase, itemIds)

  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'used',
      used_in_post_id: postId
    })
    .in('id', itemIds)
    .select('id')

  if (error) {
    console.error('[NewsQueue] Error marking items as used:', error)
    return { updated: 0, error: error.message }
  }

  const updatedCount = data?.length || 0
  console.log(`[NewsQueue] Successfully marked ${updatedCount} items as used`)

  if (updatedCount < itemIds.length) {
    console.warn(`[NewsQueue] Warning: Only ${updatedCount}/${itemIds.length} items were updated. Some IDs may not exist in the queue.`)
  }

  const rows = (data || []) as Array<{ id: string }>
  await recordQueueEvents(supabase, rows.map((row): QueueEvent => ({
    queue_item_id: row.id,
    event: 'use',
    actor,
    from_status: vorher.get(row.id)?.status ?? null,
    to_status: 'used',
    from_role: vorher.get(row.id)?.bundle_type ?? null,
    to_role: vorher.get(row.id)?.bundle_type ?? null,
    reason: reason ?? null,
  })))

  return { updated: updatedCount }
}

/**
 * Skip items with reason
 *
 * `.select('id')` neu, damit nur tatsächlich getroffene Zeilen ein Event
 * bekommen — ein Event für eine nicht existierende ID wäre Rauschen in der
 * Herkunftsableitung (BEFUND 2026-10-06).
 */
export async function skipItems(
  itemIds: string[],
  reason: string,
  opts: { actor?: QueueEventActor } = {}
): Promise<void> {
  const { actor = 'operator' } = opts
  const supabase = createAdminClient()

  const vorher = await readStatusSnapshot(supabase, itemIds)

  const { data } = await supabase
    .from('news_queue')
    .update({
      status: 'skipped',
      skip_reason: reason
    })
    .in('id', itemIds)
    .select('id')

  const rows = (data || []) as Array<{ id: string }>
  await recordQueueEvents(supabase, rows.map((row): QueueEvent => ({
    queue_item_id: row.id,
    event: 'skip',
    actor,
    from_status: vorher.get(row.id)?.status ?? null,
    to_status: 'skipped',
    from_role: vorher.get(row.id)?.bundle_type ?? null,
    to_role: vorher.get(row.id)?.bundle_type ?? null,
    reason,
  })))
}

/**
 * Expire old queue items (called by cron)
 *
 * Die Postgres-Funktion expire_old_queue_items liefert nur den Zähler, keine
 * IDs (Migration 20260127100000_reduce_queue_expiry.sql:58-71). Für die
 * Events deshalb drei Schritte:
 * 1. Kandidaten VORHER mit demselben Prädikat lesen: status='pending' AND
 *    expires_at < now(). Schmale Zeilen → Seiten à 1000 (PostgREST-Cap),
 *    .order('id') für eine stabile Reihenfolge über Seiten.
 * 2. RPC.
 * 3. Nachkontrolle: Status der Kandidaten NACH dem RPC lesen; ein Event
 *    bekommt nur, wer jetzt 'expired' ist (BEFUND 2026-10-06, Review Focus 5:
 *    zwischen Select und RPC kann ein Kandidat selected/skipped werden, und
 *    die RPC-Definition in Prod kann von der Repo-Migration abweichen).
 *    Einziger Setzer von 'expired' ist dieser RPC, und er nimmt nur
 *    pending-Zeilen — from_status 'pending' ist damit exakt.
 *
 * Bewusste Restlücke (best-effort, Vertrag 2.4), nur noch Verfall ohne Event:
 * - `jetzt` ist JS-Zeit, der RPC vergleicht mit Server-NOW(); Zeilen, die
 *   dazwischen fällig werden oder ein abweichendes Prod-Prädikat zusätzlich
 *   trifft, stehen nicht in der Kandidatenliste.
 * - Scheitert eine Seite des Vorab-Selects, werden ALLE Kandidaten verworfen
 *   (kein Teil-Event-Satz); der RPC läuft trotzdem — der Hook darf den
 *   Verfall nie blockieren.
 * - Scheitert die Nachkontrolle (ganz oder für eine Scheibe), fehlen die
 *   Events dieser IDs: lieber ein fehlendes Event als ein falsches.
 * Laufen Cron und Admin-Action 'expire' gleichzeitig, kann ein Item zwei
 * expire-Events bekommen (beide Nachkontrollen sehen 'expired').
 * Exakt wäre nur ein RPC mit RETURNING id — das braucht eine Migration und
 * ist nicht Teil von Phase 0.
 */
export async function expireOldItems(): Promise<number> {
  const supabase = createAdminClient()

  const jetzt = new Date().toISOString()
  let kandidaten: string[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: seite, error: readError } = await supabase
      .from('news_queue')
      .select('id')
      .eq('status', 'pending')
      .lt('expires_at', jetzt)
      .order('id')
      .range(from, from + PAGE - 1)
    if (readError) {
      console.error('[NewsQueue] Verfalls-Kandidaten nicht lesbar, keine expire-Events:', readError)
      kandidaten = []
      break
    }
    const rows = (seite ?? []) as Array<{ id: string }>
    kandidaten.push(...rows.map((r) => r.id))
    if (rows.length < PAGE) break
  }

  const { data, error } = await supabase.rpc('expire_old_queue_items')

  if (error) {
    console.error('[NewsQueue] Failed to expire items:', error)
    return 0
  }

  // Nachkontrolle: nur wer jetzt wirklich 'expired' ist, bekommt ein Event.
  // readStatusSnapshot wirft nie und schneidet selbst in Scheiben à 200
  // (Task 3); bei leerer Kandidatenliste macht es keinen DB-Zugriff.
  const nachher = await readStatusSnapshot(supabase, kandidaten)
  const verfallen = kandidaten.filter((id) => nachher.get(id)?.status === 'expired')
  if (verfallen.length < kandidaten.length) {
    console.warn(`[NewsQueue] expireOldItems: ${kandidaten.length - verfallen.length}/${kandidaten.length} Kandidaten nach dem RPC nicht 'expired' (Statuswechsel dazwischen oder Nachkontrolle nicht lesbar) — ohne Event`)
  }

  // reason spiegelt skip_reason der Postgres-Funktion (Repo-Migration :65),
  // damit Event und Zeile dieselbe Geschichte erzählen. bundle_type ändert
  // der RPC nicht — das Label nach dem Verfall ist auch das davor.
  await recordQueueEvents(supabase, verfallen.map((id): QueueEvent => ({
    queue_item_id: id,
    event: 'expire',
    actor: 'pipeline',
    from_status: 'pending',
    to_status: 'expired',
    from_role: nachher.get(id)?.bundle_type ?? null,
    to_role: nachher.get(id)?.bundle_type ?? null,
    reason: 'Auto-expired after 2 days',
  })))

  return data || 0
}

/**
 * Get queue statistics. Pure read — does not mutate selections.
 */
export async function getQueueStats(): Promise<{
  pending: number
  selected: number
  used: number
  expired: number
  skipped: number
  total: number
  oldestSelectedAt: string | null
}> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // Pure read — no longer mutates selections. (Abandoned selections are
  // recycled by the resetStuckSelectedItems() cron, not on every stats load.)

  // Fetch recent items (7-day window) for pending/used/expired counts
  // Paginate to bypass PostgREST 1000-row limit
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  let data: Array<{ status: string; expires_at: string | null; selected_at: string | null }> = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('news_queue')
      .select('status, expires_at, selected_at')
      .gte('queued_at', sevenDaysAgo)
      .range(offset, offset + PAGE - 1)
    if (pageErr || !page || page.length === 0) break
    data.push(...page)
    if (page.length < PAGE) break
    offset += PAGE
  }

  // Fetch selected items separately — they must always be counted regardless
  // of queued_at age (items may have been queued weeks ago but selected today)
  const { data: selectedData } = await supabase
    .from('news_queue')
    .select('selected_at')
    .eq('status', 'selected')

  if (data.length === 0 && !selectedData?.length) {
    return { pending: 0, selected: 0, used: 0, expired: 0, skipped: 0, total: 0, oldestSelectedAt: null }
  }

  const selectedCount = selectedData?.length || 0

  const stats = {
    pending: 0,
    selected: selectedCount,
    used: 0,
    expired: 0,
    skipped: 0,
    total: data.length,
    oldestSelectedAt: null as string | null
  }

  for (const item of data) {
    // Count pending items as expired if past expiration date
    if (item.status === 'pending' && item.expires_at && item.expires_at < now) {
      stats.expired++
    } else if (item.status !== 'selected') {
      // Skip selected — already counted above from separate query
      const status = item.status as keyof typeof stats
      if (status in stats && typeof stats[status] === 'number') {
        (stats[status] as number)++
      }
    }
  }

  // Track oldest selected_at
  for (const item of selectedData || []) {
    if (item.selected_at) {
      if (!stats.oldestSelectedAt || item.selected_at < stats.oldestSelectedAt) {
        stats.oldestSelectedAt = item.selected_at
      }
    }
  }

  return stats
}

/**
 * Update scores for queue items
 */
export async function updateScores(
  itemId: string,
  scores: {
    synthesisScore?: number
    relevanceScore?: number
    uniquenessScore?: number
  }
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('news_queue')
    .update({
      synthesis_score: scores.synthesisScore,
      relevance_score: scores.relevanceScore,
      uniqueness_score: scores.uniquenessScore
    })
    .eq('id', itemId)
}

/**
 * Get pending items for a specific source
 */
export async function getItemsBySource(
  sourceIdentifier: string
): Promise<NewsQueueItem[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue')
    .select('*')
    .eq('source_identifier', sourceIdentifier)
    .eq('status', 'pending')
    .order('total_score', { ascending: false })

  if (error) {
    console.error('[NewsQueue] Failed to get items by source:', error)
    return []
  }

  return data || []
}

/**
 * Check if adding items would violate source limit
 */
export async function wouldViolateSourceLimit(
  sourceIdentifier: string,
  additionalCount: number = 1
): Promise<boolean> {
  const distribution = await getSourceDistribution()
  const stats = await getQueueStats()

  const sourceStats = distribution.find(d => d.source_identifier === sourceIdentifier)
  const currentCount = sourceStats?.pending_count || 0
  const totalPending = stats.pending

  const newPercentage = (currentCount + additionalCount) / (totalPending + additionalCount)

  return newPercentage > SOURCE_LIMIT_PERCENTAGE
}

/**
 * Clear all pending items from the queue
 */
export async function clearPendingQueue(): Promise<number> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue')
    .delete()
    .eq('status', 'pending')
    .select('id')

  if (error) {
    console.error('[NewsQueue] Failed to clear queue:', error)
    return 0
  }

  console.log(`[NewsQueue] Cleared ${data?.length || 0} pending items`)
  return data?.length || 0
}

/**
 * Reset selected items back to pending
 * Use this when generated articles were not saved/published
 *
 * from_status ist durch .eq('status','selected') bekannt; das Label kommt aus
 * dem erweiterten .select() derselben Abfrage — kein zweiter Roundtrip.
 * Kein ids-Parameter: der einzige Aufrufer (Route 'reset-selected') setzt
 * per Design alle selected-Zeilen zurück; reset-item hookt in der Route (Task 6).
 */
export async function resetSelectedToPending(
  opts: { actor?: QueueEventActor } = {}
): Promise<number> {
  const { actor = 'operator' } = opts
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'pending',
      selected_at: null
    })
    .eq('status', 'selected')
    .select('id, bundle_type')

  if (error) {
    console.error('[NewsQueue] Failed to reset selected items:', error)
    return 0
  }

  console.log(`[NewsQueue] Reset ${data?.length || 0} selected items to pending`)

  const rows = (data || []) as Array<{ id: string; bundle_type: string | null }>
  await recordQueueEvents(supabase, rows.map((row): QueueEvent => ({
    queue_item_id: row.id,
    event: 'reset',
    actor,
    from_status: 'selected',
    to_status: 'pending',
    from_role: row.bundle_type,
    to_role: row.bundle_type,
  })))

  return data?.length || 0
}

/**
 * Reset stuck "selected" items back to pending
 * Items that were selected but not used within maxHours are reset
 * This prevents items from being stuck forever if a draft is abandoned.
 *
 * Exception: items the user deliberately accepted from the assisted-ranking
 * panel ("Behalten") are a curatorial choice, not an abandoned draft. Recycling
 * them made them reappear in the queue and suggestions the next day. They are
 * excluded here and stay selected until used or explicitly removed
 * (resetSelectedToPending / the per-item "Remove" action still reset them).
 *
 * Event 'stuck_reset' (actor 'pipeline') je zurückgesetzter Zeile — der
 * Kandidaten-Select liefert das Label gleich mit.
 */
export async function resetStuckSelectedItems(maxHours: number = 24): Promise<number> {
  const supabase = createAdminClient()

  const cutoffTime = new Date(Date.now() - maxHours * 60 * 60 * 1000).toISOString()

  // Candidate stuck items first, so we can exclude deliberately-accepted ones.
  const { data: stuck, error: selError } = await supabase
    .from('news_queue')
    .select('id, bundle_type')
    .eq('status', 'selected')
    .lt('selected_at', cutoffTime)

  if (selError) {
    console.error('[NewsQueue] Failed to read stuck selected items:', selError)
    return 0
  }
  if (!stuck || stuck.length === 0) return 0

  // Label je Kandidat für from_role/to_role des Events (Zeile ist nach dem
  // Update noch da, aber ein zweiter Roundtrip wäre unnötig).
  const labelOf = new Map<string, string | null>()
  for (const r of stuck) labelOf.set(r.id, r.bundle_type ?? null)

  // Protect items accepted via the ranking panel from auto-recycling.
  const candidateIds = stuck.map((r) => r.id)
  const { data: accepted } = await supabase
    .from('ranking_suggestions')
    .select('queue_item_id')
    .eq('user_action', 'accepted')
    .in('queue_item_id', candidateIds)
  const protectedIds = new Set((accepted || []).map((a) => a.queue_item_id))

  const toReset = candidateIds.filter((id) => !protectedIds.has(id))
  if (toReset.length === 0) return 0

  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'pending',
      selected_at: null
    })
    .in('id', toReset)
    .select('id')

  if (error) {
    console.error('[NewsQueue] Failed to reset stuck selected items:', error)
    return 0
  }

  if (data && data.length > 0) {
    console.log(`[NewsQueue] Reset ${data.length} stuck selected items (older than ${maxHours}h) to pending` + (protectedIds.size > 0 ? ` (${protectedIds.size} ranking-accepted protected)` : ''))
  }

  const rows = (data || []) as Array<{ id: string }>
  await recordQueueEvents(supabase, rows.map((row): QueueEvent => ({
    queue_item_id: row.id,
    event: 'stuck_reset',
    actor: 'pipeline',
    from_status: 'selected',
    to_status: 'pending',
    from_role: labelOf.get(row.id) ?? null,
    to_role: labelOf.get(row.id) ?? null,
  })))

  return data?.length || 0
}

/**
 * Mark queue items as used based on published posts that still have pending_queue_item_ids
 * This is a cleanup function for posts that were published before the queue marking was fixed
 */
export async function syncPublishedPostsQueueItems(): Promise<{ processed: number; itemsMarked: number }> {
  const supabase = createAdminClient()

  // Find published posts that still have pending_queue_item_ids
  const { data: posts, error: postsError } = await supabase
    .from('generated_posts')
    .select('id, pending_queue_item_ids')
    .eq('status', 'published')
    .not('pending_queue_item_ids', 'is', null)

  if (postsError || !posts) {
    console.error('[NewsQueue] Failed to fetch published posts:', postsError)
    return { processed: 0, itemsMarked: 0 }
  }

  // Filter to posts that actually have queue items
  const postsWithItems = posts.filter(p =>
    Array.isArray(p.pending_queue_item_ids) && p.pending_queue_item_ids.length > 0
  )

  if (postsWithItems.length === 0) {
    return { processed: 0, itemsMarked: 0 }
  }

  console.log(`[NewsQueue] Found ${postsWithItems.length} published posts with unprocessed queue items`)

  let totalMarked = 0

  for (const post of postsWithItems) {
    const itemIds = post.pending_queue_item_ids as string[]
    // Cron-Nachzügler, kein Betreiber-Klick: actor 'pipeline', reason 'sync'
    // (Vertrag 2.4), damit der Publish-Pfad der Edit-Seite davon unterscheidbar bleibt.
    const result = await markItemsAsUsed(itemIds, post.id, { actor: 'pipeline', reason: 'sync' })
    totalMarked += result.updated

    // Clear the pending_queue_item_ids on the post
    await supabase
      .from('generated_posts')
      .update({ pending_queue_item_ids: [] })
      .eq('id', post.id)
  }

  console.log(`[NewsQueue] Synced ${postsWithItems.length} posts, marked ${totalMarked} queue items as used`)

  return { processed: postsWithItems.length, itemsMarked: totalMarked }
}
