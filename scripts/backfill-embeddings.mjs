#!/usr/bin/env node

/**
 * Backfill Embeddings Script
 * Generates embeddings for all daily_repo entries without embeddings
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... GOOGLE_GENERATIVE_AI_API_KEY=... node scripts/backfill-embeddings.mjs
 *
 * Options:
 *   --batch-size=N    Number of items per batch (default: 10)
 *   --delay=N         Delay between batches in ms (default: 1000)
 *   --limit=N         Max items to process (default: all)
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Parse command line args
const args = process.argv.slice(2)
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`))
  return arg ? parseInt(arg.split('=')[1], 10) : defaultValue
}

const BATCH_SIZE = getArg('batch-size', 10)
const DELAY_MS = getArg('delay', 1000)
const LIMIT = getArg('limit', 0) // 0 = no limit

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

if (!googleApiKey) {
  console.error('Missing GOOGLE_GENERATIVE_AI_API_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const genAI = new GoogleGenerativeAI(googleApiKey)

async function generateEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  const truncatedText = text.slice(0, 30000)
  const result = await model.embedContent(truncatedText)
  return result.embedding.values
}

async function main() {
  console.log('🚀 Starting embedding backfill...')
  console.log(`   Batch size: ${BATCH_SIZE}`)
  console.log(`   Delay: ${DELAY_MS}ms`)
  console.log(`   Limit: ${LIMIT || 'none'}`)
  console.log('')

  // Get items without embeddings
  let query = supabase
    .from('daily_repo')
    .select('id, title, content')
    .is('embedding', null)
    .order('collected_at', { ascending: false })

  if (LIMIT > 0) {
    query = query.limit(LIMIT)
  }

  const { data: items, error } = await query

  if (error) {
    console.error('❌ Failed to fetch items:', error.message)
    process.exit(1)
  }

  if (!items || items.length === 0) {
    console.log('✅ No items need embeddings!')
    return
  }

  console.log(`📊 Found ${items.length} items without embeddings\n`)

  let processed = 0
  let failed = 0

  // Process in batches
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(items.length / BATCH_SIZE)

    console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} items)...`)

    for (const item of batch) {
      try {
        // Prepare text for embedding
        const text = `${item.title || ''}\n\n${(item.content || '').slice(0, 2000)}`

        // Generate embedding
        const embedding = await generateEmbedding(text)

        // Convert to pgvector format
        const embeddingString = `[${embedding.join(',')}]`

        // Update in database
        const { error: updateError } = await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)

        if (updateError) {
          console.error(`   ❌ Failed to update ${item.id}: ${updateError.message}`)
          failed++
        } else {
          processed++
          console.log(`   ✅ ${item.title?.slice(0, 50)}...`)
        }
      } catch (error) {
        console.error(`   ❌ Error for ${item.id}: ${error.message}`)
        failed++
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < items.length) {
      console.log(`   ⏳ Waiting ${DELAY_MS}ms...`)
      await new Promise(resolve => setTimeout(resolve, DELAY_MS))
    }
  }

  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`✨ Backfill complete!`)
  console.log(`   Processed: ${processed}`)
  console.log(`   Failed: ${failed}`)
  console.log(`   Total: ${items.length}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
