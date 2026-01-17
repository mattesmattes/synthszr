/**
 * Check why fetch isn't getting more newsletters
 * Run with: npx tsx scripts/check-timestamp-issue.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.prod.temp' })
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('=== TIMESTAMP ISSUE ANALYSIS ===\n')

  // 1. Current stored timestamp
  console.log('1. STORED TIMESTAMP:\n')

  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  console.log(`Stored: ${setting?.value?.timestamp}`)

  // 2. Latest collected_at in daily_repo
  console.log('\n2. LATEST COLLECTED_AT:\n')

  const { data: latest } = await supabase
    .from('daily_repo')
    .select('collected_at, newsletter_date, title')
    .order('collected_at', { ascending: false })
    .limit(5)

  for (const item of latest || []) {
    console.log(`  ${item.collected_at} | ${item.newsletter_date} | ${item.title?.slice(0, 40)}`)
  }

  // 3. Check distribution of collected_at by newsletter_date
  console.log('\n3. COLLECTED_AT BY NEWSLETTER_DATE:\n')

  const { data: all } = await supabase
    .from('daily_repo')
    .select('collected_at, newsletter_date')
    .gte('newsletter_date', '2026-01-14')

  const byDate: Record<string, { earliest: string; latest: string; count: number }> = {}

  for (const item of all || []) {
    const date = item.newsletter_date
    if (!byDate[date]) {
      byDate[date] = { earliest: item.collected_at, latest: item.collected_at, count: 0 }
    }
    if (item.collected_at < byDate[date].earliest) byDate[date].earliest = item.collected_at
    if (item.collected_at > byDate[date].latest) byDate[date].latest = item.collected_at
    byDate[date].count++
  }

  for (const [date, info] of Object.entries(byDate).sort().reverse()) {
    console.log(`  ${date}: ${info.count} items`)
    console.log(`    earliest: ${info.earliest}`)
    console.log(`    latest:   ${info.latest}`)
  }

  // 4. The problem
  console.log('\n4. THE PROBLEM:\n')

  const latestCollectedAt = latest?.[0]?.collected_at
  if (latestCollectedAt) {
    const ts = new Date(latestCollectedAt)
    const now = new Date()
    const hoursSince = (now.getTime() - ts.getTime()) / (1000 * 60 * 60)

    console.log(`The timestamp is based on collected_at: ${latestCollectedAt}`)
    console.log(`This is ${hoursSince.toFixed(2)} hours ago`)
    console.log(`\nThe fetch only looks for emails AFTER this timestamp.`)
    console.log(`Since all 17.1. items were collected today, the window is very small.`)
  }

  // 5. Solution
  console.log('\n5. SOLUTION:\n')
  console.log('The timestamp logic should be based on the EMAIL date (newsletter_date),')
  console.log('not the collection date (collected_at).')
  console.log('\nAlternatively: Use the email\'s actual received date from Gmail.')

  console.log('\n\nDone!')
}

main().catch(console.error)
