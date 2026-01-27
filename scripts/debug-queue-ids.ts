import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debug() {
  const slug = 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  // Get the post with queue item IDs
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, pending_queue_item_ids')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found')
    return
  }

  const queueItemIds = post.pending_queue_item_ids || []
  console.log('Queue Item IDs in post (order = article order):')
  console.log('Count:', queueItemIds.length)

  // Get the actual queue items to see their titles
  if (queueItemIds.length > 0) {
    const { data: queueItems } = await supabase
      .from('news_queue')
      .select('id, title')
      .in('id', queueItemIds)

    const queueMap = new Map(queueItems?.map(q => [q.id, q.title]) || [])

    console.log('\nQueue items in order:')
    queueItemIds.forEach((id: string, i: number) => {
      const title = queueMap.get(id) || 'N/A'
      console.log(`  [${i}] ${id.slice(0, 8)}... → ${title.slice(0, 50)}`)
    })
  }

  // Get thumbnails with their queue item IDs
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  console.log('\n\nThumbnails with queue item IDs:')
  thumbnails?.forEach(t => {
    const queueIndex = t.article_queue_item_id ? queueItemIds.indexOf(t.article_queue_item_id) : -1
    const headline = t.source_text?.split('\n')[0]?.slice(0, 40) || 'N/A'
    console.log(`  [${t.article_index}] queue_item: ${t.article_queue_item_id?.slice(0, 8) || 'none'}... (pos in queue: ${queueIndex}) → ${headline}`)
  })
}

debug()
