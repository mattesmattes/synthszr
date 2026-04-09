/**
 * Synthesis Pipeline
 * Scores all digest items via Claude Haiku (SUBSTANZ/RELEVANZ/NEUHEIT)
 * and queues them to the news queue. No historical comparison.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { addToQueue } from '@/lib/news-queue'
import { isJunkTitle, normalizeSourceIdentifier } from '@/lib/news-queue/service'
import { scoreContentOnly } from './score'
import type { DevelopedSynthesis } from './develop'

/**
 * Normalize source email/url to a source identifier (reuses queue service logic)
 */
function normalizeSource(email: string | null, url: string | null): string {
  return normalizeSourceIdentifier(email, url)
}

/**
 * Load historical source publication rates.
 * Extracts queueItemIds from published generated_posts TipTap content,
 * then calculates per-source: published_count / total_count.
 */
async function getSourcePubRates(): Promise<Map<string, number>> {
  const supabase = createAdminClient()
  const rates = new Map<string, number>()

  // Get published post content to extract queueItemIds
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('content')
    .eq('status', 'published')

  if (!posts || posts.length === 0) return rates

  // Extract all queueItemIds from TipTap heading nodes
  const publishedIds = new Set<string>()
  for (const post of posts) {
    if (!post.content) continue
    try {
      const doc = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
      extractQueueItemIds(doc, publishedIds)
    } catch {
      // Skip unparseable content
    }
  }

  if (publishedIds.size === 0) return rates

  // Count per source: total items and published items
  const sourceTotals = new Map<string, number>()
  const sourcePublished = new Map<string, number>()

  // Fetch queue items from last 30 days only (avoids full-table scan on large tables)
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  let offset = 0
  const batchSize = 1000
  while (true) {
    const { data } = await supabase
      .from('news_queue')
      .select('id, source_identifier')
      .gte('queued_at', cutoff30d)
      .range(offset, offset + batchSize - 1)

    if (!data || data.length === 0) break

    for (const item of data) {
      const src = item.source_identifier
      sourceTotals.set(src, (sourceTotals.get(src) || 0) + 1)
      if (publishedIds.has(item.id)) {
        sourcePublished.set(src, (sourcePublished.get(src) || 0) + 1)
      }
    }

    if (data.length < batchSize) break
    offset += batchSize
  }

  // Calculate rates
  for (const [src, total] of sourceTotals) {
    const published = sourcePublished.get(src) || 0
    rates.set(src, total > 0 ? published / total : 0)
  }

  console.log(`[Pipeline] Source pub rates: ${publishedIds.size} published items across ${rates.size} sources`)
  return rates
}

/** Recursively extract queueItemIds from TipTap JSON */
function extractQueueItemIds(node: Record<string, unknown>, ids: Set<string>) {
  if (node.type === 'heading' && node.attrs) {
    const attrs = node.attrs as Record<string, unknown>
    if (attrs.queueItemId && typeof attrs.queueItemId === 'string') {
      ids.add(attrs.queueItemId)
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === 'object') {
        extractQueueItemIds(child as Record<string, unknown>, ids)
      }
    }
  }
}

// ── Recently Published Topic Penalty ─────────────────────────────

/**
 * Load titles of articles published in the last N days.
 * Extracts heading text from TipTap JSON of recent published posts.
 */
async function getRecentlyPublishedTitles(days: number = 3): Promise<string[]> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data: posts } = await supabase
    .from('generated_posts')
    .select('content')
    .eq('status', 'published')
    .gte('created_at', cutoff)

  if (!posts || posts.length === 0) return []

  const titles: string[] = []
  for (const post of posts) {
    if (!post.content) continue
    try {
      const doc = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
      extractHeadingTexts(doc, titles)
    } catch {
      // Skip unparseable content
    }
  }
  return titles
}

