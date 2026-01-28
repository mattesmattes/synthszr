import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function diagnose() {
  // 1. Count historical items with embeddings
  const { count: withEmbeddings } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  // 2. Count items from today (28.1.2026)
  const { count: todayCount, data: todayItems } = await supabase
    .from('daily_repo')
    .select('id, title, newsletter_date, embedding', { count: 'exact' })
    .eq('newsletter_date', '2026-01-28')
    .limit(5)

  // 3. Count historical items (before today) with embeddings
  const { count: historicalWithEmbeddings } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .lt('newsletter_date', '2026-01-28')
    .not('embedding', 'is', null)

  // 4. Check date range of items with embeddings
  const { data: dateRange } = await supabase
    .from('daily_repo')
    .select('newsletter_date')
    .not('embedding', 'is', null)
    .order('newsletter_date', { ascending: true })
    .limit(1)

  const { data: latestDate } = await supabase
    .from('daily_repo')
    .select('newsletter_date')
    .not('embedding', 'is', null)
    .order('newsletter_date', { ascending: false })
    .limit(1)

  // 5. Test similarity search with a sample item
  const { data: sampleItem } = await supabase
    .from('daily_repo')
    .select('id, title, embedding')
    .eq('newsletter_date', '2026-01-28')
    .not('embedding', 'is', null)
    .limit(1)
    .single()

  let similarCount = 0
  let similarError = null
  if (sampleItem?.embedding) {
    const { data: similar, error } = await supabase.rpc('find_similar_items', {
      query_embedding: sampleItem.embedding,
      item_id: sampleItem.id,
      max_age_days: 90,
      match_threshold: 0.5,
      match_count: 10
    })
    if (error) {
      similarError = error.message
    } else {
      similarCount = similar?.length || 0
      console.log('\nSample similar items:', similar?.slice(0, 3).map((s: { title?: string; similarity?: number }) => ({
        title: s.title?.slice(0, 50),
        similarity: s.similarity?.toFixed(3)
      })))
    }
  }

  console.log('\n=== Synthese-Diagnose ===')
  console.log('Total items mit Embeddings:', withEmbeddings)
  console.log('Items heute (28.1.):', todayCount)
  console.log('Historische Items mit Embeddings:', historicalWithEmbeddings)
  console.log('Ältestes Embedding-Datum:', dateRange?.[0]?.newsletter_date)
  console.log('Neuestes Embedding-Datum:', latestDate?.[0]?.newsletter_date)
  console.log('\nSample heute Item:', sampleItem?.title?.slice(0, 60))
  console.log('Hat Embedding:', !!sampleItem?.embedding)
  if (similarError) {
    console.log('Similarity search ERROR:', similarError)
  } else {
    console.log('Gefundene ähnliche Items (threshold 0.5):', similarCount)
  }

  // Check if today's items have embeddings
  const todayWithEmbeddings = todayItems?.filter(i => i.embedding)?.length || 0
  console.log('\nHeutige Items mit Embedding:', todayWithEmbeddings, '/', todayCount)
}

diagnose()
