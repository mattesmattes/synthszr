/**
 * Verify that thumbnails can be matched to H2 headings via queueItemId
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

async function verify() {
  const slug = process.argv[2] || 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  // Get post
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, content')
    .eq('slug', slug)
    .single()

  if (!post) return console.log('Not found')

  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

  // Extract H2s with queueItemIds
  function extractH2s(node: TiptapNode, results: Array<{ heading: string; queueItemId?: string }> = []) {
    if (!node) return results
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = node.content?.map((c: TiptapNode) => c.text || '').join('') || ''
      if (!text.toLowerCase().includes('synthszr') && !text.toLowerCase().includes('mattes')) {
        results.push({
          heading: text.slice(0, 40),
          queueItemId: node.attrs?.queueItemId as string | undefined
        })
      }
    }
    if (node.content) node.content.forEach((c: TiptapNode) => extractH2s(c, results))
    return results
  }

  const h2s = extractH2s(content as unknown as TiptapNode)

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  console.log('═'.repeat(80))
  console.log('THUMBNAIL TO H2 MATCHING VERIFICATION')
  console.log('═'.repeat(80))
  console.log()

  console.log('H2 HEADINGS (with queueItemId):')
  h2s.forEach((h, i) => {
    const id = h.queueItemId ? h.queueItemId.slice(0, 8) : 'NONE'
    console.log(`  [${i}] ${id} → "${h.heading}..."`)
  })

  console.log()
  console.log('THUMBNAILS (with article_queue_item_id):')
  thumbnails?.forEach(t => {
    const id = t.article_queue_item_id ? t.article_queue_item_id.slice(0, 8) : 'NONE'
    const headline = t.source_text?.split('\n')[0]?.slice(0, 40) || 'N/A'
    console.log(`  [${t.article_index}] ${id} → "${headline}..."`)
  })

  console.log()
  console.log('MATCHING ANALYSIS:')

  let matchableCount = 0
  let correctCount = 0

  for (let i = 0; i < Math.max(h2s.length, thumbnails?.length || 0); i++) {
    const h2 = h2s[i]
    const thumb = thumbnails?.find(t => t.article_index === i)

    if (!h2 && !thumb) continue

    const h2QueueId = h2?.queueItemId?.slice(0, 8) || 'NONE'
    const thumbQueueId = thumb?.article_queue_item_id?.slice(0, 8) || 'NONE'

    // Can we match by queueItemId?
    if (h2?.queueItemId && thumb?.article_queue_item_id) {
      matchableCount++
      const canMatch = h2.queueItemId === thumb.article_queue_item_id
      if (canMatch) {
        correctCount++
        console.log(`  [${i}] ✓ MATCH: H2 queueId=${h2QueueId}, Thumbnail queueId=${thumbQueueId}`)
      } else {
        // Find the H2 that matches this thumbnail's queueItemId
        const matchingH2Index = h2s.findIndex(h => h.queueItemId === thumb.article_queue_item_id)
        if (matchingH2Index !== -1) {
          console.log(`  [${i}] ↷ REINDEX: Thumbnail should move from ${i} → ${matchingH2Index}`)
        } else {
          console.log(`  [${i}] ✗ MISMATCH: H2 queueId=${h2QueueId}, Thumbnail queueId=${thumbQueueId}`)
        }
      }
    } else {
      console.log(`  [${i}] ○ NO QUEUE IDS: H2=${h2QueueId}, Thumb=${thumbQueueId}`)
    }
  }

  console.log()
  console.log('═'.repeat(80))
  console.log(`SUMMARY: ${correctCount}/${matchableCount} already correct, ${matchableCount - correctCount} need reindex`)
  console.log('═'.repeat(80))
}

verify()