/** Recursively extract heading text from TipTap JSON */
function extractHeadingTexts(node: Record<string, unknown>, titles: string[]) {
  if (node.type === 'heading' && Array.isArray(node.content)) {
    const text = (node.content as Array<Record<string, unknown>>)
      .filter(n => n.type === 'text' && typeof n.text === 'string')
      .map(n => n.text as string)
      .join('')
    if (text.length > 5) titles.push(text)
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (child && typeof child === 'object') {
        extractHeadingTexts(child as Record<string, unknown>, titles)
      }
    }
  }
}

/**
 * Apply recency penalty: items whose topic was already published in recent days
 * get their relevance and synthesis scores halved.
 * Uses title bigram Jaccard similarity > 0.25 as threshold (looser than intra-day
 * dedup at 0.5, because we want to catch thematic overlap, not just exact dupes).
 */
function applyRecencyPenalty(
  items: Array<{ id: string; title: string }>,
  recentTitles: string[],
  scoreMap: Map<string, { synthesisScore: number; relevanceScore: number; uniquenessScore: number; reasoning: string }>
): number {
  if (recentTitles.length === 0) return 0

  const recentBigrams = recentTitles.map(t => titleBigrams(t))
  let penalized = 0

  for (const item of items) {
    const itemBigrams = titleBigrams(item.title)
    let maxSim = 0
    for (const recent of recentBigrams) {
      const sim = jaccardSimilarity(itemBigrams, recent)
      if (sim > maxSim) maxSim = sim
    }

    if (maxSim > 0.25) {
      const scores = scoreMap.get(item.id)
      if (scores) {
        // Scale penalty by similarity: 0.25→mild, 0.5+→harsh
        const penaltyFactor = Math.min(maxSim * 1.5, 0.9)
        scores.relevanceScore = Math.max(0, scores.relevanceScore * (1 - penaltyFactor))
        scores.synthesisScore = Math.max(0, scores.synthesisScore * (1 - penaltyFactor))
        penalized++
        console.log(
          `[Pipeline] Recency penalty: "${item.title.slice(0, 50)}" ` +
          `(sim=${maxSim.toFixed(2)}, factor=${penaltyFactor.toFixed(2)}) ` +
          `→ rel=${scores.relevanceScore.toFixed(1)}, synth=${scores.synthesisScore.toFixed(1)}`
        )
      }
    }
  }

  return penalized
}

// ── Topic Deduplication ──────────────────────────────────────────

