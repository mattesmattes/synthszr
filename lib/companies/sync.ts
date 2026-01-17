/**
 * Company Sync - Syncs company mentions to post_company_mentions table
 *
 * Called after a post is saved/published to update the company-post relationships.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { extractCompaniesFromContent, parseTipTapContent } from './extractor'

export interface SyncResult {
  success: boolean
  companiesFound: number
  error?: string
}

/**
 * Sync company mentions for a single post
 *
 * Extracts companies from TipTap content and updates post_company_mentions table.
 * Uses delete + insert pattern to handle company removals.
 *
 * @param postId - The UUID of the generated post
 * @param content - TipTap content as string or object
 */
export async function syncPostCompanyMentions(
  postId: string,
  content: string | object
): Promise<SyncResult> {
  try {
    const supabase = createAdminClient()

    // Parse content if string
    const parsedContent = parseTipTapContent(content)
    if (!parsedContent) {
      return { success: false, companiesFound: 0, error: 'Invalid content format' }
    }

    // Extract companies from content
    const companies = extractCompaniesFromContent(parsedContent)

    // Delete existing mentions for this post
    const { error: deleteError } = await supabase
      .from('post_company_mentions')
      .delete()
      .eq('post_id', postId)

    if (deleteError) {
      console.error('[sync-companies] Delete error:', deleteError)
      return { success: false, companiesFound: 0, error: deleteError.message }
    }

    // Insert new mentions (if any)
    if (companies.length > 0) {
      const insertData = companies.map(company => ({
        post_id: postId,
        company_name: company.name,
        company_slug: company.slug,
        company_type: company.type,
        // ticker is populated at display time from COMPANY_TICKERS, not stored
      }))

      const { error: insertError } = await supabase
        .from('post_company_mentions')
        .insert(insertData)

      if (insertError) {
        console.error('[sync-companies] Insert error:', insertError)
        return { success: false, companiesFound: companies.length, error: insertError.message }
      }
    }

    return { success: true, companiesFound: companies.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[sync-companies] Failed:', message)
    return { success: false, companiesFound: 0, error: message }
  }
}

/**
 * Sync company mentions for multiple posts (for migration)
 *
 * @param posts - Array of posts with id and content
 */
export async function syncAllPostCompanyMentions(
  posts: Array<{ id: string; content: string | object }>
): Promise<{ success: number; failed: number; total: number }> {
  let success = 0
  let failed = 0

  for (const post of posts) {
    const result = await syncPostCompanyMentions(post.id, post.content)
    if (result.success) {
      success++
    } else {
      failed++
      console.error(`[sync-companies] Failed for post ${post.id}:`, result.error)
    }
  }

  return { success, failed, total: posts.length }
}
