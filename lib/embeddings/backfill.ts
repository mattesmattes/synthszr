/**
 * Embedding Backfill - Generate missing embeddings for daily_repo items
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding, prepareTextForEmbedding } from './generator'

export interface BackfillResult {
  processed: number
  errors: number
  remaining: number
}

export interface BackfillProgress {
  current: number
  total: number
  title?: string
}

/**
 * Generate embeddings for daily_repo items that don't have them
 *
 * @param batchSize - Number of items to process per batch
 * @param maxBatches - Maximum number of batches to process (0 = unlimited)
 * @param onProgress - Optional callback for progress updates
 */
export async function backfillMissingEmbeddings(
  batchSize: number = 50,
  maxBatches: number = 0,
  onProgress?: (progress: BackfillProgress) => void
): Promise<BackfillResult> {
  const supabase = createAdminClient()

  let totalProcessed = 0
  let totalErrors = 0
  let batchCount = 0

  // Count total missing embeddings first
  const { count: initialMissing } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)

  const totalToProcess = initialMissing || 0

  if (totalToProcess === 0) {
    return { processed: 0, errors: 0, remaining: 0 }
  }

  console.log(`[Embedding Backfill] Starting: ${totalToProcess} items missing embeddings`)

  while (true) {
    // Check batch limit
    if (maxBatches > 0 && batchCount >= maxBatches) {
      console.log(`[Embedding Backfill] Reached max batches limit (${maxBatches})`)
      break
    }

    // Fetch items without embeddings
    const { data: items, error: fetchError } = await supabase
      .from('daily_repo')
      .select('id, title, content')
      .is('embedding', null)
      .order('collected_at', { ascending: false })
      .limit(batchSize)

    if (fetchError) {
      console.error('[Embedding Backfill] Fetch error:', fetchError)
      break
    }

    if (!items || items.length === 0) {
      console.log('[Embedding Backfill] No more items to process')
      break
    }

    console.log(`[Embedding Backfill] Processing batch ${batchCount + 1} (${items.length} items)`)

    // Process items
    for (const item of items) {
      try {
        const text = prepareTextForEmbedding(item.title || '', item.content || '')

        if (text.length < 10) {
          console.log(`[Embedding Backfill] Skipping item ${item.id} - text too short`)
          continue
        }

        const embedding = await generateEmbedding(text)
        const embeddingString = `[${embedding.join(',')}]`

        const { error: updateError } = await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)

        if (updateError) {
          throw updateError
        }

        totalProcessed++

        // Report progress
        if (onProgress) {
          onProgress({
            current: totalProcessed,
            total: totalToProcess,
            title: item.title?.slice(0, 50)
          })
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (error) {
        console.error(`[Embedding Backfill] Error for item ${item.id}:`, error)
        totalErrors++
      }
    }

    batchCount++
  }

  // Count remaining
  const { count: remaining } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)

  console.log(`[Embedding Backfill] Complete: ${totalProcessed} processed, ${totalErrors} errors, ${remaining || 0} remaining`)

  return {
    processed: totalProcessed,
    errors: totalErrors,
    remaining: remaining || 0
  }
}
