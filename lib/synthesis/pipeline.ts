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
 * If sources_used is empty, try to match items by title from the digest content
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

  // Get the digest to find its date and content
  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('digest_date, sources_used, analysis_content')
    .eq('id', digestId)
    .single()

  if (digestError || !digest) {
    throw new Error(`Digest not found: ${digestId}`)
  }

  // If sources_used is available, use those specific items
  if (digest.sources_used && digest.sources_used.length > 0) {
    console.log(`[Pipeline] Using ${digest.sources_used.length} sources from sources_used`)
    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, title, content, embedding')
      .in('id', digest.sources_used)

    if (error) throw error
    if (!data) return []

    // Deduplicate by title even for sources_used (in case duplicates were stored)
    const seenTitles = new Set<string>()
    const uniqueItems = data.filter(item => {
      const normalizedTitle = item.title.trim().toLowerCase().slice(0, 100)
      if (seenTitles.has(normalizedTitle)) {
        console.log(`[Pipeline] Skipping duplicate in sources_used: "${item.title.slice(0, 40)}..."`)
        return false
      }
      seenTitles.add(normalizedTitle)
      return true
    })

    console.log(`[Pipeline] After deduplication: ${uniqueItems.length} unique items (from ${data.length} sources_used)`)
    return uniqueItems
  }

  // Otherwise, get ALL items from that date and filter by which appear in digest content
  const { data: allItems, error } = await supabase
    .from('daily_repo')
    .select('id, title, content, embedding')
    .eq('newsletter_date', digest.digest_date)

  if (error) throw error
  if (!allItems || allItems.length === 0) return []

  // Filter to only items whose titles appear in the digest content
  const digestContent = digest.analysis_content || ''
  const matchedItems = allItems.filter(item => {
    // Check if the first 50 chars of title appear in digest
    const titleSnippet = item.title.slice(0, 50)
    return digestContent.includes(titleSnippet)
  })

  console.log(`[Pipeline] Matched ${matchedItems.length} items from digest content (of ${allItems.length} total for date)`)

  // Deduplicate by title - keep only the FIRST item per unique title
  // This fixes the issue where the same article is imported multiple times with different IDs
  const seenTitles = new Set<string>()
  const uniqueItems = matchedItems.filter(item => {
    // Normalize title for comparison (trim, lowercase first 100 chars)
    const normalizedTitle = item.title.trim().toLowerCase().slice(0, 100)
    if (seenTitles.has(normalizedTitle)) {
      console.log(`[Pipeline] Skipping duplicate: "${item.title.slice(0, 40)}..."`)
      return false
    }
    seenTitles.add(normalizedTitle)
    return true
  })

  console.log(`[Pipeline] After deduplication: ${uniqueItems.length} unique items (removed ${matchedItems.length - uniqueItems.length} duplicates)`)

  // If no matches found, fall back to all items but limit to 10 (also deduplicated)
  if (uniqueItems.length === 0) {
    console.log(`[Pipeline] No title matches, using first 10 unique items`)
    const seenFallback = new Set<string>()
    const uniqueFallback = allItems.filter(item => {
      const normalizedTitle = item.title.trim().toLowerCase().slice(0, 100)
      if (seenFallback.has(normalizedTitle)) return false
      seenFallback.add(normalizedTitle)
      return true
    })
    return uniqueFallback.slice(0, 10)
  }

  return uniqueItems
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
    maxItemsToProcess = 50, // No limit needed - continuation handles time constraints // Process all items by default
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
 * Get developed syntheses for a digest, including the source article title
 */
