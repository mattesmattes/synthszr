/**
 * Link existing thumbnails to queue items based on article_index
 *
 * This script matches thumbnails to H2 headings by their article_index,
 * then copies the H2's queueItemId to the thumbnail's article_queue_item_id.
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

async function linkThumbnails(slug: string) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Linking thumbnails for: ${slug}`)
  console.log('═'.repeat(60))

  // Get post
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, content')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found')
    return
  }

  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

  // Extract H2s with queueItemIds
  const h2s: Array<{ heading: string; queueItemId?: string }> = []

  function traverse(node: TiptapNode) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headingText = node.content?.map((c: TiptapNode) => c.text || '').join('') || ''
      const lowerText = headingText.toLowerCase()
      if (!lowerText.includes('mattes synthese') &&
          !lowerText.includes("mattes' synthese") &&
          !lowerText.includes('synthszr take')) {
        h2s.push({
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

  console.log(`Found ${h2s.length} H2 headings`)

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  if (!thumbnails || thumbnails.length === 0) {
    console.log('No thumbnails found')
    return
  }

  console.log(`Found ${thumbnails.length} thumbnails`)

  let updatedCount = 0

  for (const thumb of thumbnails) {
    // Skip if already linked
    if (thumb.article_queue_item_id) {
      console.log(`  [${thumb.article_index}] Already linked`)
      continue
    }

    // Get the H2 at this index
    const h2 = h2s[thumb.article_index]
    if (!h2 || !h2.queueItemId) {
      console.log(`  [${thumb.article_index}] No H2 or no queueItemId`)
      continue
    }

    // Update thumbnail
    const { error } = await supabase
      .from('post_images')
      .update({ article_queue_item_id: h2.queueItemId })
      .eq('id', thumb.id)

    if (error) {
      console.log(`  [${thumb.article_index}] Error: ${error.message}`)
    } else {
      console.log(`  [${thumb.article_index}] ✓ Linked to ${h2.queueItemId.slice(0, 8)}`)
      updatedCount++
    }
  }

  console.log(`\nUpdated ${updatedCount} thumbnails`)
}

async function main() {
  const slug = process.argv[2]

  if (slug) {
    await linkThumbnails(slug)
  } else {
    // Find posts with thumbnails that need linking
    const { data: posts } = await supabase
      .from('generated_posts')
      .select('slug')
      .not('pending_queue_item_ids', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!posts || posts.length === 0) {
      console.log('No posts found')
      return
    }

    for (const post of posts) {
      if (post.slug) {
        await linkThumbnails(post.slug)
      }
    }
  }

  console.log('\n✓ Done!')
}

main()
