import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TiptapNode {
  type: string
  attrs?: { level?: number }
  content?: TiptapNode[]
  text?: string
}

async function debug() {
  const slug = 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  // Get the post
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, content')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found')
    return
  }

  console.log('Post:', post.title)
  console.log('Post ID:', post.id)

  // Get thumbnails - use correct field name
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, source_text, article_queue_item_id')
    .eq('post_id', post.id)  // Note: post_id not generated_post_id
    .eq('image_type', 'article_thumbnail')
    .eq('generation_status', 'completed')
    .order('article_index', { ascending: true })

  // Extract H2 headings from content
  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  const h2s: string[] = []

  function findH2s(node: TiptapNode) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      let text = ''
      if (node.content) {
        node.content.forEach(c => { if (c.text) text += c.text })
      }
      if (!text.toLowerCase().includes('synthszr take') && !text.toLowerCase().includes('mattes synthese')) {
        h2s.push(text)
      }
    }
    if (node.content) node.content.forEach(findH2s)
  }
  findH2s(content)

  console.log('\n' + '═'.repeat(80))
  console.log('COMPARISON: Thumbnails vs H2 Headings')
  console.log('═'.repeat(80))

  const maxLen = Math.max(h2s.length, thumbnails?.length || 0)

  for (let i = 0; i < maxLen; i++) {
    const h2 = h2s[i] || '(keine H2)'
    const thumb = thumbnails?.find(t => t.article_index === i)
    const thumbText = thumb?.source_text?.split('\n')[0]?.slice(0, 40) || '(kein Thumbnail)'

    const match = h2.toLowerCase().includes(thumbText.toLowerCase().slice(0, 20)) ||
                  thumbText.toLowerCase().includes(h2.toLowerCase().slice(0, 20))

    console.log(`\n[${i}] ${match ? '✓' : '✗'}`)
    console.log(`    H2:        "${h2.slice(0, 50)}..."`)
    console.log(`    Thumbnail: "${thumbText}..."`)
  }

  console.log('\n' + '═'.repeat(80))
  console.log('RAW DATA')
  console.log('═'.repeat(80))

  console.log('\nH2 Headings:')
  h2s.forEach((h, i) => console.log(`  [${i}] ${h}`))

  console.log('\nThumbnails (by article_index):')
  thumbnails?.forEach(t => {
    const headline = t.source_text?.split('\n')[0] || 'N/A'
    console.log(`  [${t.article_index}] ${headline}`)
  })
}

debug()
