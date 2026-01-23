/**
 * Backfill script for article-level company mentions
 *
 * Re-syncs all published posts to populate article_headline and article_excerpt
 * fields in post_company_mentions table.
 *
 * Run with: npx tsx scripts/backfill-company-mentions.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { syncAllPostCompanyMentions } from '../lib/companies/sync'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  console.log('🔄 Starting company mentions backfill...\n')

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Fetch all published posts with content
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, content, pending_queue_item_ids')
    .eq('status', 'published')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('❌ Failed to fetch posts:', error.message)
    process.exit(1)
  }

  if (!posts || posts.length === 0) {
    console.log('ℹ️  No published posts found')
    process.exit(0)
  }

  console.log(`📝 Found ${posts.length} published posts\n`)

  // Sync all posts
  const result = await syncAllPostCompanyMentions(
    posts.map(p => ({
      id: p.id,
      content: p.content,
      pending_queue_item_ids: p.pending_queue_item_ids,
    }))
  )

  console.log('\n✅ Backfill complete!')
  console.log(`   Posts processed: ${result.total}`)
  console.log(`   Successful: ${result.success}`)
  console.log(`   Failed: ${result.failed}`)
  console.log(`   Total company mentions: ${result.totalMentions}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
