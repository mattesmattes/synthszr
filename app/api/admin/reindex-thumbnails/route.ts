import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { parseTipTapContent } from '@/lib/utils/safe-json'

/**
 * POST /api/admin/reindex-thumbnails
 * Re-indexes article thumbnails based on the current article order in the content.
 * Called when publishing to ensure thumbnails match the final article order.
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { postId, content } = await request.json()

    if (!postId || !content) {
      return NextResponse.json(
        { error: 'postId and content are required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Parse content if it's a string (editor sends JSON-stringified content)
    const parsedContent = parseTipTapContent(content)

    // Extract article headings from TipTap content in order
    const articles = extractArticleHeadings(parsedContent)
    console.log(`[Reindex] Found ${articles.length} articles in content for post ${postId}`)

    // Get all existing thumbnails for this post
    const { data: thumbnails, error: fetchError } = await supabase
      .from('post_images')
      .select('id, article_index, article_queue_item_id, source_text')
      .eq('post_id', postId)
      .eq('image_type', 'article_thumbnail')

    if (fetchError) {
      console.error('[Reindex] Failed to fetch thumbnails:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch thumbnails' }, { status: 500 })
    }

    if (!thumbnails || thumbnails.length === 0) {
      return NextResponse.json({ message: 'No thumbnails to reindex', updated: 0 })
    }

    console.log(`[Reindex] Found ${thumbnails.length} thumbnails to reindex`)

    // Match thumbnails to articles and update indices
    const updates: Array<{ id: string; newIndex: number; matched: string }> = []
    const orphaned: string[] = []

    for (const thumbnail of thumbnails) {
      // Find matching article by queue_item_id first, then by source_text similarity
      let matchedIndex = -1
      let matchMethod = ''

      // Priority 1: Match by queue_item_id
      if (thumbnail.article_queue_item_id) {
        const queueMatch = articles.findIndex(a => a.queueItemId === thumbnail.article_queue_item_id)
        if (queueMatch !== -1) {
          matchedIndex = queueMatch
          matchMethod = 'queue_item_id'
        }
      }

      // Priority 2: Match by source_text (extract headline from source_text and compare)
      if (matchedIndex === -1 && thumbnail.source_text) {
        // Extract headline from source_text (first line or ### heading)
        const thumbnailHeadline = extractHeadlineFromSourceText(thumbnail.source_text)
        const normalizedThumbnailHeadline = normalizeText(thumbnailHeadline)

        console.log(`[Reindex] Thumbnail "${thumbnailHeadline.slice(0, 40)}" (index ${thumbnail.article_index})`)

        // Find best matching article by headline
        let bestScore = 0
        articles.forEach((article, idx) => {
          const normalizedArticleText = normalizeText(article.heading)
          const score = calculateSimilarity(normalizedThumbnailHeadline, normalizedArticleText)
          if (score > bestScore && score > 0.3) { // Lower threshold since we're comparing headlines
            bestScore = score
            matchedIndex = idx
            matchMethod = `headline (${Math.round(score * 100)}%)`
          }
        })

        // Fallback: try matching full source_text if headline match failed
        if (matchedIndex === -1) {
          const normalizedFullText = normalizeText(thumbnail.source_text)
          articles.forEach((article, idx) => {
            const normalizedArticleText = normalizeText(article.heading)
            // Check if article heading appears in source_text
            if (normalizedFullText.includes(normalizedArticleText) ||
                normalizedArticleText.split(' ').filter(w => w.length > 3).every(word => normalizedFullText.includes(word))) {
              matchedIndex = idx
              matchMethod = 'contains_headline'
            }
          })
        }

        if (matchedIndex !== -1) {
          console.log(`[Reindex]   → Matched to article ${matchedIndex} "${articles[matchedIndex].heading.slice(0, 30)}" via ${matchMethod}`)
        }
      }

      if (matchedIndex !== -1 && matchedIndex !== thumbnail.article_index) {
        updates.push({
          id: thumbnail.id,
          newIndex: matchedIndex,
          matched: matchMethod
        })
      } else if (matchedIndex === -1) {
        orphaned.push(thumbnail.id)
        console.log(`[Reindex] Orphaned thumbnail: ${thumbnail.source_text?.slice(0, 50)}`)
      }
    }

    // Apply updates
    let updatedCount = 0
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('post_images')
        .update({ article_index: update.newIndex })
        .eq('id', update.id)

      if (updateError) {
        console.error(`[Reindex] Failed to update thumbnail ${update.id}:`, updateError)
      } else {
        updatedCount++
        console.log(`[Reindex] Updated thumbnail to index ${update.newIndex} (matched by ${update.matched})`)
      }
    }

    // Delete orphaned thumbnails (articles that were removed from content)
    if (orphaned.length > 0) {
      console.log(`[Reindex] Deleting ${orphaned.length} orphaned thumbnails`)
      await supabase
        .from('post_images')
        .delete()
        .in('id', orphaned)
    }

    return NextResponse.json({
      success: true,
      articlesInContent: articles.length,
      thumbnailsFound: thumbnails.length,
      updated: updatedCount,
      deleted: orphaned.length,
    })
  } catch (error) {
    console.error('[Reindex] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Extract article headings from TipTap JSON content
 */
