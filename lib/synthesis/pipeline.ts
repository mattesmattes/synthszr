/**
 * Synthesis Pipeline
 * Orchestrates the full synthesis process: search → score → develop → store
 */

import { createClient } from '@/lib/supabase/server'
import { generateEmbedding, prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { findSimilarItems, getItemEmbedding, SimilarItem } from './search'
import { scoreSynthesisCandidates, getTopCandidates, ScoredCandidate } from './score'
import { developSyntheses, DevelopedSynthesis } from './develop'

export interface SynthesisPipelineResult {
  success: boolean
  digestId: string
  itemsProcessed: number
  candidatesFound: number
  synthesesDeveloped: number
  errors: string[]
}

export interface SynthesisProgressEvent {
  type: 'init' | 'searching' | 'scoring' | 'developing' | 'developed' | 'complete' | 'error'
  totalItems?: number
  currentItem?: number
  itemTitle?: string
  synthesis?: {
    headline: string
    content: string
    historicalReference: string
  }
  error?: string
}

export interface SynthesisPrompt {
  id: string
  name: string
  scoring_prompt: string
  development_prompt: string
  core_thesis: string
}

/**
 * Get the active synthesis prompt from the database
 */
async function getActiveSynthesisPrompt(): Promise<SynthesisPrompt | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('synthesis_prompts')
    .select('*')
    .eq('is_active', true)
    .single()

  if (error || !data) {
    console.error('[Pipeline] No active synthesis prompt found')
    return null
  }

  return data as SynthesisPrompt
}

/**
 * Get daily_repo items associated with a digest
 */
async function getDigestItems(digestId: string): Promise<
  Array<{
    id: string
    title: string
    content: string
    embedding: string | number[] | null  // Can be string from DB, array if newly generated, or null
  }>
> {
  const supabase = await createClient()

  // Get the digest to find its date
  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('digest_date, sources_used')
    .eq('id', digestId)
    .single()

  if (digestError || !digest) {
    throw new Error(`Digest not found: ${digestId}`)
  }

  // If sources_used is available, use those specific items
  if (digest.sources_used && digest.sources_used.length > 0) {
    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, title, content, embedding')
      .in('id', digest.sources_used)

    if (error) throw error
    return data || []
  }

  // Otherwise, get items from that date
  const { data, error } = await supabase
    .from('daily_repo')
    .select('id, title, content, embedding')
    .eq('newsletter_date', digest.digest_date)

  if (error) throw error
  return data || []
}

/**
 * Store synthesis candidates in the database
 */
async function storeCandidates(
  digestId: string,
  candidates: ScoredCandidate[]
): Promise<void> {
  if (candidates.length === 0) return

  const supabase = await createClient()

  const records = candidates.map((c) => ({
    source_item_id: c.sourceItem.id,
    related_item_id: c.relatedItem.id,
    similarity_score: c.similarityScore,
    synthesis_type: c.synthesisType,
    originality_score: c.originalityScore,
    relevance_score: c.relevanceScore,
    reasoning: c.reasoning,
    digest_id: digestId,
  }))

  const { error } = await supabase.from('synthesis_candidates').upsert(records, {
    onConflict: 'source_item_id,related_item_id,digest_id',
  })

  if (error) {
    console.error('[Pipeline] Failed to store candidates:', error)
  }
}

/**
 * Store developed syntheses in the database
 */
async function storeSyntheses(
  digestId: string,
  syntheses: Map<string, DevelopedSynthesis>,
  candidateIds: Map<string, string>
): Promise<void> {
  if (syntheses.size === 0) return

  const supabase = await createClient()

  const records = Array.from(syntheses.entries()).map(([key, synthesis]) => ({
    candidate_id: candidateIds.get(key) || null,
    digest_id: digestId,
    synthesis_content: synthesis.content,
    synthesis_headline: synthesis.headline,
    historical_reference: synthesis.historicalReference,
    core_thesis_alignment: synthesis.coreThesisAlignment,
  }))

  const { error } = await supabase.from('developed_syntheses').insert(records)

  if (error) {
    console.error('[Pipeline] Failed to store syntheses:', error)
  }
}

/**
 * Run the full synthesis pipeline for a digest
 * Creates exactly ONE synthesis per article (the highest scoring one)
 */
