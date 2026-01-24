import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debug() {
  console.log('=== Debugging Synthesis Pipeline ===\n')

  // 1. Check if digest exists for 24.01
  const { data: digest, error: digestError } = await supabase
    .from('daily_digests')
    .select('id, digest_date, sources_used')
    .eq('digest_date', '2026-01-24')
    .single()

  if (digestError || !digest) {
    console.log('❌ No digest found for 2026-01-24')
    console.log('   Error:', digestError?.message)
    return
  }

  console.log('✓ Digest found:', digest.id)
  console.log('  Sources used:', digest.sources_used?.length || 0)

  // 2. Check items for this date
  const { data: items, error: itemsError } = await supabase
    .from('daily_repo')
    .select('id, title, embedding, source_type')
    .eq('newsletter_date', '2026-01-24')
    .limit(5)

  if (itemsError || !items || items.length === 0) {
    console.log('❌ No items found for 2026-01-24')
    return
  }

  console.log(`\n✓ Found ${items.length} items for 2026-01-24 (showing first 5)`)

  // 3. Test similarity search for each item
  for (const item of items) {
    const hasEmbedding = item.embedding && item.embedding.length > 10
    console.log(`\n--- Item: "${item.title.slice(0, 50)}..." ---`)
    console.log(`    Type: ${item.source_type}, Has embedding: ${hasEmbedding}`)

    if (!hasEmbedding) {
      console.log('    ⚠️ No embedding - cannot search')
      continue
    }

    // Run similarity search
    const { data: similar, error: searchError } = await supabase.rpc('find_similar_items', {
      query_embedding: item.embedding,
      item_id: item.id,
      max_age_days: 90,
      match_threshold: 0.5,
      match_count: 3,
    })

    if (searchError) {
      console.log('    ❌ Search error:', searchError.message)
      continue
    }

    if (!similar || similar.length === 0) {
      console.log('    ⚠️ No similar items found (50% threshold)')

      // Try lower threshold
      const { data: similar30 } = await supabase.rpc('find_similar_items', {
        query_embedding: item.embedding,
        item_id: item.id,
        max_age_days: 90,
        match_threshold: 0.3,
        match_count: 3,
      })

      if (similar30 && similar30.length > 0) {
        console.log(`    Found ${similar30.length} items with 30% threshold:`)
        for (const s of similar30) {
          console.log(`      - ${(s.similarity * 100).toFixed(1)}%: "${s.title.slice(0, 40)}..."`)
        }
      } else {
        console.log('    ❌ No items even with 30% threshold')
      }
    } else {
      console.log(`    ✓ Found ${similar.length} similar items:`)
      for (const s of similar) {
        console.log(`      - ${(s.similarity * 100).toFixed(1)}%: "${s.title.slice(0, 40)}..."`)
      }
    }
  }

  // 4. Check existing synthesis candidates
  const { data: candidates } = await supabase
    .from('synthesis_candidates')
    .select('id')
    .eq('digest_id', digest.id)

  console.log(`\n=== Existing synthesis candidates: ${candidates?.length || 0} ===`)

  // 5. Check developed syntheses
  const { data: syntheses } = await supabase
    .from('developed_syntheses')
    .select('id')
    .eq('digest_id', digest.id)

  console.log(`=== Existing developed syntheses: ${syntheses?.length || 0} ===`)
}

debug().catch(console.error)
