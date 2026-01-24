import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function check() {
  const { data: sampleItem } = await supabase
    .from('daily_repo')
    .select('id, title, newsletter_date, embedding')
    .eq('newsletter_date', '2026-01-24')
    .not('embedding', 'is', null)
    .limit(1)
    .single()

  if (sampleItem === null) {
    console.log('No sample item found')
    return
  }

  console.log('Sample item:', sampleItem.title?.slice(0, 50))
  console.log('Date:', sampleItem.newsletter_date)

  const { data: similar, error } = await supabase.rpc('find_similar_items', {
    query_embedding: sampleItem.embedding,
    item_id: sampleItem.id,
    max_age_days: 90,
    match_threshold: 0.5,
    match_count: 5,
  })

  if (error) {
    console.log('RPC Error:', error.message)
    return
  }

  console.log('\nSimilar items returned:', similar?.length || 0)
  for (const s of similar || []) {
    console.log(`  - ${s.newsletter_date}: "${s.title?.slice(0, 40)}..." (sim: ${(s.similarity * 100).toFixed(1)}%)`)
  }

  const sameDayItems = (similar || []).filter((s: { newsletter_date: string }) => s.newsletter_date === '2026-01-24')
  console.log('\nItems from same day (should be 0):', sameDayItems.length)

  // Also check what related_item_id points to in the candidates
  console.log('\n=== Checking what candidates point to ===')
  const { data: candidates } = await supabase
    .from('synthesis_candidates')
    .select('related_item_id')
    .eq('digest_id', '9c9132c9-6fdb-4a9b-902e-395fd9397e9f')
    .limit(3)

  if (candidates) {
    for (const c of candidates) {
      const { data: relatedItem } = await supabase
        .from('daily_repo')
        .select('id, title, newsletter_date')
        .eq('id', c.related_item_id)
        .single()

      console.log(`  Related item date: ${relatedItem?.newsletter_date} - "${relatedItem?.title?.slice(0, 40)}..."`)
    }
  }
}

check().catch(console.error)