export async function getSynthesesForDigest(
  digestId: string
): Promise<DevelopedSynthesis[]> {
  const supabase = await createClient()

  // Join through synthesis_candidates to get source_item_id, then to daily_repo for title
  const { data, error } = await supabase
    .from('developed_syntheses')
    .select(`
      *,
      synthesis_candidates!inner(
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
    // Extract source article title from the joined data
    sourceArticleTitle: s.synthesis_candidates?.daily_repo?.title || null,
  }))
}

/**
 * Run the synthesis pipeline with progress callbacks for streaming UI
 */
// Pipeline version for deployment verification
const PIPELINE_VERSION = 'v10-auto-batch'

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
  console.log(`[Pipeline ${PIPELINE_VERSION}] Starting for digest ${digestId}`)

  const {
    maxItemsToProcess = 50, // No limit needed - continuation handles time constraints
    maxCandidatesPerItem = 5,
    minSimilarity = 0.65,
    maxAgeDays = 90,
  } = options

  const errors: string[] = []
  let candidatesFound = 0
  let synthesesDeveloped = 0

  console.log(`[Pipeline] Starting streaming synthesis pipeline for digest ${digestId}`)

  const supabase = await createClient()

  // NOTE: We do NOT delete existing syntheses to support continuation
  // The pipeline will skip items that already have syntheses
  // Only delete synthesis_candidates to regenerate them fresh
  await supabase.from('synthesis_candidates').delete().eq('digest_id', digestId)
  console.log(`[Pipeline] Continuation mode: keeping existing syntheses, regenerating candidates`)

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

  // Phase 2: Develop syntheses ONE BY ONE - no parallelization
  const synthesesMap = new Map<string, DevelopedSynthesis>()
  const PIPELINE_TIMEOUT_MS = 250000 // 250 seconds - leave 50s buffer before Vercel's 300s limit
  const pipelineStartTime = Date.now()

  // Direct import, no dynamic import
  const { developSynthesis } = await import('./develop')

  // Check which items already have syntheses (for continuation)
  const { data: existingSyntheses } = await supabase
    .from('developed_syntheses')
    .select('candidate_id, synthesis_candidates!inner(source_item_id)')
    .eq('digest_id', digestId)

  const processedSourceIds = new Set<string>()
  if (existingSyntheses) {
    for (const s of existingSyntheses) {
      const candidate = s.synthesis_candidates as { source_item_id: string } | null
      if (candidate?.source_item_id) {
        processedSourceIds.add(candidate.source_item_id)
      }
    }
  }

  // Filter out already processed items
  const remainingCandidates = allCandidates.filter(
    c => !processedSourceIds.has(c.sourceItem.id)
  )

  const skippedCount = allCandidates.length - remainingCandidates.length
  if (skippedCount > 0) {
    console.log(`[Pipeline] Skipping ${skippedCount} already processed items`)
  }

  console.log(`[Pipeline ${PIPELINE_VERSION}] Phase 2: Processing ${remainingCandidates.length} items sequentially (${skippedCount} already done)`)

  // Simple sequential loop - NO Promise.all, NO batching
  let stoppedDueToTimeout = false
  for (let i = 0; i < remainingCandidates.length; i++) {
    const candidate = remainingCandidates[i]

    // Check global timeout - stop with enough buffer to save results
    const elapsed = Date.now() - pipelineStartTime
    if (elapsed > PIPELINE_TIMEOUT_MS) {
      const remaining = remainingCandidates.length - i
      console.log(`[Pipeline] Time limit reached after ${elapsed}ms - ${remaining} items remaining`)
      stoppedDueToTimeout = true
      onProgress({
        type: 'partial',
        message: `Zeit-Limit erreicht. ${synthesesDeveloped} Synthesen erstellt, ${remaining} verbleibend. Starte erneut für Rest.`,
      })
      break
    }

    // Show progress (include skipped count in total)
    const overallProgress = skippedCount + i + 1
    const overallTotal = skippedCount + remainingCandidates.length
    onProgress({
      type: 'developing',
      currentItem: overallProgress,
      totalItems: overallTotal,
      itemTitle: candidate.sourceItem.title.slice(0, 50),
    })

    console.log(`[Pipeline] Item ${i + 1}/${remainingCandidates.length}: Starting "${candidate.sourceItem.title.slice(0, 40)}..."`)
    const itemStartTime = Date.now()

    try {
      // Simple await - no Promise.all, no Promise.race wrapper here
      const synthesis = await developSynthesis(
        candidate,
        prompt.development_prompt,
        prompt.core_thesis
      )

      const itemElapsed = Date.now() - itemStartTime
      console.log(`[Pipeline] Item ${i + 1}: Completed in ${itemElapsed}ms`)

      // Store result
      const key = `${candidate.sourceItem.id}-${candidate.relatedItem.id}`
      synthesesMap.set(key, {
        ...synthesis,
        candidateId: key,
      })
      synthesesDeveloped++

      // Send progress
      onProgress({
        type: 'developed',
        currentItem: overallProgress,
        totalItems: overallTotal,
        itemTitle: candidate.sourceItem.title,
        synthesis: {
          headline: synthesis.headline,
          content: synthesis.content,
          historicalReference: synthesis.historicalReference,
        },
      })
    } catch (error) {
      const itemElapsed = Date.now() - itemStartTime
      console.error(`[Pipeline] Item ${i + 1}: Failed after ${itemElapsed}ms:`, error)
      errors.push(`Failed: ${candidate.sourceItem.title}`)
    }

    // Small delay between items
    if (i < remainingCandidates.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300))
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
