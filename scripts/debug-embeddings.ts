import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function check() {
  // Count items with embeddings by date
  const { data: allItems } = await supabase
    .from('daily_repo')
    .select('newsletter_date')
    .not('embedding', 'is', null)

  if (!allItems || allItems.length === 0) {
    console.log('No data with embeddings')
    return
  }

  const counts: Record<string, number> = {}
  for (const d of allItems) {
    counts[d.newsletter_date] = (counts[d.newsletter_date] || 0) + 1
  }

  const sortedDates = Object.entries(counts).sort((a, b) => b[0].localeCompare(a[0]))
  console.log('Items with embeddings by date (last 10):')
  for (const [date, count] of sortedDates.slice(0, 10)) {
    console.log(`  ${date}: ${count} items`)
  }

  console.log('')
  console.log(`Total dates: ${sortedDates.length}`)
  console.log(`Total items with embeddings: ${allItems.length}`)

  // Check source types
  const { data: sourceTypes } = await supabase
    .from('daily_repo')
    .select('source_type')
    .not('embedding', 'is', null)

  if (sourceTypes) {
    const typeCounts: Record<string, number> = {}
    for (const s of sourceTypes) {
      typeCounts[s.source_type || 'null'] = (typeCounts[s.source_type || 'null'] || 0) + 1
    }
    console.log('')
    console.log('Source types:', typeCounts)
  }

  // Test similarity search for a SPECIFIC AI news item from 24.01
  const { data: testItems } = await supabase
    .from('daily_repo')
    .select('id, title, embedding, source_type')
    .eq('newsletter_date', '2026-01-24')
    .not('embedding', 'is', null)
    .limit(10)

  if (testItems && testItems.length > 0) {
    // Find a real article (not newsletter)
    const article = testItems.find(t => t.source_type === 'article') || testItems[0]

    console.log('')
    console.log(`Test item (${article.source_type}): "${article.title.slice(0, 60)}..."`)

    // Run similarity search - EXCLUDING items from same day
    const { data: similar, error } = await supabase.rpc('find_similar_items', {
      query_embedding: article.embedding,
      item_id: article.id,
      max_age_days: 90,
      match_threshold: 0.5, // 50% threshold like in pipeline
      match_count: 5,
    })

    if (error) {
      console.log('Similarity search error:', error.message)
    } else if (similar && similar.length > 0) {
      console.log(`Found ${similar.length} similar items (50% threshold):`)
      for (const s of similar) {
        console.log(`  - ${(s.similarity * 100).toFixed(1)}% [${s.source_type}]: "${s.title.slice(0, 50)}..."`)
      }
    } else {
      console.log('No similar items found with 50% threshold')

      // Try lower threshold
      const { data: similar2 } = await supabase.rpc('find_similar_items', {
        query_embedding: article.embedding,
        item_id: article.id,
        max_age_days: 90,
        match_threshold: 0.3,
        match_count: 5,
      })

      if (similar2 && similar2.length > 0) {
        console.log(`Found ${similar2.length} items with 30% threshold:`)
        for (const s of similar2) {
          console.log(`  - ${(s.similarity * 100).toFixed(1)}%: "${s.title.slice(0, 50)}..."`)
        }
      }
    }
  }
}

check().catch(console.error)
