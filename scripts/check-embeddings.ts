import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function check() {
  // Check daily_repo (where embeddings are stored)
  const { count: total } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })

  const { count: withEmbeddings } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  console.log('=== Daily Repo Embeddings ===')
  console.log('Total items:', total)
  console.log('With embeddings:', withEmbeddings)
  console.log('Missing:', (total || 0) - (withEmbeddings || 0))
  console.log('Percent complete:', total ? Math.round(((withEmbeddings || 0) / total) * 100) + '%' : 'N/A')
}

check()
