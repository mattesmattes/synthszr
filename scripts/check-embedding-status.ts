import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function check() {
  // Total items in daily_repo
  const { count: total } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })

  // Items with embeddings
  const { count: withEmb } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  // Items without embeddings
  const { count: withoutEmb } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)

  // Today's items
  const { count: todayTotal } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .eq('newsletter_date', '2026-01-28')

  const { count: todayWithEmb } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .eq('newsletter_date', '2026-01-28')
    .not('embedding', 'is', null)

  console.log('=== Embedding Status ===')
  console.log('Total daily_repo:', total)
  console.log('Mit Embedding:', withEmb)
  console.log('Ohne Embedding:', withoutEmb)
  console.log('')
  console.log('Heute (28.1.) total:', todayTotal)
  console.log('Heute mit Embedding:', todayWithEmb)
  console.log('Heute OHNE Embedding:', (todayTotal || 0) - (todayWithEmb || 0))
}

check()
