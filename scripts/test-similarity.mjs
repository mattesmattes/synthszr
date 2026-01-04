import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function test() {
  // Get one item from 2025-12-30 with embedding
  const { data: item } = await supabase
    .from('daily_repo')
    .select('id, title, embedding, newsletter_date')
    .eq('newsletter_date', '2025-12-30')
    .not('embedding', 'is', null)
    .limit(1)
    .single()

  console.log('Test item:', item?.title?.slice(0, 50))
  console.log('Date:', item?.newsletter_date)
  console.log('Has embedding:', item?.embedding ? 'YES' : 'NO')

  if (!item?.embedding) {
    console.log('No embedding found!')
    return
  }

  // Try similarity search with low threshold
  const { data: similar, error } = await supabase.rpc('find_similar_items', {
    query_embedding: item.embedding,
    item_id: item.id,
    max_age_days: 90,
    match_threshold: 0.3,
    match_count: 5
  })

  console.log('')
  console.log('=== SIMILARITY SEARCH ===')
  console.log('Error:', error?.message || 'none')
  console.log('Results found:', similar?.length || 0)

  if (similar && similar.length > 0) {
    similar.forEach(s => console.log(' -', s.title?.slice(0, 40), '| sim:', s.similarity?.toFixed(3)))
  } else {
    console.log('NO SIMILAR ITEMS FOUND - this is the problem!')
  }
}

test()