function titleBigrams(title: string): Set<string> {
  const words = title.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1)
  const bigrams = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`)
  }
  return bigrams
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Apply novelty penalty to items with similar titles.
 * Items sorted by base score descending. For each duplicate match (Jaccard > 0.5),
 * the lower-scored item loses 2 uniqueness points (floor at 0).
 * Mutates the scores in-place via the scoreMap.
 */
function applyNoveltyPenalty(
  items: Array<{ id: string; title: string }>,
  scoreMap: Map<string, { synthesisScore: number; relevanceScore: number; uniquenessScore: number; reasoning: string }>
): number {
  // Build bigram index
  const indexed = items
    .map(item => {
      const scores = scoreMap.get(item.id)
      const baseScore = scores
        ? scores.synthesisScore * 0.4 + scores.relevanceScore * 0.3 + scores.uniquenessScore * 0.3
        : 0
      return { id: item.id, title: item.title, bigrams: titleBigrams(item.title), baseScore }
    })
    .sort((a, b) => b.baseScore - a.baseScore)

  let penaltiesApplied = 0

  // Track which items have already been penalized and how many times
  const penaltyCount = new Map<string, number>()

  for (let i = 0; i < indexed.length; i++) {
    for (let j = i + 1; j < indexed.length; j++) {
      const sim = jaccardSimilarity(indexed[i].bigrams, indexed[j].bigrams)
      if (sim > 0.5) {
        // Penalize the lower-scored duplicate
        const targetId = indexed[j].id
        const count = (penaltyCount.get(targetId) || 0) + 1
        penaltyCount.set(targetId, count)

        const scores = scoreMap.get(targetId)
        if (scores) {
          const penalty = 2.0
          scores.uniquenessScore = Math.max(0, scores.uniquenessScore - penalty)
          penaltiesApplied++
          console.log(
            `[Pipeline] Novelty penalty: "${indexed[j].title.slice(0, 50)}" ` +
            `(sim=${sim.toFixed(2)} with "${indexed[i].title.slice(0, 50)}") ` +
            `→ uniqueness=${scores.uniquenessScore.toFixed(1)}`
          )
        }
      }
    }
  }

  return penaltiesApplied
}

export interface SynthesisPipelineResult {
  success: boolean
  digestId: string
  itemsProcessed: number
  candidatesFound: number
  synthesesDeveloped: number
  remainingSyntheses: number
  errors: string[]
}

export interface SynthesisProgressEvent {
  type: 'init' | 'searching' | 'scoring' | 'developing' | 'developed' | 'complete' | 'error' | 'partial'
  totalItems?: number
  currentItem?: number
  itemTitle?: string
  synthesis?: {
    headline: string
    content: string
    historicalReference: string
  }
  error?: string
  message?: string
}

export interface SynthesisPrompt {
  id: string
  name: string
  scoring_prompt: string
  development_prompt: string
  content_prompt?: string
  core_thesis: string
}

/**
 * Get daily_repo items associated with a digest (no item cap)
 */
async function getDigestItems(digestId: string): Promise<
  Array<{
    id: string
    title: string
    content: string
    source_email: string | null
    source_url: string | null
  }>
> {
  const supabase = createAdminClient()

  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('digest_date')
    .eq('id', digestId)
    .single()

  if (digestError || !digest) {
    throw new Error(`Digest not found: ${digestId}`)
  }

  let rawItems: Array<{ id: string; title: string; content: string; source_email: string | null; source_url: string | null }>

  // Fetch ALL items for the digest date AND previous day (matches analyze route behavior)
  // The analyze route fetches from [targetDate, previousDate] to support day+1 workflows
  const prevDate = new Date(digest.digest_date + 'T12:00:00Z')
  prevDate.setDate(prevDate.getDate() - 1)
  const previousDate = prevDate.toISOString().split('T')[0]
  const dates = [digest.digest_date, previousDate]

  const allItems: typeof rawItems = []
  for (const date of dates) {
    let offset = 0
    const PAGE = 1000
    while (true) {
      const { data, error } = await supabase
        .from('daily_repo')
        .select('id, title, content, source_email, source_url')
        .eq('newsletter_date', date)
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      allItems.push(...data)
      if (data.length < PAGE) break
      offset += PAGE
    }
  }
  rawItems = allItems

  console.log(`[Pipeline] Fetched ${rawItems.length} raw items`)

  // Deduplicate by title
  const seenTitles = new Set<string>()
  const uniqueItems = rawItems.filter(item => {
    const normalized = item.title.trim().toLowerCase().slice(0, 100)
    if (seenTitles.has(normalized)) return false
    seenTitles.add(normalized)
    return true
  })

  const dupeCount = rawItems.length - uniqueItems.length
  if (dupeCount > 0) {
    console.log(`[Pipeline] Removed ${dupeCount} duplicates, ${uniqueItems.length} unique items`)
  }

  return uniqueItems
}

/**
 * Score items via Claude Haiku and queue them to the news queue in batches.
 * Scoring criteria: SUBSTANZ, RELEVANZ, NEUHEIT (each 0-10).
 */
async function scoreAndQueueItems(
  items: Array<{
    id: string
    title: string
    content: string
    source_email: string | null
    source_url: string | null
  }>,
  onProgress?: (phase: 'scoring' | 'queuing', current: number, total: number, message?: string) => void
): Promise<{ added: number; skipped: number; junkFiltered: number; scored: number }> {
  // Filter junk
  const validItems = items.filter(item => !isJunkTitle(item.title))
  const junkFiltered = items.length - validItems.length
  if (junkFiltered > 0) {
    console.log(`[Pipeline] Filtered ${junkFiltered} junk items`)
  }

  if (validItems.length === 0) {
    return { added: 0, skipped: 0, junkFiltered, scored: 0 }
  }

  // Phase 1: Score all items via Haiku (SUBSTANZ/RELEVANZ/NEUHEIT)
  console.log(`[Pipeline] Scoring ${validItems.length} items via Haiku...`)
  const scoreMap = await scoreContentOnly(
    validItems.map(item => ({ id: item.id, title: item.title, content: item.content || '' })),
    {
      concurrency: 8,
      onProgress: (scored, total) => {
        if (onProgress) {
          onProgress('scoring', scored, total)
        }
      },
    }
  )
  console.log(`[Pipeline] Scored ${scoreMap.size} items`)

  // Phase 1.5a: Penalize topics already published in recent days
  if (onProgress) onProgress('queuing', 0, validItems.length, 'Berechne Penalties & Publikationsraten...')
  const recentTitles = await getRecentlyPublishedTitles(3)
  const recencyPenalties = applyRecencyPenalty(validItems, recentTitles, scoreMap)
  if (recencyPenalties > 0) {
    console.log(`[Pipeline] Applied ${recencyPenalties} recency penalties (${recentTitles.length} recent titles checked)`)
  }

  // Phase 1.5b: Apply novelty penalty for intra-day topic deduplication
  const penaltiesApplied = applyNoveltyPenalty(validItems, scoreMap)
  if (penaltiesApplied > 0) {
    console.log(`[Pipeline] Applied ${penaltiesApplied} novelty penalties`)
  }

  // Phase 1.6: Load source publication rates from historical data
  const sourcePubRates = await getSourcePubRates()
  console.log(`[Pipeline] Loaded publication rates for ${sourcePubRates.size} sources`)

  // Phase 2: Queue all items with their real scores + source_pub_rate + content_length
  let totalAdded = 0
  let totalSkipped = 0
  const QUEUE_BATCH_SIZE = 50

  for (let i = 0; i < validItems.length; i += QUEUE_BATCH_SIZE) {
    const batch = validItems.slice(i, i + QUEUE_BATCH_SIZE)

    const queueItems = batch.map(item => {
      const scores = scoreMap.get(item.id)
      const sourceId = normalizeSource(item.source_email, item.source_url)
      return {
        dailyRepoId: item.id,
        title: item.title,
        content: item.content || undefined,
        sourceEmail: item.source_email || undefined,
        sourceUrl: item.source_url || undefined,
        synthesisScore: scores?.synthesisScore ?? 5,
        relevanceScore: scores?.relevanceScore ?? 5,
        uniquenessScore: scores?.uniquenessScore ?? 5,
        sourcePubRate: sourcePubRates.get(sourceId) ?? 0,
        contentLength: (item.content || '').length,
      }
    })

    try {
      const result = await addToQueue(queueItems)
      totalAdded += result.added
      totalSkipped += result.skipped
    } catch (error) {
      console.error(`[Pipeline] Batch queue error at offset ${i}:`, error)
      totalSkipped += batch.length
    }

    if (onProgress) {
      onProgress('queuing', Math.min(i + QUEUE_BATCH_SIZE, validItems.length), validItems.length)
    }
  }

  console.log(`[Pipeline] Queued ${totalAdded} items, ${totalSkipped} skipped (duplicates), ${junkFiltered} junk filtered`)
  return { added: totalAdded, skipped: totalSkipped, junkFiltered, scored: scoreMap.size }
}

/**
 * Run the synthesis pipeline for a digest (non-streaming version)
 * Queues all items to the news queue without historical comparison
 */
export async function runSynthesisPipeline(
  digestId: string,
  _options: {
    maxItemsToProcess?: number
    maxCandidatesPerItem?: number
    minSimilarity?: number
    maxAgeDays?: number
  } = {}
): Promise<SynthesisPipelineResult> {
  const errors: string[] = []

  console.log(`[Pipeline] Starting pipeline for digest ${digestId}`)

  try {
    const items = await getDigestItems(digestId)
    console.log(`[Pipeline] Processing ${items.length} items (no cap)`)

    const result = await scoreAndQueueItems(items)

    return {
      success: true,
      digestId,
      itemsProcessed: items.length,
      candidatesFound: result.added,
      synthesesDeveloped: 0,
      remainingSyntheses: 0,
      errors,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[Pipeline] Error:`, msg)
    errors.push(msg)
    return {
      success: false,
      digestId,
      itemsProcessed: 0,
      candidatesFound: 0,
      synthesesDeveloped: 0,
      remainingSyntheses: 0,
      errors,
    }
  }
}