function extractArticleHeadings(content: Record<string, unknown>): Array<{ heading: string; queueItemId?: string }> {
  const articles: Array<{ heading: string; queueItemId?: string }> = []

  function traverse(node: Record<string, unknown>) {
    if (!node) return

    // Check for H2 heading
    if (node.type === 'heading' && (node.attrs as Record<string, unknown>)?.level === 2) {
      const headingText = extractTextFromNode(node)
      const lowerText = headingText.toLowerCase()

      // Skip "Mattes Synthese" and "Synthszr Take" headings
      if (!lowerText.includes('mattes synthese') &&
          !lowerText.includes("mattes' synthese") &&
          !lowerText.includes('synthszr take')) {
        const attrs = node.attrs as Record<string, unknown> | undefined
        articles.push({
          heading: headingText,
          queueItemId: attrs?.queueItemId as string | undefined
        })
      }
    }

    // Recurse into children
    const nodeContent = node.content as Record<string, unknown>[] | undefined
    if (Array.isArray(nodeContent)) {
      for (const child of nodeContent) {
        traverse(child)
      }
    }
  }

  traverse(content)
  return articles
}

/**
 * Extract plain text from a TipTap node
 */
function extractTextFromNode(node: Record<string, unknown>): string {
  if (node.type === 'text') {
    return (node.text as string) || ''
  }

  const nodeContent = node.content as Record<string, unknown>[] | undefined
  if (Array.isArray(nodeContent)) {
    return nodeContent.map(child => extractTextFromNode(child)).join('')
  }

  return ''
}

/**
 * Normalize text for comparison (lowercase, remove punctuation, trim)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate similarity score between two strings (0-1)
 * Uses Jaccard similarity on word sets
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])

  return intersection.size / union.size
}

/**
 * Extract headline from source_text (typically the first line or ### heading)
 * Source texts often have formats like:
 * - "### Headline\nContent..."
 * - "Headline: Content..."
 * - "Headline\nContent..."
 */
function extractHeadlineFromSourceText(sourceText: string): string {
  const lines = sourceText.split('\n').filter(l => l.trim())
  if (lines.length === 0) return sourceText

  let headline = lines[0].trim()

  // Remove markdown heading markers
  headline = headline.replace(/^#+\s*/, '')

  // If the first line looks like a label (e.g., "Quelle:"), try the second line
  if (headline.match(/^[A-Za-z]+:\s*$/) && lines.length > 1) {
    headline = lines[1].trim().replace(/^#+\s*/, '')
  }

  // Remove trailing colons or periods
  headline = headline.replace(/[:.]$/, '')

  return headline
}
