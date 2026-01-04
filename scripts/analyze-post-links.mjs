import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function analyze() {
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, content')
    .eq('status', 'published')
    .limit(1)

  for (const post of posts || []) {
    const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    if (!content?.content) continue

    console.log('=== ' + post.title.slice(0, 50) + ' ===\n')

    // Show detailed structure of paragraphs with links
    content.content.forEach((node, idx) => {
      if (node.type === 'paragraph' && node.content) {
        const hasLink = node.content.some(item => item.marks?.some(m => m.type === 'link'))
        if (hasLink) {
          console.log(`\nPara ${idx}:`)
          node.content.forEach((item, i) => {
            const isLink = item.marks?.some(m => m.type === 'link')
            // Show full text, including trailing characters
            const text = item.text || ''
            const displayText = text.length > 80 ? text.slice(0, 40) + '...' + text.slice(-20) : text
            console.log(`  [${i}] ${isLink ? 'LINK' : 'TEXT'}: "${displayText}"`)
          })
        }
      }
    })
  }
}

analyze()
