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

async function check() {
  const slug = process.argv[2] || 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  // Get the post
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, content')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found:', slug)
    return
  }

  console.log('Post:', post.title)
  console.log('Post ID:', post.id)

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, source_text, generation_status')
    .eq('generated_post_id', post.id)
    .order('article_index', { ascending: true })

  console.log('\n--- Thumbnails in DB ---')
  console.log('Count:', thumbnails?.length || 0)
  thumbnails?.forEach((t) => {
    const sourcePreview = (t.source_text || '').split('\n')[0].slice(0, 60)
    console.log(`  [${t.article_index}] ${sourcePreview}...`)
  })

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

  console.log('\n--- H2 Headings in Content ---')
  console.log('Count:', h2s.length)
  h2s.forEach((h, i) => {
    console.log(`  [${i}] ${h.slice(0, 60)}...`)
  })

  // Check if they match
  console.log('\n--- Comparison ---')
  if (thumbnails && h2s.length === thumbnails.length) {
    console.log('✓ Count matches')
  } else {
    console.log(`✗ Count mismatch: ${thumbnails?.length || 0} thumbnails vs ${h2s.length} articles`)
  }
}

check()
