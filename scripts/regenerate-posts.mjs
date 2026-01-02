#!/usr/bin/env node

/**
 * Regenerate all existing blog posts with updated ghostwriter settings
 * Run with: node scripts/regenerate-posts.mjs
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

const GHOSTWRITER_SYSTEM_PROMPT = `Du bist ein erfahrener Ghostwriter für Tech-Blogs und Newsletter.
Deine Aufgabe ist es, aus einer Materialsammlung (Digest) einen publikationsfertigen Blogartikel zu erstellen.

WICHTIG - STRUKTURIERTER OUTPUT:
Der Artikel MUSS mit diesen Metadaten beginnen (in genau diesem Format):

---
TITLE: [Prägnanter, ansprechender Titel für den Artikel]
EXCERPT: [1-2 Sätze Zusammenfassung für SEO/Vorschau, max 160 Zeichen]
CATEGORY: [Eine passende Kategorie: AI & Tech, Marketing, Design, Business, Code, oder Synthese]
---

Danach folgt der eigentliche Artikel-Content.

TONALITÄT UND STIL:
- Befolge EXAKT die Tonalitäts-Anweisungen aus dem User-Prompt (News vs. Essay)
- Bei NEWS-Formaten (Ben Evans Stil): Nüchtern, analytisch, faktenbasiert
- Bei ESSAY-Formaten (Matthias Schrader Stil): Pointierter, meinungsstark, provokativer
- WICHTIG bei Daily News: KEINE Formulierungen wie "Diese Woche", "In dieser Woche" - es sind TÄGLICHE News!

QUELLENFORMATIERUNG - KRITISCH:
- Format: [→ Publikationsname](URL) - der Link-Text ist der NAME der Publikation (z.B. "→ The Information", "→ TechCrunch", "→ Stratechery")
- Platzierung: Am ENDE des Absatzes, direkt hinter dem LETZTEN Wort (vor dem Punkt)
- NICHT nach dem ersten Satz! Der Quellenlink kommt am Schluss der gesamten News-Story/des Absatzes
- Beispiel RICHTIG: "OpenAI stellte das neue Modell vor, das deutlich schneller ist und weniger Energie verbraucht [→ The Information](URL)."
- Beispiel FALSCH: "OpenAI stellte das neue Modell vor [→ Quelle](URL). Es ist deutlich schneller..."
- Bei mehreren Quellen am Ende: "...verbraucht [→ Reuters](URL1) [→ Bloomberg](URL2)."
- Extrahiere den Publikationsnamen aus dem Quellentitel oder der URL (z.B. "theinformation.com" → "The Information")
- Nutze NUR URLs aus der "VERFÜGBARE QUELLEN MIT LINKS" Liste

FORMAT:
- Deutsch, Markdown
- 800-1500 Wörter (ohne Metadaten)
- Zwischenüberschriften mit ## für bessere Lesbarkeit`

// Simple markdown to TipTap converter (inline version)
function convertMarkdownToTiptap(markdown) {
  const lines = markdown.split('\n')
  const content = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip empty lines
    if (!line.trim()) continue

    // Headings
    if (line.startsWith('## ')) {
      content.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: line.slice(3) }]
      })
    } else if (line.startsWith('# ')) {
      content.push({
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: line.slice(2) }]
      })
    } else {
      // Process inline markdown (links, bold, italic)
      const textContent = parseInlineMarkdown(line)
      content.push({
        type: 'paragraph',
        content: textContent
      })
    }
  }

  return { type: 'doc', content }
}

function parseInlineMarkdown(text) {
  const result = []
  let remaining = text

  while (remaining.length > 0) {
    // Match links: [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/)
    if (linkMatch) {
      const [, before, linkText, url, after] = linkMatch
      if (before) {
        result.push(...parseInlineMarkdown(before))
      }
      result.push({
        type: 'text',
        text: linkText,
        marks: [{ type: 'link', attrs: { href: url, target: '_blank' } }]
      })
      remaining = after
      continue
    }

    // Match bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/)
    if (boldMatch) {
      const [, before, boldText, after] = boldMatch
      if (before) {
        result.push(...parseInlineMarkdown(before))
      }
      result.push({
        type: 'text',
        text: boldText,
        marks: [{ type: 'bold' }]
      })
      remaining = after
      continue
    }

    // No more markdown, just text
    result.push({ type: 'text', text: remaining })
    break
  }

  return result
}

async function getActiveGhostwriterPrompt() {
  const { data } = await supabase
    .from('ghostwriter_prompts')
    .select('prompt_text')
    .eq('is_active', true)
    .single()

  return data?.prompt_text || `Du bist ein erfahrener Tech-Blogger und schreibst für den Synthzr Newsletter.
Schreibe in einem persönlichen, aber professionellen Ton.
Nutze aktive Sprache und direkte Ansprache.
Ziel: 800-1200 Wörter`
}

async function getVocabulary() {
  const { data } = await supabase
    .from('vocabulary_dictionary')
    .select('term, preferred_usage, avoid_alternatives, context')
    .order('category')

  if (!data || data.length === 0) return ''

  let context = '\n\nVOKABULAR-RICHTLINIEN (Intensität: 50%):\nNutze diese Begriffe moderat und achte auf einen natürlichen Lesefluss.\n\nBegriffe:\n'
  context += data.map(v => {
    let entry = `- "${v.term}"`
    if (v.preferred_usage) entry += `: ${v.preferred_usage}`
    if (v.avoid_alternatives) entry += ` | Vermeide: ${v.avoid_alternatives}`
    if (v.context) entry += ` (${v.context})`
    return entry
  }).join('\n')

  return context
}

async function regeneratePost(post) {
  console.log(`\n📝 Regenerating: "${post.title}"`)

  // Get the digest
  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('*')
    .eq('id', post.digest_id)
    .single()

  if (digestError || !digest) {
    console.error(`  ❌ Digest not found for post ${post.id}`)
    return false
  }

  // Get sources for this digest
  const { data: sources } = await supabase
    .from('daily_repo')
    .select('title, source_url, source_email, source_type')
    .eq('newsletter_date', digest.digest_date)
    .order('collected_at', { ascending: true })

  // Build source reference
  let sourceReference = ''
  if (sources && sources.length > 0) {
    const sourcesWithUrls = sources.filter(s => s.source_url && s.source_url.startsWith('http'))
    if (sourcesWithUrls.length > 0) {
      sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN MIT LINKS (nutze NUR diese URLs):\n'
      sourceReference += sourcesWithUrls.map((s, i) => {
        return `${i + 1}. [${s.title}](${s.source_url})`
      }).join('\n')
    }
  }

  const promptText = await getActiveGhostwriterPrompt()
  const vocabularyContext = await getVocabulary()
  const fullPrompt = promptText + vocabularyContext
  const fullDigestContent = digest.analysis_content + sourceReference

  console.log(`  🔄 Calling Claude...`)

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: GHOSTWRITER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${fullPrompt}\n\n---\n\nHier ist der Digest, aus dem du einen Blogartikel erstellen sollst:\n\n${fullDigestContent}`,
        },
      ],
    })

    const blogContent = response.content[0].type === 'text' ? response.content[0].text : ''

    if (!blogContent) {
      console.error(`  ❌ No content generated`)
      return false
    }

    // Parse metadata
    const metadataMatch = blogContent.match(/---\s*\n([\s\S]*?)\n---/)
    let title = post.title
    let excerpt = post.excerpt
    let category = post.category

    if (metadataMatch) {
      const metadata = metadataMatch[1]
      const titleMatch = metadata.match(/TITLE:\s*(.+)/)
      const excerptMatch = metadata.match(/EXCERPT:\s*(.+)/)
      const categoryMatch = metadata.match(/CATEGORY:\s*(.+)/)

      if (titleMatch) title = titleMatch[1].trim()
      if (excerptMatch) excerpt = excerptMatch[1].trim()
      if (categoryMatch) category = categoryMatch[1].trim()
    }

    // Remove metadata block from content
    const contentWithoutMeta = blogContent.replace(/---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()

    // Convert markdown to simple TipTap format inline
    const tiptapContent = convertMarkdownToTiptap(contentWithoutMeta)

    // Update the post
    const { error: updateError } = await supabase
      .from('generated_posts')
      .update({
        title,
        excerpt,
        category,
        content: JSON.stringify(tiptapContent),
        word_count: contentWithoutMeta.split(/\s+/).length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id)

    if (updateError) {
      console.error(`  ❌ Update failed:`, updateError.message)
      return false
    }

    console.log(`  ✅ Updated: "${title}"`)
    return true
  } catch (error) {
    console.error(`  ❌ Error:`, error.message)
    return false
  }
}

async function main() {
  console.log('🚀 Starting post regeneration...\n')

  // Get all generated posts
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, digest_id, excerpt, category')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch posts:', error.message)
    process.exit(1)
  }

  if (!posts || posts.length === 0) {
    console.log('No posts found to regenerate.')
    return
  }

  console.log(`Found ${posts.length} posts to regenerate.`)

  let success = 0
  let failed = 0

  for (const post of posts) {
    const result = await regeneratePost(post)
    if (result) {
      success++
    } else {
      failed++
    }
    // Small delay between posts to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n✨ Done! Success: ${success}, Failed: ${failed}`)
}

main().catch(console.error)
