/**
 * Backfill category attributes on existing articles' H2 headings.
 * Uses keyword matching on FULL SECTION TEXT (heading + all paragraphs until next H2).
 *
 * Usage: npx tsx scripts/backfill-categories.ts [--force] [slug]
 *   --force  Overwrite existing categories
 *   slug     Process only this specific post
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabaseUrl = 'https://zadrjbyszvsusukajsbp.supabase.co'
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Keywords per category — scored against FULL section text (heading + body).
// "ki" and "ai" are intentionally EXCLUDED from AI Tech because
// in an AI-focused blog, every section mentions them.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Robotik': [
    'roboter', 'robotik', 'drohne', 'drohnen', 'autonom', 'humanoid',
    'hardware', 'sensor', 'actuator', 'robotics', 'robotik-chef',
    'manipulator', 'greifer', 'laufmaschine',
  ],
  'Politik': [
    'politik', 'regulierung', 'gesetz', 'regierung', 'militär', 'militärisch',
    'krieg', 'iran', 'sanktion', 'verteidigung', 'sicherheit', 'nato',
    'pentagon', 'gericht', 'klage', 'konflikt', 'angriff', 'waffe',
    'überwachung', 'geheimdienst', 'bahrain', 'rüstung', 'verbot',
    'richtlinie', 'kommission', 'bundesregierung', 'kongress', 'senat',
    'souveränität', 'spionage', 'zensur', 'export', 'embargo',
  ],
  'Gossip': [
    'ceo', 'chef', 'verlässt', 'wechsel', 'skandal', 'deal', 'übernahme',
    'funding', 'bewertung', 'milliard', 'million', 'investor', 'aktie',
    'börse', 'markt', 'märkte', 'quartal', 'umsatz', 'gewinn',
    'wall street', 'kurs', 'analyst', 'entlassung', 'gefeuert', 'abgang',
    'nachfolger', 'gerücht', 'personal', 'verteidigt', 'brief',
    'rücktritt', 'gründer', 'vorstand', 'aufsichtsrat', 'ipo',
    'kapital', 'rendite', 'bilanz',
  ],
  'UX': [
    'ux', 'design', 'interface', 'usability', 'nutzer', 'benutzer',
    'user experience', 'accessibility', 'ui', 'oberfläche', 'barrierefreiheit',
    'interaktion', 'prototyp', 'figma', 'wireframe',
  ],
  'Informatik': [
    'code', 'programmier', 'software', 'developer', 'api', 'framework',
    'compiler', 'ide', 'github', 'open source', 'infrastruktur', 'cloud',
    'server', 'oracle', 'datenbank', 'stack', 'backend', 'frontend',
    'devops', 'kubernetes', 'docker', 'architektur', 'deployment',
    'microservice', 'rechenzentrum', 'latenz', 'skalier',
  ],
  'Gesellschaft': [
    'gesellschaft', 'ethik', 'arbeit', 'job', 'bildung', 'mensch',
    'bestattung', 'digitalisier', 'langweilig', 'branche', 'alltag',
    'beruf', 'handwerk', 'dienstleistung', 'gesundheit', 'pflege',
    'schule', 'universität', 'geschäft', 'unternehmen', 'plattform',
    'wandel', 'transformation', 'kultur', 'medien', 'journalismus',
    'demokratie', 'verantwortung', 'vertrauen',
  ],
  'Philosophie': [
    'philosophie', 'denken', 'bewusstsein', 'existenz', 'bedeutung',
    'sinn', 'paradox', 'ironie', 'illusion', 'reflexion', 'essay',
    'moral', 'utopie', 'dystopie', 'menschlichkeit', 'freiheit',
    'determinismus', 'zukunft',
  ],
  'AI Tech': [
    // Only specific AI technology terms — NOT generic "ki"/"ai"
    'openai', 'anthropic', 'gemini', 'claude', 'gpt', 'llm',
    'modell', 'token', 'reasoning', 'neural', 'machine learning',
    'deep learning', 'transformer', 'chatbot', 'copilot', 'inference',
    'training', 'fine-tuning', 'benchmark', 'wissensgraph', 'knowledge graph',
    'rag', 'embedding', 'prompt', 'multimodal', 'sprachmodell',
    'forschung', 'paper', 'release', 'parameter', 'kontext',
    'halluzination', 'alignment', 'grammarly', 'feature',
  ],
}

interface SectionData {
  headingText: string
  bodyText: string
}

function categorizeSection(section: SectionData): string {
  // Combine heading + body for full-text scoring
  const fullText = `${section.headingText} ${section.bodyText}`.toLowerCase()

  let bestCategory = 'Gesellschaft' // fallback — NOT "AI Tech"
  let bestScore = 0

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      if (fullText.includes(kw)) score++
    }
    // AI Tech needs higher threshold to win (it's the fallback-of-last-resort in an AI blog)
    if (category === 'AI Tech') {
      score = Math.max(0, score - 1)
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = category
    }
  }

  return bestCategory
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

function extractText(node: TiptapNode): string {
  if (node.type === 'text' && node.text) return node.text
  if (node.content) return node.content.map(extractText).join('')
  return ''
}

/**
 * Extract sections from TipTap content: each section = H2 heading + all nodes until next H2.
 */
