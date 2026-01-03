/**
 * Synthesis Search Service
 * Finds semantically similar items in the daily_repo using pgvector
 */

import { createClient } from '@/lib/supabase/server'

export interface SimilarItem {
  id: string
  title: string
  content: string
  source_type: string
  source_email: string | null
  collected_at: string
  similarity: number
}

export interface SearchOptions {
  maxAge?: number // Days to look back (default: 90)
  limit?: number // Max results (default: 10)
  minSimilarity?: number // Minimum cosine similarity (default: 0.7)
}

/**
 * Find similar items in the daily_repo using vector similarity search
 * Uses the find_similar_items SQL function
 */
export async function findSimilarItems(
  itemId: string,
  embedding: number[] | string,
  options: SearchOptions = {}
): Promise<SimilarItem[]> {
  const { maxAge = 90, limit = 10, minSimilarity = 0.7 } = options

  const supabase = await createClient()

  // Convert embedding to pgvector format string if needed
  // The embedding can be either an array or a string (from database)
  const embeddingString = typeof embedding === 'string'
    ? embedding
    : `[${embedding.join(',')}]`

  const { data, error } = await supabase.rpc('find_similar_items', {
    query_embedding: embeddingString,
    item_id: itemId,
    max_age_days: maxAge,
    match_threshold: minSimilarity,
    match_count: limit,
  })

  if (error) {
    console.error('[Synthesis Search] Error:', error)
    throw new Error(`Similarity search failed: ${error.message}`)
  }

  return (data as SimilarItem[]) || []
}

/**
 * Find similar items for a text query (generates embedding on the fly)
 */
export async function findSimilarByText(
  text: string,
  options: SearchOptions = {}
): Promise<SimilarItem[]> {
  const { generateEmbedding } = await import('@/lib/embeddings/generator')

  const embedding = await generateEmbedding(text)

  // Use a dummy ID since we're searching by text, not by existing item
  const dummyId = '00000000-0000-0000-0000-000000000000'

  return findSimilarItems(dummyId, embedding, options)
}

/**
 * Get embedding for an existing daily_repo item
 */
export async function getItemEmbedding(itemId: string): Promise<number[] | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('daily_repo')
    .select('embedding')
    .eq('id', itemId)
    .single()

  if (error || !data?.embedding) {
    return null
  }

  // Parse the pgvector string format to array
  if (typeof data.embedding === 'string') {
    // Format: "[0.1, 0.2, ...]" or just "0.1,0.2,..."
    const cleaned = data.embedding.replace(/[\[\]]/g, '')
    return cleaned.split(',').map(Number)
  }

  return data.embedding as number[]
}

/**
 * Calculate days between two dates
 */
export function daysBetween(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Format similar item for display
 */
export function formatSimilarItem(item: SimilarItem): string {
  const daysAgo = daysBetween(new Date(), new Date(item.collected_at))
  return `[${daysAgo} Tage alt, ${(item.similarity * 100).toFixed(1)}% Ähnlichkeit] ${item.title}`
}
