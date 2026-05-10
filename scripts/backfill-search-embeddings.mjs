// Backfill content_embedding on generated_posts for the home-page
// semantic search. Idempotent — only embeds rows where the column is
// NULL. Run after applying the 20260510_search_embeddings migration.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   GOOGLE_GENERATIVE_AI_API_KEY=... \
//   node scripts/backfill-search-embeddings.mjs

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const GOOGLE_KEY = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_KEY) {
  console.error('Missing env. Need: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_GENERATIVE_AI_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const genAI = new GoogleGenAI({ apiKey: GOOGLE_KEY })

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768
const MAX_INPUT_CHARS = 8000

function tiptapToPlain(content) {
  if (!content) return ''
  if (typeof content === 'string') {
    try {
      return tiptapToPlain(JSON.parse(content))
    } catch {
      return content
    }
  }
  let plain = ''
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') plain += node.text + ' '
    if (Array.isArray(node.content)) node.content.forEach(collect)
  }
  collect(content)
  return plain
}

function buildEmbedText(post) {
  const head = [post.title, post.excerpt].filter(Boolean).join('\n\n')
  const body = tiptapToPlain(post.content)
  const combined = head ? `${head}\n\n${body}` : body
  return combined.slice(0, MAX_INPUT_CHARS).trim()
}

async function embed(text) {
  const result = await genAI.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  })
  return result.embeddings?.[0]?.values || []
}

async function main() {
  let totalProcessed = 0
  let totalSkipped = 0
  let totalFailed = 0

  while (true) {
    const { data: posts, error } = await supabase
      .from('generated_posts')
      .select('id, title, excerpt, content')
      .is('content_embedding', null)
      .eq('published', true)
      .limit(20)

    if (error) {
      console.error('Fetch failed:', error.message)
      process.exit(1)
    }
    if (!posts || posts.length === 0) {
      console.log('No more posts without embeddings.')
      break
    }

    for (const p of posts) {
      const text = buildEmbedText(p)
      if (!text) {
        console.log(`[skip] ${p.id} — empty body`)
        totalSkipped++
        continue
      }
      try {
        const vec = await embed(text)
        if (vec.length === 0) {
          console.log(`[skip] ${p.id} — empty embedding`)
          totalSkipped++
          continue
        }
        const { error: upErr } = await supabase
          .from('generated_posts')
          .update({ content_embedding: vec })
          .eq('id', p.id)
        if (upErr) {
          console.error(`[fail] ${p.id} — ${upErr.message}`)
          totalFailed++
        } else {
          console.log(`[ok]   ${p.id} — ${p.title?.slice(0, 60) || ''}`)
          totalProcessed++
        }
      } catch (err) {
        console.error(`[fail] ${p.id} — ${err.message}`)
        totalFailed++
      }
      // Gentle pacing for the embedding API
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  console.log('')
  console.log(`Done. processed=${totalProcessed} skipped=${totalSkipped} failed=${totalFailed}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
