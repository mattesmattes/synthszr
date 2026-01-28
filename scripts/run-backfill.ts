/**
 * Run embedding backfill for all daily_repo items
 * Processes 50 items per batch until all are done
 */

import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! })

const BATCH_SIZE = 50
const DELAY_BETWEEN_ITEMS = 50 // ms

function prepareTextForEmbedding(title: string, content: string): string {
  const combined = `${title}\n\n${content}`.trim()
  // Truncate to ~8000 chars to stay within token limits
  return combined.slice(0, 8000)
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await genAI.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
  })
  return response.embeddings?.[0]?.values || []
}

async function runBackfill() {
  let totalProcessed = 0
  let totalErrors = 0
  let batchNum = 0

  while (true) {
    batchNum++

    // Get items without embeddings
    const { data: items, error: fetchError } = await supabase
      .from('daily_repo')
      .select('id, title, content')
      .is('embedding', null)
      .order('collected_at', { ascending: false })
      .limit(BATCH_SIZE)

    if (fetchError) {
      console.error('Fetch error:', fetchError.message)
      break
    }

    if (!items || items.length === 0) {
      console.log('\n✅ Fertig! Alle Items haben Embeddings.')
      break
    }

    console.log(`\n📦 Batch ${batchNum}: ${items.length} Items`)

    let batchProcessed = 0
    let batchErrors = 0

    for (const item of items) {
      try {
        const text = prepareTextForEmbedding(item.title || '', item.content || '')

        if (text.length < 10) {
          console.log(`  ⏭️  Skipping "${item.title?.slice(0, 30)}..." - too short`)
          continue
        }

        const embedding = await generateEmbedding(text)
        const embeddingString = `[${embedding.join(',')}]`

        const { error: updateError } = await supabase
          .from('daily_repo')
          .update({ embedding: embeddingString })
          .eq('id', item.id)

        if (updateError) {
          throw updateError
        }

        batchProcessed++
        totalProcessed++
        process.stdout.write(`  ✓ ${batchProcessed}/${items.length}\r`)

        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ITEMS))
      } catch (error) {
        batchErrors++
        totalErrors++
        console.error(`  ❌ Error for "${item.title?.slice(0, 30)}...":`, error instanceof Error ? error.message : error)
      }
    }

    console.log(`  Done: ${batchProcessed} processed, ${batchErrors} errors`)

    // Count remaining
    const { count: remaining } = await supabase
      .from('daily_repo')
      .select('id', { count: 'exact', head: true })
      .is('embedding', null)

    console.log(`  📊 Total: ${totalProcessed} processed, ${remaining} remaining`)

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n🎉 Backfill complete!`)
  console.log(`   Total processed: ${totalProcessed}`)
  console.log(`   Total errors: ${totalErrors}`)
}

runBackfill().catch(console.error)
