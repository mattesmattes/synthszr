/**
 * Fix existing posts by embedding queueItemIds into H2 headings
 *
 * This script finds posts that have pending_queue_item_ids but don't have
 * queueItemId attributes on their H2 headings, and adds them.
 *
 * Usage: npx tsx scripts/fix-existing-post-queue-ids.ts [slug]
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface QueueItem {
  id: string
  title: string
  content?: string | null
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

/**
 * Reindex thumbnails to match H2 headings via queueItemId
 */
async function reindexThumbnails(postId: string, content: Record<string, unknown>) {
  // Extract H2 headings with queueItemIds
  const articles: Array<{ heading: string; queueItemId?: string }> = []

  function traverse(node: TiptapNode) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headingText = node.content?.map((c: TiptapNode) => c.text || '').join('') || ''
      const lowerText = headingText.toLowerCase()
      if (!lowerText.includes('mattes synthese') &&
          !lowerText.includes("mattes' synthese") &&
          !lowerText.includes('synthszr take')) {
        articles.push({
          heading: headingText,
          queueItemId: node.attrs?.queueItemId as string | undefined
        })
      }
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }
  traverse(content as unknown as TiptapNode)

  console.log(`  Found ${articles.length} article H2s`)

  // Get thumbnails
  const { data: thumbnails, error: fetchError } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')

  if (fetchError) {
    console.error('  Failed to fetch thumbnails:', fetchError.message)
    return
  }

  if (!thumbnails || thumbnails.length === 0) {
    console.log('  No thumbnails to reindex')
    return
  }

  console.log(`  Found ${thumbnails.length} thumbnails`)

  // Match and update
  let updatedCount = 0
  for (const thumb of thumbnails) {
    if (!thumb.article_queue_item_id) continue

    // Find matching article by queueItemId
    const matchedIndex = articles.findIndex(a => a.queueItemId === thumb.article_queue_item_id)

    if (matchedIndex !== -1 && matchedIndex !== thumb.article_index) {
      const { error } = await supabase
        .from('post_images')
        .update({ article_index: matchedIndex })
        .eq('id', thumb.id)

      if (!error) {
        console.log(`  ✓ Thumbnail ${thumb.article_index} → ${matchedIndex}`)
        updatedCount++
      }
    }
  }

  console.log(`  Reindex complete: ${updatedCount} updated`)
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\säöüß]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function calculateOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  return intersection.size / Math.min(wordsA.size, wordsB.size)
}

function extractText(node: TiptapNode): string {
  if (node.type === 'text' && node.text) return node.text
  if (node.content) return node.content.map(extractText).join('')
  return ''
}

function findBestQueueItemMatch(
  headingText: string,
  queueItems: QueueItem[],
  usedIds: Set<string>
): string | undefined {
  const normalizedHeading = normalizeText(headingText)
  let bestMatch: string | undefined
  let bestScore = 0

  for (const item of queueItems) {
    if (usedIds.has(item.id)) continue

    const normalizedTitle = normalizeText(item.title)
    let score = calculateOverlap(normalizedHeading, normalizedTitle)

    if (item.content) {
      const normalizedContent = normalizeText(item.content.slice(0, 500))
      const contentScore = calculateOverlap(normalizedHeading, normalizedContent)
      score = Math.max(score, contentScore * 0.8)
    }

    const headingWords = normalizedHeading.split(' ').filter((w: string) => w.length > 4)
    const titleWords = normalizedTitle.split(' ').filter((w: string) => w.length > 4)
    const keyWordMatches = headingWords.filter((w: string) => titleWords.some((tw: string) => tw.includes(w) || w.includes(tw)))
    if (keyWordMatches.length > 0) {
      score = Math.max(score, keyWordMatches.length * 0.25)
    }

    if (score > bestScore && score > 0.15) {
      bestScore = score
      bestMatch = item.id
    }
  }

  return bestMatch
}

