/**
 * Analyze newsletter sources and find correct sender addresses
 * Run with: npx tsx scripts/analyze-newsletter-sources.ts
 */

import { createClient } from '@supabase/supabase-js'
import { GmailClient } from '../lib/gmail/client'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Sources without emails from the last analysis
const SOURCES_WITHOUT_EMAILS = [
  { email: 'stephanie@theinformation.com', name: 'Stephanie Palazzolo (AI Agenda)' },
  { email: 'aaron@theinformation.com', name: 'Aaron Holmes (Applied AI)' },
  { email: 'hello@digest.producthunt.com', name: 'Product Hunt Weekly' },
  { email: 'noreply@medium.com', name: 'Medium Daily Digest' },
  { email: 'newsletters@medium.com', name: 'The Medium Newsletter' },
  { email: 'newsletters@medium.com', name: 'The UX Collective Newsletter' },
  { email: 'circulationoffers@email.globe.com', name: 'The Boston Globe' },
  { email: 'ben@ben-evans.com', name: "Benedecit's Newsletter" },
  { email: 'getfivethings+running@substack.com', name: 'Five Things' },
  { email: 'profgmarkets@mail.beehiiv.com', name: 'Prof G' },
  { email: 'mattes.schrader@oh-so.com', name: 'Mattes Schrader' },
  { email: 'publishing@email.mckinsey.com', name: 'McKinsey Highlights' },
  { email: 'aisupremacy+siphon@substack.com', name: 'AI Supremacy (Michael Spencer)' },
  { email: 'mlpills@substack.com', name: 'Machine Learning Pills' },
  { email: 'exponentialview@substack.com', name: 'Azeem Azhar, Exponential View' },
  { email: 'techemails@substack.com', name: 'Internal Tech Emails' },
  { email: 'artofsaience@substack.com', name: 'Sairam from The Art of Saience' },
  { email: 'email@stratechery.com', name: 'Ben Thompson' },
  { email: 'exponentialview@substack.com', name: 'Exponential View' },
  { email: 'newcomer@substack.com', name: 'Newcomer' },
  { email: 'gerald.hensel@davaidavai.com', name: 'Davai Davai' },
  { email: 'teng@agents.chainofthought.xyz', name: 'Teng Yan | Chain of Thought' },
  { email: 'aisupremacy+guides@substack.com', name: 'Michael Spencer and Hodman Murad from AI Supremacy' },
  { email: 'scarletink@substack.com', name: 'Scarlet Ink' },
]

async function getGmailClient(): Promise<GmailClient> {
  const { data: tokenData, error } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .limit(1)
    .single()

  if (error || !tokenData?.refresh_token) {
    throw new Error('No Gmail refresh token found')
  }

  return new GmailClient(tokenData.refresh_token)
}

async function main() {
  console.log('=== Newsletter Source Analyzer ===\n')

  const gmail = await getGmailClient()
  console.log('Connected to Gmail\n')

  // Get all recent senders
  console.log('Scanning last 30 days of emails...')
  const recentSenders = await gmail.scanUniqueSenders(30, 1000)
  console.log(`Found ${recentSenders.length} unique senders\n`)

  // Create a map by normalized name for matching
  const sendersByName = new Map<string, typeof recentSenders>()
  for (const sender of recentSenders) {
    const normalizedName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!sendersByName.has(normalizedName)) {
      sendersByName.set(normalizedName, [])
    }
    sendersByName.get(normalizedName)!.push(sender)
  }

  console.log('=== Analysis Results ===\n')

  for (const source of SOURCES_WITHOUT_EMAILS) {
    const sourceName = source.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const sourceEmailUser = source.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')

    console.log(`\n--- ${source.name} ---`)
    console.log(`Current: ${source.email}`)

    // Try to find matching senders
    const matches: Array<{ email: string; name: string; count: number; reason: string }> = []

    for (const sender of recentSenders) {
      const senderName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const senderEmailUser = sender.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
      const senderDomain = sender.email.split('@')[1] || ''

      // Check for various matches
      if (senderName === sourceName && sourceName.length > 5) {
        matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'exact name match' })
      } else if (senderName.includes(sourceName) && sourceName.length > 5) {
        matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'name contains source' })
      } else if (sourceName.includes(senderName) && senderName.length > 5) {
        matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'source contains name' })
      } else if (senderDomain.includes(sourceEmailUser) && sourceEmailUser.length > 4) {
        matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'domain contains identifier' })
      } else if (senderEmailUser.includes(sourceEmailUser) && sourceEmailUser.length > 4) {
        matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'email user contains identifier' })
      }
    }

    if (matches.length > 0) {
      console.log('Potential matches:')
      for (const match of matches.slice(0, 3)) {
        console.log(`  → ${match.email} (${match.name}) - ${match.count} emails - ${match.reason}`)
      }
    } else {
      console.log('No matches found - consider disabling or removing')
    }
  }

  console.log('\n\n=== Recommendations ===\n')
  console.log('1. Sources with no matches might be inactive or have completely different sender addresses')
  console.log('2. For Substack newsletters, check if they moved to custom domains')
  console.log('3. Consider disabling sources that haven\'t sent in 30+ days')
}

main().catch(console.error)
