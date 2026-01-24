import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'

function extractTextFromNode(node: Record<string, unknown>): string {
  if (node.type === 'text') return (node.text as string) || ''
  const content = node.content as Record<string, unknown>[] | undefined
  if (Array.isArray(content)) {
    return content.map(child => extractTextFromNode(child)).join('')
  }
  return ''
}

function extractArticleHeadings(content: Record<string, unknown>): Array<{ heading: string; queueItemId?: string }> {
  const articles: Array<{ heading: string; queueItemId?: string }> = []

  function traverse(node: Record<string, unknown>) {
    if (!node) return
    if (node.type === 'heading' && (node.attrs as Record<string, unknown>)?.level === 2) {
      const headingText = extractTextFromNode(node)
      const lowerText = headingText.toLowerCase()
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
    const nodeContent = node.content as Record<string, unknown>[] | undefined
    if (Array.isArray(nodeContent)) {
      for (const child of nodeContent) traverse(child)
    }
  }

  traverse(content)
  return articles
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])
  return intersection.size / union.size
}

async function main() {
  const supabase = createAdminClient()
  const postId = 'e5e0154e-22de-43f0-8f54-94bdacba6312'

  // Get post content
  const { data: post } = await supabase
    .from('generated_posts')
    .select('content')
    .eq('id', postId)
    .single()

  if (!post?.content) {
    console.log('Post not found')
    return
  }

  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  const articles = extractArticleHeadings(content)

  console.log('Articles in content (current order):')
  articles.forEach((a, i) => console.log(`  ${i}: ${a.heading.slice(0, 60)}`))

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, source_text')
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  console.log('\nThumbnails (by article_index):')
  thumbnails?.forEach(t => console.log(`  ${t.article_index}: ${(t.source_text || '').slice(0, 60)} [${t.id.slice(0, 8)}]`))

  // Match thumbnails to articles and collect orphans
  console.log('\nMatching:')
  const updates: Array<{ id: string; oldIndex: number; newIndex: number; title: string }> = []
  const orphaned: Array<{ id: string; title: string }> = []
  const usedArticleIndices = new Set<number>()

  for (const thumbnail of thumbnails || []) {
    const normalizedThumb = normalizeText(thumbnail.source_text || '')
    let matchedIndex = -1
    let bestScore = 0

    articles.forEach((article, idx) => {
      // Skip if this article index is already taken by another thumbnail
      if (usedArticleIndices.has(idx)) return

      const normalizedArticle = normalizeText(article.heading)
      const score = calculateSimilarity(normalizedThumb, normalizedArticle)
      if (score > bestScore && score > 0.5) {
        bestScore = score
        matchedIndex = idx
      }
    })

    if (matchedIndex !== -1) {
      usedArticleIndices.add(matchedIndex)
      if (matchedIndex !== thumbnail.article_index) {
        updates.push({
          id: thumbnail.id,
          oldIndex: thumbnail.article_index,
          newIndex: matchedIndex,
          title: (thumbnail.source_text || '').slice(0, 40)
        })
        console.log(`  ✓ "${(thumbnail.source_text || '').slice(0, 40)}" -> ${thumbnail.article_index} → ${matchedIndex} (${Math.round(bestScore * 100)}%)`)
      } else {
        console.log(`  = "${(thumbnail.source_text || '').slice(0, 40)}" stays at ${matchedIndex}`)
      }
    } else {
      orphaned.push({ id: thumbnail.id, title: (thumbnail.source_text || '').slice(0, 40) })
      console.log(`  ✗ "${(thumbnail.source_text || '').slice(0, 40)}" - NO MATCH (orphaned)`)
    }
  }

  // Apply updates
  if (updates.length > 0) {
    console.log(`\nApplying ${updates.length} index updates...`)
    for (const update of updates) {
      const { error } = await supabase
        .from('post_images')
        .update({ article_index: update.newIndex })
        .eq('id', update.id)

      if (error) {
        console.log(`  ERROR updating ${update.title}: ${error.message}`)
      } else {
        console.log(`  Updated "${update.title}" from ${update.oldIndex} to ${update.newIndex}`)
      }
    }
  }

  // Delete orphaned thumbnails
  if (orphaned.length > 0) {
    console.log(`\nDeleting ${orphaned.length} orphaned thumbnails...`)
    for (const o of orphaned) {
      const { error } = await supabase
        .from('post_images')
        .delete()
        .eq('id', o.id)

      if (error) {
        console.log(`  ERROR deleting ${o.title}: ${error.message}`)
      } else {
        console.log(`  Deleted "${o.title}"`)
      }
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
