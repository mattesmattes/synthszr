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

const SOURCE_LIMIT_PERCENTAGE = 0.35 // 35% max from any single source

/**
 * Extract normalized source identifier from email
 * e.g., "Newsletter Name <email@domain.com>" → "email@domain.com"
 */
export function normalizeSourceIdentifier(email: string | null, url: string | null): string {
  if (email) {
    // Extract email address from format like "Name <email@domain.com>"
    const match = email.match(/<([^>]+)>/)
    if (match) return match[1].toLowerCase()
    // If no angle brackets, treat whole string as email
    if (email.includes('@')) return email.toLowerCase().trim()
  }

  if (url) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '')
      return hostname
    } catch {
      // Invalid URL
    }
  }

  return 'unknown'
}

/**
 * Extract human-readable source name from email
 */
export function extractSourceDisplayName(email: string | null): string | null {
  if (!email) return null

  // Extract name from "Newsletter Name <email@domain.com>" format
  const match = email.match(/^"?([^"<]+)"?\s*</)
  if (match) {
    const name = match[1].trim()
    if (!name.includes('@') && name.length > 0) {
      return name
    }
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
    synthesisScore?: number
    relevanceScore?: number
    uniquenessScore?: number
    metadata?: Record<string, unknown>
  }>
): Promise<{ added: number; skipped: number; errors: string[] }> {
  const supabase = createAdminClient()
  const errors: string[] = []
  let added = 0
  let skipped = 0

  for (const item of items) {
    try {
      const sourceIdentifier = normalizeSourceIdentifier(item.sourceEmail ?? null, item.sourceUrl ?? null)
      const sourceDisplayName = extractSourceDisplayName(item.sourceEmail ?? null)

      const record: NewsQueueItemInsert = {
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
        metadata: item.metadata || {}
      }

      const { error } = await supabase.from('news_queue').insert(record)

      if (error) {
        if (error.code === '23505') {
          // Duplicate - item already in queue
          skipped++
        } else {
          errors.push(`Failed to add "${item.title.slice(0, 30)}...": ${error.message}`)
        }
      } else {
        added++
      }
    } catch (err) {
      errors.push(`Error processing "${item.title.slice(0, 30)}...": ${err}`)
    }
  }

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
    .select('id, title, content, source_email, source_url')
    .in('id', repoItemIds)

  if (error || !repoItems) {
    return { added: 0, skipped: 0, errors: [`Failed to fetch items: ${error?.message}`] }
  }

  const items = repoItems.map(item => ({
    dailyRepoId: item.id,
    title: item.title || 'Untitled',
    content: item.content || undefined,
    sourceEmail: item.source_email,
    sourceUrl: item.source_url,
  }))

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
 */
export async function getBalancedSelection(
  maxItems: number = 10
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
    return []
  }

  console.log(`[NewsQueue] get_balanced_queue_selection returned ${data?.length || 0} items`)
  if (data && data.length > 0) {
    // Log source distribution
    const sources: Record<string, number> = {}
    for (const item of data) {
      sources[item.source_identifier] = (sources[item.source_identifier] || 0) + 1
    }
    console.log(`[NewsQueue] Balanced selection sources:`, sources)
  }

  return data || []
}

/**
 * Get items that have been manually selected (status='selected')
 * These are items the user explicitly chose for article generation
 *
 * IMPORTANT: Excludes items that are already used in published posts
 * This handles the case where items were used but not properly marked as 'used'
 */
export async function getSelectedItems(): Promise<NewsQueueItem[]> {
  const supabase = createAdminClient()

  // First, get all selected items
  const { data: selectedItems, error } = await supabase
    .from('news_queue')
    .select('*')
    .eq('status', 'selected')
    .order('total_score', { ascending: false })

  if (error) {
    console.error('[NewsQueue] Failed to get selected items:', error)
    return []
  }

  if (!selectedItems || selectedItems.length === 0) {
    return []
  }

  // Check which items are already used in published posts
  // This handles the case where markItemsAsUsed wasn't called properly
  const { data: publishedPosts } = await supabase
    .from('generated_posts')
    .select('pending_queue_item_ids')
    .eq('status', 'published')
    .not('pending_queue_item_ids', 'is', null)

  // Build a set of item IDs that are in published posts
  const usedInPublishedPosts = new Set<string>()
  if (publishedPosts) {
    for (const post of publishedPosts) {
      const itemIds = post.pending_queue_item_ids as string[] | null
      if (itemIds && Array.isArray(itemIds)) {
        for (const id of itemIds) {
          usedInPublishedPosts.add(id)
        }
      }
    }
  }

  // Filter out items that are already in published posts
  const availableItems = selectedItems.filter(item => !usedInPublishedPosts.has(item.id))

  if (availableItems.length < selectedItems.length) {
    const excluded = selectedItems.length - availableItems.length
    console.log(`[NewsQueue] Excluded ${excluded} selected items (already in published posts)`)

    // Auto-fix: Mark these items as 'used' since they're in published posts
    const itemsToMarkUsed = selectedItems.filter(item => usedInPublishedPosts.has(item.id))
    if (itemsToMarkUsed.length > 0) {
      console.log(`[NewsQueue] Auto-fixing ${itemsToMarkUsed.length} items: marking as 'used'`)
      await supabase
        .from('news_queue')
        .update({ status: 'used' })
        .in('id', itemsToMarkUsed.map(i => i.id))
    }
  }

  return availableItems
}

