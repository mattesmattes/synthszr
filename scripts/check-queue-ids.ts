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

async function check() {
  const slug = process.argv[2] || 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  const { data: post } = await supabase
    .from('generated_posts')
    .select('content')
    .eq('slug', slug)
    .single()

  if (!post) return console.log('Not found')

  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

  function extractH2s(node: TiptapNode, results: Array<{ heading: string; queueItemId: string }> = []) {
    if (!node) return results
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = node.content?.map((c: TiptapNode) => c.text || '').join('') || ''
      if (!text.toLowerCase().includes('synthszr') && !text.toLowerCase().includes('mattes')) {
        results.push({
          heading: text.slice(0, 50),
          queueItemId: (node.attrs?.queueItemId as string) || 'NONE'
        })
      }
    }
    if (node.content) node.content.forEach((c: TiptapNode) => extractH2s(c, results))
    return results
  }

  const h2s = extractH2s(content as unknown as TiptapNode)
  console.log('H2 headings with queueItemIds:')
  h2s.forEach((h, i) => console.log(`  [${i}] ${h.queueItemId.slice(0, 8)} → ${h.heading}`))
}

check()
