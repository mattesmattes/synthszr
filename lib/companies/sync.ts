/**
 * Company Sync - Syncs company mentions to post_company_mentions table
 *
 * Called after a post is saved/published to update the company-post relationships.
 * Now tracks article-level mentions (which H2 section each company appears in).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { extractCompaniesPerArticle, parseTipTapContent } from './extractor'

export interface SyncResult {
  success: boolean
  companiesFound: number
  articlesWithCompanies: number
  error?: string
}

/**
 * Sync company mentions for a single post
 *
 * Extracts companies from TipTap content at article level (H2 sections)
 * and updates post_company_mentions table with article details.
 * Uses delete + insert pattern to handle company removals.
 *
 * @param postId - The UUID of the generated post
 * @param content - TipTap content as string or object
 * @param queueItemIds - Optional array of queue item IDs for stable article references
 */
export async function syncPostCompanyMentions(
  postId: string,
  content: string | object,
  queueItemIds?: string[]
): Promise<SyncResult> {
  try {
    const supabase = createAdminClient()

    // Parse content if string
    const parsedContent = parseTipTapContent(content)
    if (!parsedContent) {
      return { success: false, companiesFound: 0, articlesWithCompanies: 0, error: 'Invalid content format' }
    }

    // Extract companies per article from content
    const mentions = extractCompaniesPerArticle(parsedContent, queueItemIds)

    // Delete existing mentions for this post
    const { error: deleteError } = await supabase
      .from('post_company_mentions')
      .delete()
      .eq('post_id', postId)

    if (deleteError) {
      console.error('[sync-companies] Delete error:', deleteError)
      return { success: false, companiesFound: 0, articlesWithCompanies: 0, error: deleteError.message }
    }

    // Insert new mentions (if any)
    if (mentions.length > 0) {
      const insertData = mentions.map(mention => ({
        post_id: postId,
        company_name: mention.company.name,
        company_slug: mention.company.slug,
        company_type: mention.company.type,
        article_index: mention.articleIndex,
        article_queue_item_id: mention.articleQueueItemId || null,
        article_headline: mention.articleHeadline,
        article_excerpt: mention.articleExcerpt,
      }))

      const { error: insertError } = await supabase
        .from('post_company_mentions')
        .insert(insertData)

      if (insertError) {
        console.error('[sync-companies] Insert error:', insertError)
        return { success: false, companiesFound: mentions.length, articlesWithCompanies: 0, error: insertError.message }
      }
    }

    // Count unique companies and articles
    const uniqueCompanies = new Set(mentions.map(m => m.company.slug)).size
    const uniqueArticles = new Set(mentions.map(m => m.articleIndex)).size

    return { success: true, companiesFound: uniqueCompanies, articlesWithCompanies: uniqueArticles }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[sync-companies] Failed:', message)
    return { success: false, companiesFound: 0, articlesWithCompanies: 0, error: message }
  }
}

/**
 * Sync company mentions for multiple posts (for migration/backfill)
 *
 * @param posts - Array of posts with id, content, and optional pending_queue_item_ids
 */
export async function syncAllPostCompanyMentions(
  posts: Array<{ id: string; content: string | object; pending_queue_item_ids?: string[] }>
): Promise<{ success: number; failed: number; total: number; totalMentions: number }> {
  let success = 0
  let failed = 0
  let totalMentions = 0

  for (const post of posts) {
    const result = await syncPostCompanyMentions(post.id, post.content, post.pending_queue_item_ids)
    if (result.success) {
      success++
      totalMentions += result.companiesFound
    } else {
      failed++
      console.error(`[sync-companies] Failed for post ${post.id}:`, result.error)
    }
  }

  return { success, failed, total: posts.length, totalMentions }
}
