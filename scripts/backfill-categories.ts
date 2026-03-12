/**
 * Backfill category attributes on existing articles' H2 headings.
 * Uses Claude Haiku to categorize each section based on full text.
 *
 * Usage: npx tsx scripts/backfill-categories.ts [--force] [slug]
 *   --force  Overwrite existing categories
 *   slug     Process only this specific post
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabaseUrl = 'https://zadrjbyszvsusukajsbp.supabase.co'
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const VALID_CATEGORIES = [
  'AI Tech', 'Gossip', 'Politik', 'UX', 'Informatik', 'Robotik', 'Gesellschaft', 'Philosophie',
]

interface SectionData {
  headingText: string
  bodyText: string
}

async function categorizeSections(sections: SectionData[]): Promise<string[]> {
  const sectionsText = sections.map((s, i) =>
    `--- SECTION ${i + 1} ---\nHeadline: ${s.headingText}\n${s.bodyText.slice(0, 800)}`
  ).join('\n\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Categorize each news section into exactly ONE category. Focus on what the section is PRIMARILY about, not surface-level keyword matches.

CATEGORIES:
- AI Tech: Core AI technology, models, research, benchmarks, new AI product features
- Gossip: Business deals, personnel changes, funding, earnings, market reactions, company drama
- Politik: Government regulation, military, geopolitics, court cases, laws, censorship
- UX: User experience, design, interfaces, accessibility
- Informatik: Software engineering, infrastructure, cloud, programming tools, databases
- Robotik: Robots, drones, autonomous hardware, humanoids
- Gesellschaft: Society, ethics, jobs, education, industry transformation, cultural impact
- Philosophie: Philosophical reflections, existential questions, essays about meaning

IMPORTANT: This is an AI-focused blog, so almost every section mentions AI/KI. Do NOT default to "AI Tech" just because AI is mentioned. Categorize by the PRIMARY THEME:
- A CEO leaving a company → Gossip (not AI Tech)
- Military using AI dashboards → Politik (not AI Tech)
- AI replacing jobs in boring industries → Gesellschaft (not AI Tech)
- A new LLM benchmark or model release → AI Tech

${sectionsText}

Respond with ONLY a JSON array of category strings, one per section. Example: ["Gossip", "AI Tech", "Politik"]`,
    }],
  })

  const text = (response.choices[0].message.content || '').trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) {
    console.error('  LLM response not parseable:', text)
    return sections.map(() => 'Gesellschaft')
  }

  try {
    const categories: string[] = JSON.parse(match[0])
    return categories.map(c => VALID_CATEGORIES.includes(c) ? c : 'Gesellschaft')
  } catch {
    console.error('  JSON parse error:', text)
    return sections.map(() => 'Gesellschaft')
  }
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

function extractSections(content: TiptapNode): { node: TiptapNode; section: SectionData }[] {
  if (!content.content) return []

  const sections: { node: TiptapNode; section: SectionData }[] = []
  let currentH2: TiptapNode | null = null
  let currentBody: string[] = []

  for (const child of content.content) {
    if (child.type === 'heading' && child.attrs?.level === 2) {
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
      currentBody.push(extractText(child))
    }
  }

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

async function addCategoriesToContent(content: TiptapNode, force: boolean): Promise<{ modified: boolean; categories: string[] }> {
  const allSections = extractSections(content)

  // Filter sections that need categorization
  const toProcess: { index: number; node: TiptapNode; section: SectionData }[] = []
  const categories: string[] = []

  for (let i = 0; i < allSections.length; i++) {
    const { node, section } = allSections[i]
    if (node.attrs?.category && !force) {
      categories[i] = node.attrs.category as string
    } else {
      toProcess.push({ index: i, node, section })
    }
  }

  if (toProcess.length === 0) {
    return { modified: false, categories: allSections.map(s => (s.node.attrs?.category as string) || 'Gesellschaft') }
  }

  // Batch categorize via LLM
  const llmCategories = await categorizeSections(toProcess.map(s => s.section))

  let modified = false
  for (let j = 0; j < toProcess.length; j++) {
    const { index, node, section } = toProcess[j]
    const category = llmCategories[j] || 'Gesellschaft'
    if (!node.attrs) node.attrs = { level: 2 }
    node.attrs.category = category
    categories[index] = category
    modified = true
    console.log(`  H2: "${section.headingText.slice(0, 60)}…" → ${category}`)
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
    console.log(`\nProcessing: "${post.title?.slice(0, 60)}…" (${post.slug})`)

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

    const { modified, categories } = await addCategoriesToContent(content, force)

    if (!modified) {
      console.log('  Skipped: all H2s already have categories')
      continue
    }

    console.log(`  Assigned ${categories.length} categories: ${categories.join(', ')}`)

    const { error: updateError } = await supabase
      .from('generated_posts')
      .update({ content: JSON.stringify(content) })
      .eq('id', post.id)

    if (updateError) {
      console.error(`  Error updating: ${updateError.message}`)
    } else {
      console.log('  ✓ Updated')
    }
  }

  console.log('\nDone.')
}

main().catch(console.error)