/**
 * Get developed syntheses for a digest, including the source article title
 */
export async function getSynthesesForDigest(
  digestId: string
): Promise<DevelopedSynthesis[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('developed_syntheses')
    .select(`
      *,
      synthesis_candidates(
        source_item_id,
        daily_repo!synthesis_candidates_source_item_id_fkey(title)
      )
    `)
    .eq('digest_id', digestId)
    .order('core_thesis_alignment', { ascending: false })

  if (error) {
    console.error('[Pipeline] Failed to get syntheses:', error)
    return []
  }

  return (data || []).map((s) => ({
    candidateId: s.candidate_id,
    headline: s.synthesis_headline,
    content: s.synthesis_content,
    historicalReference: s.historical_reference,
    coreThesisAlignment: s.core_thesis_alignment,
    sourceArticleTitle: s.synthesis_candidates?.daily_repo?.title || null,
  }))
}

/**
 * Run the synthesis pipeline with progress callbacks for streaming UI
 * Queues ALL digest items to news queue in batches.
 */
const PIPELINE_VERSION = 'v15-queue-all'

export async function runSynthesisPipelineWithProgress(
  digestId: string,
  _options: {
    maxItemsToProcess?: number
    maxCandidatesPerItem?: number
    minSimilarity?: number
    maxAgeDays?: number
  } = {},
  onProgress: (event: SynthesisProgressEvent) => void
): Promise<SynthesisPipelineResult> {
  const pipelineStartTime = Date.now()
  console.log(`[Pipeline ${PIPELINE_VERSION}] Starting for digest ${digestId}`)

  const errors: string[] = []

  try {
    // Get all items from digest (no cap)
    const items = await getDigestItems(digestId)

    onProgress({
      type: 'init',
      totalItems: items.length,
      message: `${items.length} Artikel gefunden, Scoring läuft...`,
    })

    // Score via Haiku and queue with progress
    const result = await scoreAndQueueItems(items, (phase, current, total, message) => {
      if (phase === 'scoring') {
        onProgress({
          type: 'scoring',
          currentItem: current,
          totalItems: total,
          message: `${current}/${total} Artikel bewertet...`,
        })
      } else {
        onProgress({
          type: 'scoring',
          currentItem: current,
          totalItems: total,
          message: message || `${current}/${total} Artikel zur Queue hinzugefügt...`,
        })
      }
    })

    const elapsed = Math.round((Date.now() - pipelineStartTime) / 1000)
    console.log(`[Pipeline ${PIPELINE_VERSION}] Complete in ${elapsed}s: ${result.scored} scored, ${result.added} queued, ${result.skipped} skipped, ${result.junkFiltered} junk`)

    onProgress({
      type: 'complete',
      totalItems: items.length,
      message: `Fertig: ${result.scored} bewertet, ${result.added} in der Queue, ${result.skipped} Duplikate, ${result.junkFiltered} Junk.`,
    })

    return {
      success: true,
      digestId,
      itemsProcessed: items.length,
      candidatesFound: result.added,
      synthesesDeveloped: 0,
      remainingSyntheses: 0,
      errors,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[Pipeline ${PIPELINE_VERSION}] Error:`, msg)
    errors.push(msg)
    onProgress({ type: 'error', error: msg })
    return {
      success: false,
      digestId,
      itemsProcessed: 0,
      candidatesFound: 0,
      synthesesDeveloped: 0,
      remainingSyntheses: 0,
      errors,
    }
  }
}