export async function runSynthesisPipeline(
  digestId: string,
  options: {
    maxItemsToProcess?: number
    maxCandidatesPerItem?: number
    minSimilarity?: number
    maxAgeDays?: number
  } = {}
): Promise<SynthesisPipelineResult> {
  const {
    maxItemsToProcess = 50, // Process all items by default
    maxCandidatesPerItem = 5,
    minSimilarity = 0.65, // Slightly lower threshold to find more candidates
    maxAgeDays = 90,
  } = options

  const errors: string[] = []
  let candidatesFound = 0
  let synthesesDeveloped = 0

  console.log(`[Pipeline] Starting synthesis pipeline for digest ${digestId}`)

  const supabase = await createClient()

  // Clean up any existing syntheses/candidates for this digest (prevents duplicates on re-run)
  await supabase.from('developed_syntheses').delete().eq('digest_id', digestId)
  await supabase.from('synthesis_candidates').delete().eq('digest_id', digestId)
  console.log(`[Pipeline] Cleaned up existing data for digest ${digestId}`)

  // Get active synthesis prompt
  const prompt = await getActiveSynthesisPrompt()
  if (!prompt) {
    return {
      success: false,
      digestId,
      itemsProcessed: 0,
      candidatesFound: 0,
      synthesesDeveloped: 0,
      errors: ['No active synthesis prompt found'],
    }
  }

  // Get items from the digest
  const items = await getDigestItems(digestId)
  const itemsToProcess = items.slice(0, maxItemsToProcess)

  console.log(`[Pipeline] Processing ${itemsToProcess.length} items`)

  const allCandidates: ScoredCandidate[] = []

  // For each item, find and score similar items
  for (const item of itemsToProcess) {
    try {
      // Get or generate embedding
      // Embedding can be a string (from DB) or array (newly generated) or null
      let embedding: string | number[] | null = item.embedding
      const hasValidEmbedding = embedding && (
        (typeof embedding === 'string' && embedding.length > 10) ||
        (Array.isArray(embedding) && embedding.length > 0)
      )

      if (!hasValidEmbedding) {
        console.log(`[Pipeline] Generating embedding for "${item.title.slice(0, 30)}..."`)
        const text = prepareTextForEmbedding(item.title, item.content)
        const newEmbedding = await generateEmbedding(text)

        // Store the embedding for future use
        const embeddingString = `[${newEmbedding.join(',')}]`
        await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)

        embedding = embeddingString
      }

      // Find similar items (embedding is now guaranteed to be a valid string or array)
      const similarItems = await findSimilarItems(item.id, embedding as string | number[], {
        maxAge: maxAgeDays,
        limit: maxCandidatesPerItem * 2, // Get extra for filtering
        minSimilarity,
      })

      if (similarItems.length === 0) {
        console.log(`[Pipeline] No similar items found for "${item.title.slice(0, 30)}..."`)
        continue
      }

      console.log(`[Pipeline] Found ${similarItems.length} similar items for "${item.title.slice(0, 30)}..."`)

      // Score candidates
      const scoredCandidates = await scoreSynthesisCandidates(
        { id: item.id, title: item.title, content: item.content },
        similarItems,
        prompt.scoring_prompt,
        { minTotalScore: 12 }
      )

      // Get the BEST candidate for this item (exactly 1)
      if (scoredCandidates.length > 0) {
        const bestCandidate = scoredCandidates[0] // Already sorted by score
        allCandidates.push(bestCandidate)
        candidatesFound++
        console.log(`[Pipeline] Best candidate score: ${bestCandidate.totalScore} (${bestCandidate.synthesisType})`)
      } else {
        console.log(`[Pipeline] No candidates passed scoring threshold`)
      }
    } catch (error) {
      const msg = `Error processing item ${item.id}: ${error}`
      console.error(`[Pipeline] ${msg}`)
      errors.push(msg)
    }
  }

  // Store all candidates
  await storeCandidates(digestId, allCandidates)

  // allCandidates now contains exactly 1 candidate per item (the best one)
  if (allCandidates.length === 0) {
    console.log('[Pipeline] No candidates to develop')
    return {
      success: true,
      digestId,
      itemsProcessed: itemsToProcess.length,
      candidatesFound,
      synthesesDeveloped: 0,
      errors,
    }
  }

  console.log(`[Pipeline] Developing ${allCandidates.length} syntheses with Claude Opus (1 per article)`)

  // Develop syntheses for ALL candidates (one per article)
  const syntheses = await developSyntheses(
    allCandidates,
    prompt.development_prompt,
    prompt.core_thesis,
    { maxSyntheses: allCandidates.length } // No limit - process all
  )

  synthesesDeveloped = syntheses.size

  // Get candidate IDs for linking (we need to query them from DB after insert)
  const { data: storedCandidates } = await supabase
    .from('synthesis_candidates')
    .select('id, source_item_id, related_item_id')
    .eq('digest_id', digestId)

  const candidateIdMap = new Map<string, string>()
  if (storedCandidates) {
    for (const c of storedCandidates) {
      candidateIdMap.set(`${c.source_item_id}-${c.related_item_id}`, c.id)
    }
  }

  // Store syntheses
  await storeSyntheses(digestId, syntheses, candidateIdMap)

  console.log(`[Pipeline] Synthesis pipeline complete: ${synthesesDeveloped} syntheses developed`)

  return {
    success: true,
    digestId,
    itemsProcessed: itemsToProcess.length,
    candidatesFound,
    synthesesDeveloped,
    errors,
  }
}

