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
    embedding: number[] | null
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
  const supabase = await createClient()

  // For each item, find and score similar items
  for (const item of itemsToProcess) {
    try {
      // Get or generate embedding
      let embedding = item.embedding
      if (!embedding || (Array.isArray(embedding) && embedding.length === 0)) {
        console.log(`[Pipeline] Generating embedding for "${item.title.slice(0, 30)}..."`)
        const text = prepareTextForEmbedding(item.title, item.content)
        embedding = await generateEmbedding(text)

        // Store the embedding for future use
        const embeddingString = `[${embedding.join(',')}]`
        await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)
      }

      // Find similar items
      const similarItems = await findSimilarItems(item.id, embedding as number[], {
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
