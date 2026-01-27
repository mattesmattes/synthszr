import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TiptapNode {
  type: string
  attrs?: { level?: number; queueItemId?: string }
  content?: TiptapNode[]
  text?: string
}

interface Thumbnail {
  id: string
  article_index: number
  source_text: string | null
  article_queue_item_id: string | null
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate Jaccard similarity
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])

  return intersection.size / union.size
}

async function reindex() {
  const slug = process.argv[2] || 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  // Get the post
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, content, pending_queue_item_ids')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found:', slug)
    return
  }

  console.log('Post:', post.title)
  console.log('Post ID:', post.id)
  console.log('Queue Item IDs:', post.pending_queue_item_ids?.length || 0)

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, source_text, article_queue_item_id')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  if (!thumbnails || thumbnails.length === 0) {
    console.log('No thumbnails found')
    return
  }

  console.log('Thumbnails:', thumbnails.length)

  // Extract H2 headings from content
  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  const h2s: Array<{ heading: string; queueItemId?: string }> = []

  function findH2s(node: TiptapNode) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      let text = ''
      if (node.content) {
        node.content.forEach(c => { if (c.text) text += c.text })
      }
      if (!text.toLowerCase().includes('synthszr take') && !text.toLowerCase().includes('mattes synthese')) {
        h2s.push({
          heading: text,
          queueItemId: node.attrs?.queueItemId
        })
      }
    }
    if (node.content) node.content.forEach(findH2s)
  }
  findH2s(content)

  console.log('H2 Headings:', h2s.length)
  console.log()

  // Strategy: Use pending_queue_item_ids order if available
  // The pending_queue_item_ids array is in the same order as the articles were added
  const queueItemOrder = post.pending_queue_item_ids || []

  console.log('═'.repeat(60))
  console.log('REINDEXING')
  console.log('═'.repeat(60))

  const updates: Array<{ id: string; oldIndex: number; newIndex: number }> = []

  for (const thumbnail of thumbnails) {
    let newIndex = -1
    let matchMethod = ''

    // Strategy 1: Match by queue_item_id position in pending_queue_item_ids
    if (thumbnail.article_queue_item_id && queueItemOrder.length > 0) {
      const queueIndex = queueItemOrder.indexOf(thumbnail.article_queue_item_id)
      if (queueIndex !== -1 && queueIndex < h2s.length) {
        newIndex = queueIndex
        matchMethod = 'queue_order'
      }
    }

    // Strategy 2: Match by source_text similarity to H2 headings
    if (newIndex === -1 && thumbnail.source_text) {
      const normalizedSource = normalizeText(thumbnail.source_text)
      let bestScore = 0

      for (let i = 0; i < h2s.length; i++) {
        const normalizedH2 = normalizeText(h2s[i].heading)
        const score = calculateSimilarity(normalizedSource, normalizedH2)

        // Also check if key words from H2 appear in source
        const h2Words = normalizedH2.split(' ').filter(w => w.length > 4)
        const matchingWords = h2Words.filter(w => normalizedSource.includes(w))
        const wordMatchScore = h2Words.length > 0 ? matchingWords.length / h2Words.length : 0

        const combinedScore = Math.max(score, wordMatchScore)

        if (combinedScore > bestScore && combinedScore > 0.2) {
          bestScore = combinedScore
          newIndex = i
          matchMethod = `similarity (${Math.round(combinedScore * 100)}%)`
        }
      }
    }

    if (newIndex !== -1 && newIndex !== thumbnail.article_index) {
      console.log(`[${thumbnail.article_index} → ${newIndex}] ${thumbnail.source_text?.slice(0, 40)}... (${matchMethod})`)
      updates.push({
        id: thumbnail.id,
        oldIndex: thumbnail.article_index,
        newIndex
      })
    } else if (newIndex === -1) {
      console.log(`[${thumbnail.article_index} → ?] ${thumbnail.source_text?.slice(0, 40)}... (NO MATCH)`)
    } else {
      console.log(`[${thumbnail.article_index}] ${thumbnail.source_text?.slice(0, 40)}... (unchanged)`)
    }
  }

  console.log()
  console.log('═'.repeat(60))
  console.log(`Updates needed: ${updates.length}`)
  console.log('═'.repeat(60))

  if (updates.length === 0) {
    console.log('No updates needed')
    return
  }

  // Apply updates
  console.log('\nApplying updates...')

  for (const update of updates) {
    const { error } = await supabase
      .from('post_images')
      .update({ article_index: update.newIndex })
      .eq('id', update.id)

    if (error) {
      console.log(`  ✗ Failed to update ${update.id}: ${error.message}`)
    } else {
      console.log(`  ✓ Updated ${update.oldIndex} → ${update.newIndex}`)
    }
  }

  console.log('\nDone!')
}

reindex()