function embedQueueItemIds(
  content: Record<string, unknown>,
  queueItems: QueueItem[]
): { content: Record<string, unknown>; matchCount: number } {
  if (!queueItems || queueItems.length === 0) {
    return { content, matchCount: 0 }
  }

  const usedIds = new Set<string>()
  let matchCount = 0

  function traverse(node: TiptapNode): void {
    if (!node) return

    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headingText = extractText(node)
      const lowerText = headingText.toLowerCase()

      // Skip special headings
      if (!lowerText.includes('mattes synthese') &&
          !lowerText.includes("mattes' synthese") &&
          !lowerText.includes('synthszr take')) {

        // Only add if not already set
        if (!node.attrs?.queueItemId) {
          const queueItemId = findBestQueueItemMatch(headingText, queueItems, usedIds)

          if (queueItemId) {
            if (!node.attrs) node.attrs = { level: 2 }
            node.attrs.queueItemId = queueItemId
            usedIds.add(queueItemId)
            matchCount++
            console.log(`  ✓ Matched H2 "${headingText.slice(0, 40)}..." → ${queueItemId.slice(0, 8)}`)
          } else {
            console.log(`  ✗ No match for H2 "${headingText.slice(0, 40)}..."`)
          }
        } else {
          console.log(`  ○ Already has queueItemId: "${headingText.slice(0, 40)}..."`)
        }
      }
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }

  traverse(content as unknown as TiptapNode)
  return { content, matchCount }
}

async function fixPost(slug: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Fixing post: ${slug}`)
  console.log('═'.repeat(60))

  // Get post
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('id, title, content, pending_queue_item_ids')
    .eq('slug', slug)
    .single()

  if (postError || !post) {
    console.error('Post not found:', postError?.message)
    return false
  }

  console.log(`Title: ${post.title}`)
  console.log(`Queue items: ${post.pending_queue_item_ids?.length || 0}`)

  if (!post.pending_queue_item_ids || post.pending_queue_item_ids.length === 0) {
    console.log('No queue items to embed')
    return false
  }

  // Get queue items with their titles
  const { data: queueItems, error: queueError } = await supabase
    .from('news_queue')
    .select('id, title, content')
    .in('id', post.pending_queue_item_ids)

  if (queueError || !queueItems) {
    console.error('Failed to fetch queue items:', queueError?.message)
    return false
  }

  console.log(`\nMatching ${queueItems.length} queue items to H2 headings...\n`)

  // Parse content
  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

  // Embed queue item IDs
  const { content: updatedContent, matchCount } = embedQueueItemIds(content, queueItems)

  if (matchCount === 0) {
    console.log('\nNo new matches to embed')
    return false
  }

  // Update post
  console.log(`\nUpdating post with ${matchCount} embedded queueItemIds...`)

  const contentString = JSON.stringify(updatedContent)
  console.log(`Content length: ${contentString.length} chars`)

  const { data: updateData, error: updateError } = await supabase
    .from('generated_posts')
    .update({ content: contentString })
    .eq('id', post.id)
    .select('id')

  if (updateError) {
    console.error('Failed to update post:', updateError.message)
    return false
  }

  if (!updateData || updateData.length === 0) {
    console.error('Update returned no data - post may not have been updated')
    return false
  }

  console.log('✓ Post updated successfully, id:', updateData[0].id)

  // Reindex thumbnails directly (without HTTP call)
  console.log('\nReindexing thumbnails...')
  await reindexThumbnails(post.id, updatedContent)

  return true
}

async function main() {
  const slug = process.argv[2]

  if (slug) {
    // Fix specific post
    await fixPost(slug)
  } else {
    // Find all posts with queue items that might need fixing
    const { data: posts } = await supabase
      .from('generated_posts')
      .select('slug, pending_queue_item_ids')
      .not('pending_queue_item_ids', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!posts || posts.length === 0) {
      console.log('No posts with queue items found')
      return
    }

    console.log(`Found ${posts.length} posts with queue items`)

    for (const post of posts) {
      if (post.slug && post.pending_queue_item_ids && post.pending_queue_item_ids.length > 0) {
        await fixPost(post.slug)
      }
    }
  }

  console.log('\n✓ Done!')
}

main()