/**
 * Select items for article generation
 * Marks items as 'selected' and returns them
 * Note: Source limit validation is handled by getBalancedSelection() algorithm
 */
export async function selectItemsForArticle(
  itemIds: string[]
): Promise<{ items: NewsQueueItem[]; error?: string }> {
  const supabase = createAdminClient()

  console.log(`[NewsQueue] selectItemsForArticle called with ${itemIds.length} item IDs`)

  // Note: We no longer validate source limits here because:
  // 1. getBalancedSelection() already handles this intelligently (35% rule after 4 items)
  // 2. Manual selection explicitly chooses items regardless of source
  // The previous check against news_queue_selectable was too restrictive for small queues

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

  return { items: data || [] }
}

/**
 * Mark items as used (after article generation)
 * Returns the count of items actually updated
 */
export async function markItemsAsUsed(
  itemIds: string[],
  postId: string
): Promise<{ updated: number; error?: string }> {
  if (!itemIds || itemIds.length === 0) {
    console.log('[NewsQueue] markItemsAsUsed called with empty itemIds')
    return { updated: 0 }
  }

  console.log(`[NewsQueue] Marking ${itemIds.length} items as used for post ${postId}`)
  console.log('[NewsQueue] Item IDs:', itemIds.slice(0, 5).join(', '), itemIds.length > 5 ? `... and ${itemIds.length - 5} more` : '')

  const supabase = createAdminClient()

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

  return { updated: updatedCount }
}

/**
 * Skip items with reason
 */
export async function skipItems(
  itemIds: string[],
  reason: string
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('news_queue')
    .update({
      status: 'skipped',
      skip_reason: reason
    })
    .in('id', itemIds)
}

/**
 * Expire old queue items (called by cron)
 */
export async function expireOldItems(): Promise<number> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('expire_old_queue_items')

  if (error) {
    console.error('[NewsQueue] Failed to expire items:', error)
    return 0
  }

  return data || 0
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number
  selected: number
  used: number
  expired: number
  skipped: number
  total: number
}> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue')
    .select('status')
    .gte('queued_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())

  if (error || !data) {
    return { pending: 0, selected: 0, used: 0, expired: 0, skipped: 0, total: 0 }
  }

  const stats = {
    pending: 0,
    selected: 0,
    used: 0,
    expired: 0,
    skipped: 0,
    total: data.length
  }

  for (const item of data) {
    const status = item.status as keyof typeof stats
    if (status in stats) {
      stats[status]++
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
 */
export async function resetSelectedToPending(): Promise<number> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'pending',
      selected_at: null
    })
    .eq('status', 'selected')
    .select('id')

  if (error) {
    console.error('[NewsQueue] Failed to reset selected items:', error)
    return 0
  }

  console.log(`[NewsQueue] Reset ${data?.length || 0} selected items to pending`)
  return data?.length || 0
}

/**
 * Reset stuck "selected" items back to pending
 * Items that were selected but not used within maxHours are reset
 * This prevents items from being stuck forever if a draft is abandoned
 */
export async function resetStuckSelectedItems(maxHours: number = 24): Promise<number> {
  const supabase = createAdminClient()

  const cutoffTime = new Date(Date.now() - maxHours * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('news_queue')
    .update({
      status: 'pending',
      selected_at: null
    })
    .eq('status', 'selected')
    .lt('selected_at', cutoffTime)
    .select('id')

  if (error) {
    console.error('[NewsQueue] Failed to reset stuck selected items:', error)
    return 0
  }

  if (data && data.length > 0) {
    console.log(`[NewsQueue] Reset ${data.length} stuck selected items (older than ${maxHours}h) to pending`)
  }

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
    const result = await markItemsAsUsed(itemIds, post.id)
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
