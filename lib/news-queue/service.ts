/**
 * News Queue Service
 * Handles queue management with source diversification
 */

import { createClient } from '@/lib/supabase/server'
import type {
  NewsQueueItem,
  NewsQueueItemInsert,
  NewsQueueSourceDistribution,
  NewsQueueSelectableItem,
  BalancedQueueSelection
} from '@/lib/supabase/types'

const SOURCE_LIMIT_PERCENTAGE = 0.30 // 30% max from any single source

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
  const supabase = await createClient()
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
  const supabase = await createClient()

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
  const supabase = await createClient()

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
 * Get selectable items (respecting 30% source limit)
 */
export async function getSelectableItems(): Promise<NewsQueueSelectableItem[]> {
  const supabase = await createClient()

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
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc('get_balanced_queue_selection', {
      max_items: maxItems,
      target_source_limit: SOURCE_LIMIT_PERCENTAGE
    })

  if (error) {
    console.error('[NewsQueue] Failed to get balanced selection:', error)
    return []
  }

  return data || []
}

/**
 * Select items for article generation
 * Marks items as 'selected' and returns them
 */
export async function selectItemsForArticle(
  itemIds: string[]
): Promise<{ items: NewsQueueItem[]; error?: string }> {
  const supabase = await createClient()

  // Verify source distribution before selection
  const { data: selectable } = await supabase
    .from('news_queue_selectable')
    .select('id, source_identifier, within_source_limit')
    .in('id', itemIds)

  const violations = selectable?.filter(item => !item.within_source_limit) || []
  if (violations.length > 0) {
    return {
      items: [],
      error: `Source limit violation: ${violations.map(v => v.source_identifier).join(', ')} would exceed 30%`
    }
  }

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
    return { items: [], error: error.message }
  }

  return { items: data || [] }
}

/**
 * Mark items as used (after article generation)
 */
export async function markItemsAsUsed(
  itemIds: string[],
  postId: string
): Promise<void> {
  const supabase = await createClient()

  await supabase
    .from('news_queue')
    .update({
      status: 'used',
      used_in_post_id: postId
    })
    .in('id', itemIds)
}

/**
 * Skip items with reason
 */
export async function skipItems(
  itemIds: string[],
  reason: string
): Promise<void> {
  const supabase = await createClient()

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
  const supabase = await createClient()

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
  const supabase = await createClient()

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
  const supabase = await createClient()

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
  const supabase = await createClient()

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
