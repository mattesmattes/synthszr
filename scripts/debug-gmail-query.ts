/**
 * Debug: Why does Gmail return so few emails?
 */
import { createClient } from '@supabase/supabase-js'
import { GmailClient } from '../lib/gmail/client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.prod.temp' })
dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  console.log('=== DEBUG GMAIL QUERY ===\n')

  // 1. Get token
  const { data: tokenData } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .single()

  const gmailClient = new GmailClient(tokenData!.refresh_token)

  // 2. Get sources
  const { data: sources } = await supabase
    .from('newsletter_sources')
    .select('email')
    .eq('enabled', true)

  const senderEmails = (sources || []).map(s => s.email)
  console.log(`Sources: ${senderEmails.length}`)

  // 3. Check current timestamp in settings
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  console.log(`Stored timestamp: ${setting?.value?.timestamp}`)

  // 4. Check latest collected_at in daily_repo
  const { data: latest } = await supabase
    .from('daily_repo')
    .select('collected_at, newsletter_date')
    .order('collected_at', { ascending: false })
    .limit(1)
    .single()

  console.log(`Latest collected_at: ${latest?.collected_at}`)
  console.log(`Latest newsletter_date: ${latest?.newsletter_date}`)

  // 5. Test fetch with different date ranges
  console.log('\n--- TEST FETCHES ---\n')

  const testDates = [
    { name: 'Last 6 hours', date: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    { name: 'Last 24 hours', date: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    { name: 'Last 48 hours', date: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    { name: 'Since 16.1. 00:00', date: new Date('2026-01-16T00:00:00Z') },
    { name: 'Since 15.1. 00:00', date: new Date('2026-01-15T00:00:00Z') },
  ]

  for (const test of testDates) {
    try {
      const emails = await gmailClient.fetchEmailsFromSenders(senderEmails, 300, test.date)
      const uniqueSenders = new Set(emails.map(e => e.from))
      console.log(`${test.name}: ${emails.length} emails from ${uniqueSenders.size} senders`)
    } catch (err) {
      console.log(`${test.name}: ERROR - ${err}`)
    }
  }

  // 6. Check if labels have more
  console.log('\n--- LABEL FETCH ---\n')

  for (const label of ['newsstand-ai', 'newsstand-marketing']) {
    try {
      const emails = await gmailClient.fetchEmailsFromLabels(label, 100, new Date('2026-01-16T00:00:00Z'))
      console.log(`Label "${label}": ${emails.length} emails`)
    } catch (err) {
      console.log(`Label "${label}": not found`)
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
