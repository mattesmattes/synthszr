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

// Manual mapping based on content analysis
// Format: thumbnail queue_item_id -> H2 index in content
const KNOWN_MAPPINGS: Record<string, Record<string, number>> = {
  'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes': {
    // Queue item title → H2 index
    '40f4620f-c8f4-483c-9005-137b3f544ecd': 4,  // Reasoning Models → Agenten werden zu Gemeinschaften
    '704094bc-e95f-4d37-9267-462491c081d2': 1,  // Clawdbot, Claude in Excel → Noch einmal Claude: Oppenheimer
    '5c2bd5cd-74f1-4065-acda-648cb4036f20': 2,  // AI Beats All Humans → Der rekursive Traum
    'e8d834c4-149b-4ead-8dd1-933bcf773bf7': -1, // How AI race unfolds → not in content
    'b32bfb40-3e7c-4492-926f-8faf7393a43a': 0,  // Claude runs inside Excel → Claude kann jetzt Excel
    '591d359d-2972-4aa7-98b2-f4a839beb352': -1, // Google bet against itself → ?
    'c0248824-2efd-44b5-8bda-d216e773f9e5': 6,  // Inside Apple AI → China: AI und Hardware
    'ba903761-ba41-4747-83c4-4cf26d20a994': 8,  // Silicon Valley Wants to Build AI → Früher war alles nicht besser
    '2d86d2ae-f161-4c8c-ac4e-f26520869320': -1, // AI Is Eating Itself → ?
    'fc169143-c01e-4fb0-a25b-ebd7438a7eb3': 5,  // Microshifting → Standardisierung für AI-Agenten
  }
}

async function fix() {
  const slug = process.argv[2] || 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes'

  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, content, pending_queue_item_ids')
    .eq('slug', slug)
    .single()

  if (!post) {
    console.log('Post not found')
    return
  }

  console.log('Post:', post.title)

  // Get H2 headings
  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  const h2s: string[] = []
  function findH2s(node: TiptapNode) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      let text = ''
      if (node.content) node.content.forEach(c => { if (c.text) text += c.text })
      if (!text.toLowerCase().includes('synthszr take') && !text.toLowerCase().includes('mattes synthese')) {
        h2s.push(text)
      }
    }
    if (node.content) node.content.forEach(findH2s)
  }
  findH2s(content)

  console.log('\nH2 Headings in content:')
  h2s.forEach((h, i) => console.log(`  [${i}] ${h}`))

  // Get queue items with their titles
  const queueItemIds = post.pending_queue_item_ids || []
  const { data: queueItems } = await supabase
    .from('news_queue')
    .select('id, title')
    .in('id', queueItemIds)

  const queueMap = new Map(queueItems?.map(q => [q.id, q.title]) || [])

  // Get thumbnails
  const { data: thumbnails } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  console.log('\n\nAnalyzing thumbnail → H2 mapping...\n')

  // Try to find best match for each thumbnail
  for (const thumb of thumbnails || []) {
    const queueTitle = thumb.article_queue_item_id ? queueMap.get(thumb.article_queue_item_id) : null
    const sourceHeadline = thumb.source_text?.split('\n')[0] || ''

    console.log(`Thumbnail [${thumb.article_index}]: "${sourceHeadline.slice(0, 50)}"`)
    console.log(`  Queue item: ${queueTitle?.slice(0, 50) || 'N/A'}`)

    // Find best matching H2
    let bestMatch = -1
    let bestScore = 0

    for (let i = 0; i < h2s.length; i++) {
      const h2Lower = h2s[i].toLowerCase()
      const sourceWords = sourceHeadline.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
      const queueWords = (queueTitle || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)

      // Count matching words
      const sourceMatches = sourceWords.filter((w: string) => h2Lower.includes(w)).length
      const queueMatches = queueWords.filter((w: string) => h2Lower.includes(w)).length

      const score = sourceMatches + queueMatches

      if (score > bestScore) {
        bestScore = score
        bestMatch = i
      }
    }

    if (bestMatch !== -1 && bestScore > 0) {
      console.log(`  → Best match: H2[${bestMatch}] "${h2s[bestMatch].slice(0, 40)}" (score: ${bestScore})`)
    } else {
      console.log(`  → No match found`)
    }
    console.log()
  }
}

fix()