function extractSections(content: TiptapNode): { node: TiptapNode; section: SectionData }[] {
  if (!content.content) return []

  const sections: { node: TiptapNode; section: SectionData }[] = []
  let currentH2: TiptapNode | null = null
  let currentBody: string[] = []

  for (const child of content.content) {
    if (child.type === 'heading' && child.attrs?.level === 2) {
      // Flush previous section
      if (currentH2) {
        const headingText = extractText(currentH2)
        const lower = headingText.toLowerCase()
        if (!lower.includes('mattes synthese') && !lower.includes("mattes' synthese") && !lower.includes('synthszr take') && !lower.includes('synthszr contra')) {
          sections.push({
            node: currentH2,
            section: { headingText, bodyText: currentBody.join(' ') },
          })
        }
      }
      currentH2 = child
      currentBody = []
    } else if (currentH2) {
      // Accumulate body text for current section
      currentBody.push(extractText(child))
    }
  }

  // Flush last section
  if (currentH2) {
    const headingText = extractText(currentH2)
    const lower = headingText.toLowerCase()
    if (!lower.includes('mattes synthese') && !lower.includes("mattes' synthese") && !lower.includes('synthszr take') && !lower.includes('synthszr contra')) {
      sections.push({
        node: currentH2,
        section: { headingText, bodyText: currentBody.join(' ') },
      })
    }
  }

  return sections
}

function addCategoriesToContent(content: TiptapNode, force: boolean): { modified: boolean; categories: string[] } {
  const sections = extractSections(content)
  const categories: string[] = []
  let modified = false

  for (const { node, section } of sections) {
    // Skip if already has category (unless --force)
    if (node.attrs?.category && !force) {
      categories.push(node.attrs.category as string)
      continue
    }

    const category = categorizeSection(section)
    if (!node.attrs) node.attrs = { level: 2 }
    node.attrs.category = category
    categories.push(category)
    modified = true
    console.log(`  H2: "${section.headingText.slice(0, 60)}..." → ${category}`)
  }

  return { modified, categories }
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const targetSlug = args.find(a => a !== '--force')

  let query = supabase
    .from('generated_posts')
    .select('id, slug, title, content')
    .order('created_at', { ascending: false })

  if (targetSlug) {
    query = query.eq('slug', targetSlug)
  } else {
    query = query.limit(50)
  }

  const { data: posts, error } = await query

  if (error) {
    console.error('Error fetching posts:', error)
    process.exit(1)
  }

  if (!posts || posts.length === 0) {
    console.log('No posts found.')
    process.exit(0)
  }

  console.log(`Found ${posts.length} post(s) to process.${force ? ' (FORCE mode)' : ''}\n`)

  for (const post of posts) {
    console.log(`\nProcessing: "${post.title?.slice(0, 60)}..." (${post.slug})`)

    if (!post.content) {
      console.log('  Skipped: no content')
      continue
    }

    let content: TiptapNode
    try {
      content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    } catch {
      console.log('  Skipped: invalid JSON')
      continue
    }

    const { modified, categories } = addCategoriesToContent(content, force)

    if (!modified) {
      console.log('  Skipped: all H2s already have categories')
      continue
    }

    console.log(`  Assigned ${categories.length} categories: ${categories.join(', ')}`)

    // Update the post
    const { error: updateError } = await supabase
      .from('generated_posts')
      .update({ content: JSON.stringify(content) })
      .eq('id', post.id)

    if (updateError) {
      console.error(`  Error updating: ${updateError.message}`)
    } else {
      console.log('  Updated successfully!')
    }
  }

  console.log('\nDone.')
}

main().catch(console.error)
