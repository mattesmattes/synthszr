import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function diagnose() {
  // Get 10 sample items from today
  const { data: todayItems } = await supabase
    .from('daily_repo')
    .select('id, title, embedding')
    .eq('newsletter_date', '2026-01-28')
    .not('embedding', 'is', null)
    .limit(10)

  if (!todayItems || todayItems.length === 0) {
    console.log('Keine Items gefunden!')
    return
  }

  console.log('=== Similarity Search Test ===\n')

  let totalWithMatches = 0
  let totalMatches = 0

  for (const item of todayItems) {
    // Test similarity search
    const { data: similar, error } = await supabase.rpc('find_similar_items', {
      query_embedding: item.embedding,
      item_id: item.id,
      max_age_days: 90,
      match_threshold: 0.5,  // Same as pipeline
      match_count: 5
    })

    const matchCount = similar?.length || 0
    totalMatches += matchCount
    if (matchCount > 0) totalWithMatches++

    const topMatch = similar?.[0]
    console.log(`"${item.title.slice(0, 50)}..."`)
    console.log(`  → ${matchCount} ähnliche Items gefunden`)
    if (topMatch) {
      console.log(`  → Top Match: "${topMatch.title?.slice(0, 40)}..." (${(topMatch.similarity * 100).toFixed(1)}%)`)
    }
    console.log('')
  }

  console.log('=== Zusammenfassung ===')
  console.log(`${totalWithMatches}/${todayItems.length} Items haben historische Matches`)
  console.log(`Durchschnitt: ${(totalMatches / todayItems.length).toFixed(1)} Matches pro Item`)

  // Check if historical items exist in the right date range
  const { count: historicalCount } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .lt('newsletter_date', '2026-01-28')
    .gte('newsletter_date', '2025-10-30')  // 90 days back
    .not('embedding', 'is', null)

  console.log(`\nHistorische Items (letzte 90 Tage) mit Embedding: ${historicalCount}`)
}

diagnose()
