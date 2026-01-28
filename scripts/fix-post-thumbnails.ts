/**
 * Fix thumbnail ordering for a specific post
 *
 * Usage: npx tsx scripts/fix-post-thumbnails.ts <slug>
 *
 * This script:
 * 1. Finds the post by slug
 * 2. Extracts H2 headings from content
 * 3. Gets all thumbnails for the post
 * 4. Matches each thumbnail to its correct H2 by text similarity
 * 5. Updates article_index to match the H2 order
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
  attrs?: { level?: number; queueItemId?: string }
  content?: TiptapNode[]
  text?: string
}

interface H2Info {
  index: number
  text: string
  queueItemId?: string
}

interface ThumbnailInfo {
  id: string
  article_index: number
  article_queue_item_id: string | null
  source_text: string | null
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\säöüß]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractH2s(content: TiptapNode): H2Info[] {
  const h2s: H2Info[] = []
  let index = 0

  function traverse(node: TiptapNode) {
    if (!node) return

    if (node.type === 'heading' && node.attrs?.level === 2) {
      let text = ''
      if (node.content) {
        node.content.forEach(c => { if (c.text) text += c.text })
      }
      const lower = text.toLowerCase()
      if (!lower.includes('synthszr take') && !lower.includes('mattes synthese')) {
        h2s.push({
          index: index++,
          text,
          queueItemId: node.attrs?.queueItemId
        })
      }
    }

    if (node.content) {
      node.content.forEach(traverse)
    }
  }

  traverse(content)
  return h2s
}

function findBestH2Match(thumbnail: ThumbnailInfo, h2s: H2Info[], usedIndices: Set<number>): number {
  const sourceText = normalizeText(thumbnail.source_text || '')
  if (!sourceText) return -1

  // First, calculate text similarity scores for all H2s
  const scores: Array<{ h2: H2Info; score: number }> = []

  for (const h2 of h2s) {
    if (usedIndices.has(h2.index)) continue

    const h2Text = normalizeText(h2.text)

    // Calculate word overlap
    const sourceWords = sourceText.split(' ').filter(w => w.length > 3)
    const h2Words = h2Text.split(' ').filter(w => w.length > 3)

    let matchingWords = 0
    for (const sw of sourceWords) {
      for (const hw of h2Words) {
        if (sw.includes(hw) || hw.includes(sw)) {
          matchingWords++
          break
        }
      }
    }

    // Also check for key phrase matches
    const keyPhrases = sourceText.match(/\b[a-zäöüß]{5,}\b/g) || []
    for (const phrase of keyPhrases) {
      if (h2Text.includes(phrase)) {
        matchingWords += 2
      }
    }

    scores.push({ h2, score: matchingWords })
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score)

  // If there's a strong text match (score >= 5), use it regardless of queueItemId
  // This handles cases where queueItemId became stale due to article reordering
  if (scores.length > 0 && scores[0].score >= 5) {
    console.log(`    → Strong text match: H2[${scores[0].h2.index}] (score: ${scores[0].score})`)
    return scores[0].h2.index
  }

  // For weaker matches, check queueItemId first (if available)
  if (thumbnail.article_queue_item_id) {
    const queueMatch = h2s.find(h => h.queueItemId === thumbnail.article_queue_item_id && !usedIndices.has(h.index))
    if (queueMatch) {
      console.log(`    → Queue ID match: H2[${queueMatch.index}]`)
      return queueMatch.index
    }
  }

  // Fall back to best text match if score >= 2
  if (scores.length > 0 && scores[0].score >= 2) {
    console.log(`    → Text match: H2[${scores[0].h2.index}] (score: ${scores[0].score})`)
    return scores[0].h2.index
  }

  return -1
}

async function fixPostThumbnails(slug: string) {
  console.log(`\n🔧 Fixing thumbnails for: ${slug}\n`)

  // 1. Find the post
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('id, title, content, slug')
    .eq('slug', slug)
    .single()

  if (postError || !post) {
    // Try with translation
    const { data: translatedPost } = await supabase
      .from('generated_posts')
      .select('id, title, content, slug')
      .ilike('slug', `%${slug.split('-').slice(0, 3).join('-')}%`)
      .limit(5)

    if (translatedPost && translatedPost.length > 0) {
      console.log('Found similar posts:')
      translatedPost.forEach(p => console.log(`  - ${p.slug}`))
    }

    console.error(`Post not found: ${slug}`)
    return
  }

  console.log(`📝 Post: ${post.title}`)
  console.log(`   ID: ${post.id}\n`)

  // 2. Parse content and extract H2s
  const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  const h2s = extractH2s(content)

  console.log(`📋 H2 Headings (${h2s.length}):`)
  h2s.forEach(h => {
    console.log(`   [${h.index}] ${h.text.slice(0, 60)}${h.text.length > 60 ? '...' : ''}`)
    if (h.queueItemId) console.log(`       queueItemId: ${h.queueItemId.slice(0, 8)}...`)
  })
  console.log()

  // 3. Get thumbnails
  const { data: thumbnails, error: thumbError } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id, source_text')
    .eq('post_id', post.id)
    .eq('image_type', 'article_thumbnail')
    .order('article_index', { ascending: true })

  if (thumbError || !thumbnails) {
    console.error('Failed to fetch thumbnails:', thumbError)
    return
  }

  console.log(`🖼️  Thumbnails (${thumbnails.length}):`)
  thumbnails.forEach(t => {
    const headline = t.source_text?.split('\n')[0]?.slice(0, 50) || 'N/A'
    console.log(`   [${t.article_index}] ${headline}`)
  })
  console.log()

  // 4. Match thumbnails to H2s
  console.log('🔍 Matching thumbnails to H2s...\n')

  const usedIndices = new Set<number>()
  const updates: Array<{ id: string; oldIndex: number; newIndex: number }> = []

  for (const thumb of thumbnails) {
    const headline = thumb.source_text?.split('\n')[0]?.slice(0, 40) || 'N/A'
    console.log(`  Thumbnail [${thumb.article_index}]: "${headline}"`)

    const newIndex = findBestH2Match(thumb, h2s, usedIndices)

    if (newIndex !== -1) {
      usedIndices.add(newIndex)
      if (newIndex !== thumb.article_index) {
        updates.push({ id: thumb.id, oldIndex: thumb.article_index, newIndex })
        console.log(`    ✅ Will update: ${thumb.article_index} → ${newIndex}`)
      } else {
        console.log(`    ✓ Already correct`)
      }
    } else {
      console.log(`    ⚠️ No match found - keeping at ${thumb.article_index}`)
    }
    console.log()
  }

  // 5. Apply updates
  if (updates.length === 0) {
    console.log('✅ No updates needed - all thumbnails already in correct order')
    return
  }

  console.log(`\n📝 Applying ${updates.length} updates...\n`)

  for (const update of updates) {
    const { error } = await supabase
      .from('post_images')
      .update({ article_index: update.newIndex })
      .eq('id', update.id)

    if (error) {
      console.error(`   ❌ Failed to update ${update.id}:`, error)
    } else {
      console.log(`   ✅ Updated ${update.id}: ${update.oldIndex} → ${update.newIndex}`)
    }
  }

  console.log('\n✅ Done!')
}

// Run with slug from command line
const slug = process.argv[2]
if (!slug) {
  console.log('Usage: npx tsx scripts/fix-post-thumbnails.ts <slug>')
  console.log('Example: npx tsx scripts/fix-post-thumbnails.ts claude-kann-jetzt-figma-slack-co')
  process.exit(1)
}

fixPostThumbnails(slug)