/**
 * Get developed syntheses for a digest
 */
export async function getSynthesesForDigest(
  digestId: string
): Promise<DevelopedSynthesis[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('developed_syntheses')
    .select('*')
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
  }))
}

/**
 * Run the synthesis pipeline with progress callbacks for streaming UI
 */
export async function runSynthesisPipelineWithProgress(
  digestId: string,
  options: {
    maxItemsToProcess?: number
    maxCandidatesPerItem?: number
    minSimilarity?: number
    maxAgeDays?: number
  } = {},
  onProgress: (event: SynthesisProgressEvent) => void
): Promise<SynthesisPipelineResult> {
  const {
    maxItemsToProcess = 50,
    maxCandidatesPerItem = 5,
    minSimilarity = 0.65,
    maxAgeDays = 90,
  } = options

  const errors: string[] = []
  let candidatesFound = 0
  let synthesesDeveloped = 0

  console.log(`[Pipeline] Starting streaming synthesis pipeline for digest ${digestId}`)

  const supabase = await createClient()

  // Clean up any existing syntheses/candidates for this digest (prevents duplicates on re-run)
  await supabase.from('developed_syntheses').delete().eq('digest_id', digestId)
  await supabase.from('synthesis_candidates').delete().eq('digest_id', digestId)
  console.log(`[Pipeline] Cleaned up existing data for digest ${digestId}`)

  // Get active synthesis prompt
  const prompt = await getActiveSynthesisPrompt()
  if (!prompt) {
    onProgress({ type: 'error', error: 'Kein aktiver Synthese-Prompt gefunden' })
    return {
      success: false,
      digestId,
      itemsProcessed: 0,
      candidatesFound: 0,
      synthesesDeveloped: 0,
      errors: ['No active synthesis prompt found'],
    }
  }

  // Get items from the digest
  const items = await getDigestItems(digestId)
  const itemsToProcess = items.slice(0, maxItemsToProcess)

  onProgress({
    type: 'init',
    totalItems: itemsToProcess.length,
  })

  const allCandidates: ScoredCandidate[] = []

  // Phase 1: Search and score for each item
  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i]

    onProgress({
      type: 'searching',
      currentItem: i + 1,
      totalItems: itemsToProcess.length,
      itemTitle: item.title,
    })

    try {
      // Get or generate embedding
      // Embedding can be a string (from DB) or array (newly generated) or null
      let embedding: string | number[] | null = item.embedding
      const hasValidEmbedding = embedding && (
        (typeof embedding === 'string' && embedding.length > 10) ||
        (Array.isArray(embedding) && embedding.length > 0)
      )

      if (!hasValidEmbedding) {
        const text = prepareTextForEmbedding(item.title, item.content)
        const newEmbedding = await generateEmbedding(text)

        const embeddingString = `[${newEmbedding.join(',')}]`
        await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)

        embedding = embeddingString
      }

      // Find similar items (embedding is now guaranteed to be a valid string or array)
      const similarItems = await findSimilarItems(item.id, embedding as string | number[], {
        maxAge: maxAgeDays,
        limit: maxCandidatesPerItem * 2,
        minSimilarity,
      })

      if (similarItems.length === 0) {
        continue
      }

      onProgress({
        type: 'scoring',
        currentItem: i + 1,
        totalItems: itemsToProcess.length,
        itemTitle: item.title,
      })

      // Score candidates
      const scoredCandidates = await scoreSynthesisCandidates(
        { id: item.id, title: item.title, content: item.content },
        similarItems,
        prompt.scoring_prompt,
        { minTotalScore: 12 }
      )

      // Get the BEST candidate for this item
      if (scoredCandidates.length > 0) {
        const bestCandidate = scoredCandidates[0]
        allCandidates.push(bestCandidate)
        candidatesFound++
      }
    } catch (error) {
      const msg = `Error processing item ${item.id}: ${error}`
      console.error(`[Pipeline] ${msg}`)
      errors.push(msg)
    }
  }

  // Store all candidates
  await storeCandidates(digestId, allCandidates)

  if (allCandidates.length === 0) {
    return {
      success: true,
      digestId,
      itemsProcessed: itemsToProcess.length,
      candidatesFound,
      synthesesDeveloped: 0,
      errors,
    }
  }

  // Phase 2: Develop syntheses in parallel batches with progress updates
  const synthesesMap = new Map<string, DevelopedSynthesis>()
  const BATCH_SIZE = 3 // Process 3 at a time to balance speed vs rate limits
  const TIMEOUT_MS = 30000 // 30 second timeout per synthesis

  // Helper: timeout wrapper that guarantees we don't hang
  const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => {
        console.log(`[Pipeline] Timeout after ${ms}ms, using fallback`)
        resolve(fallback)
      }, ms))
    ])
  }

  const { developSynthesis } = await import('./develop')

  // Process in batches of BATCH_SIZE
  for (let batchStart = 0; batchStart < allCandidates.length; batchStart += BATCH_SIZE) {
    const batch = allCandidates.slice(batchStart, batchStart + BATCH_SIZE)

    // Show progress for batch start
    onProgress({
      type: 'developing',
      currentItem: batchStart + 1,
      totalItems: allCandidates.length,
      itemTitle: `Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.map(c => c.sourceItem.title.slice(0, 20)).join(', ')}...`,
    })

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (candidate, batchIndex) => {
        const globalIndex = batchStart + batchIndex

        try {
          // Fallback synthesis if timeout occurs
          const fallbackSynthesis: DevelopedSynthesis = {
            headline: `Verbindung: ${candidate.synthesisType}`,
            content: `Historische Verbindung zu "${candidate.relatedItem.title.slice(0, 50)}..." (Timeout)`,
            historicalReference: candidate.relatedItem.title,
            coreThesisAlignment: 0,
          }

          // 30-second timeout per synthesis
          const synthesis = await withTimeout(
            developSynthesis(candidate, prompt.development_prompt, prompt.core_thesis),
            TIMEOUT_MS,
            fallbackSynthesis
          )

          return { candidate, synthesis, globalIndex, success: true }
        } catch (error) {
          console.error(`[Pipeline] Failed to develop synthesis:`, error)
          errors.push(`Failed to develop synthesis for ${candidate.sourceItem.title}`)
          return { candidate, synthesis: null, globalIndex, success: false }
        }
      })
    )

    // Process results and send progress updates
    for (const result of batchResults) {
      if (result.success && result.synthesis) {
        const key = `${result.candidate.sourceItem.id}-${result.candidate.relatedItem.id}`
        synthesesMap.set(key, {
          ...result.synthesis,
          candidateId: key,
        })

        synthesesDeveloped++

        // Send the developed synthesis to the client
        onProgress({
          type: 'developed',
          currentItem: result.globalIndex + 1,
          totalItems: allCandidates.length,
          itemTitle: result.candidate.sourceItem.title,
          synthesis: {
            headline: result.synthesis.headline,
            content: result.synthesis.content,
            historicalReference: result.synthesis.historicalReference,
          },
        })
      }
    }

    // Small delay between batches to respect rate limits
    if (batchStart + BATCH_SIZE < allCandidates.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // Get candidate IDs for linking
  const { data: storedCandidates } = await supabase
    .from('synthesis_candidates')
    .select('id, source_item_id, related_item_id')
    .eq('digest_id', digestId)

  const candidateIdMap = new Map<string, string>()
  if (storedCandidates) {
    for (const c of storedCandidates) {
      candidateIdMap.set(`${c.source_item_id}-${c.related_item_id}`, c.id)
    }
  }

  // Store syntheses
  await storeSyntheses(digestId, synthesesMap, candidateIdMap)

  return {
    success: true,
    digestId,
    itemsProcessed: itemsToProcess.length,
    candidatesFound,
    synthesesDeveloped,
    errors,
  }
}
