/**
 * Synthesis Pipeline
 * Scores all digest items via Claude Haiku (SUBSTANZ/RELEVANZ/NEUHEIT)
 * and queues them to the news queue. No historical comparison.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { addToQueue } from '@/lib/news-queue'
import { isJunkTitle } from '@/lib/news-queue/service'
import { scoreContentOnly } from './score'
import type { DevelopedSynthesis } from './develop'

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

// Max items per Supabase .in() query to avoid payload limits
const SUPABASE_BATCH_SIZE = 200

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
    .select('digest_date, sources_used')
    .eq('id', digestId)
    .single()

  if (digestError || !digest) {
    throw new Error(`Digest not found: ${digestId}`)
  }

  let rawItems: Array<{ id: string; title: string; content: string; source_email: string | null; source_url: string | null }>

  if (digest.sources_used && digest.sources_used.length > 0) {
    console.log(`[Pipeline] Fetching ${digest.sources_used.length} sources from sources_used`)

    // Batch fetch to avoid Supabase payload limits
    const allItems: typeof rawItems = []
    const ids: string[] = digest.sources_used
    for (let i = 0; i < ids.length; i += SUPABASE_BATCH_SIZE) {
      const batch = ids.slice(i, i + SUPABASE_BATCH_SIZE)
      const { data, error } = await supabase
        .from('daily_repo')
        .select('id, title, content, source_email, source_url')
        .in('id', batch)

      if (error) throw error
      if (data) allItems.push(...data)
    }

    rawItems = allItems
  } else {
    // Fallback: get ALL items from that date
    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, title, content, source_email, source_url')
      .eq('newsletter_date', digest.digest_date)

    if (error) throw error
    rawItems = data || []
  }

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
  onProgress?: (phase: 'scoring' | 'queuing', current: number, total: number) => void
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
      concurrency: 10,
      onProgress: (scored, total) => {
        if (onProgress) {
          onProgress('scoring', scored, total)
        }
      },
    }
  )
  console.log(`[Pipeline] Scored ${scoreMap.size} items`)

  // Phase 1.5: Apply novelty penalty for topic deduplication
  const penaltiesApplied = applyNoveltyPenalty(validItems, scoreMap)
  if (penaltiesApplied > 0) {
    console.log(`[Pipeline] Applied ${penaltiesApplied} novelty penalties`)
  }

  // Phase 2: Queue all items with their real scores
  let totalAdded = 0
  let totalSkipped = 0
  const QUEUE_BATCH_SIZE = 50

  for (let i = 0; i < validItems.length; i += QUEUE_BATCH_SIZE) {
    const batch = validItems.slice(i, i + QUEUE_BATCH_SIZE)

    const queueItems = batch.map(item => {
      const scores = scoreMap.get(item.id)
      return {
        dailyRepoId: item.id,
        title: item.title,
        content: item.content || undefined,
        sourceEmail: item.source_email || undefined,
        sourceUrl: item.source_url || undefined,
        synthesisScore: scores?.synthesisScore ?? 5,
        relevanceScore: scores?.relevanceScore ?? 5,
        uniquenessScore: scores?.uniquenessScore ?? 5,
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
    const result = await scoreAndQueueItems(items, (phase, current, total) => {
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
          message: `${current}/${total} Artikel zur Queue hinzugefügt...`,
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
