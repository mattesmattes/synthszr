/**
 * Script to analyze Gmail emails and fix newsletter source addresses
 *
 * Run with: npx tsx scripts/fix-newsletter-sources.ts
 */

import { createClient } from '@supabase/supabase-js'
import { GmailClient } from '../lib/gmail/client'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface EmailSender {
  email: string
  name: string
  subjects: string[]
  count: number
  latestDate: Date
}

async function getGmailClient(): Promise<GmailClient> {
  // Get refresh token from database
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

async function getNewsletterSources(): Promise<Array<{ id: string; email: string; name: string }>> {
  const { data, error } = await supabase
    .from('newsletter_sources')
    .select('id, email, name')
    .eq('enabled', true)

  if (error) throw error
  return data || []
}

// Newsletter platform patterns to identify newsletters
const NEWSLETTER_PATTERNS = [
  'substack.com',
  'beehiiv.com',
  'buttondown.email',
  'mailchimp.com',
  'convertkit.com',
  'ghost.io',
  'getrevue.co',
  'medium.com',
  'patreon.com',
  'morningbrew.com',
  'theinformation.com',
  'techmeme.com',
  'therundown.ai',
  'semafor.com',
  'platformer.news',
  'foreignpolicy.com',
  'technologyreview.com',
  'newsletter',
]

function isLikelyNewsletter(sender: EmailSender): boolean {
  const emailLower = sender.email.toLowerCase()

  // Check domain patterns
  for (const pattern of NEWSLETTER_PATTERNS) {
    if (emailLower.includes(pattern)) return true
  }

  // Check if subjects look like newsletters
  const newsletterKeywords = ['newsletter', 'digest', 'weekly', 'daily', 'edition', '#', 'briefing', 'roundup']
  for (const subject of sender.subjects) {
    const subjectLower = subject.toLowerCase()
    for (const keyword of newsletterKeywords) {
      if (subjectLower.includes(keyword)) return true
    }
  }

  // Multiple emails from same sender suggests newsletter
  return sender.count >= 3
}

async function main() {
  console.log('=== Newsletter Source Analyzer ===\n')

  // 1. Get Gmail client
  console.log('Step 1: Connecting to Gmail...')
  const gmail = await getGmailClient()
  console.log('Connected!\n')

  // 2. Fetch recent email senders using existing method
  console.log('Step 2: Fetching recent emails (last 14 days)...')
  const recentSenders = await gmail.scanUniqueSenders(undefined, 14, 500)
  console.log(`Found ${recentSenders.length} unique senders\n`)

  // 3. Get current newsletter sources
  console.log('Step 3: Getting current newsletter sources from database...')
  const currentSources = await getNewsletterSources()
  console.log(`Found ${currentSources.length} configured sources\n`)

  // Create a map of current sources by email (lowercase)
  const sourcesByEmail = new Map<string, typeof currentSources[0]>()
  for (const source of currentSources) {
    sourcesByEmail.set(source.email.toLowerCase(), source)
  }

  // 4. Analyze and find issues
  console.log('Step 4: Analyzing...\n')

  // Find newsletter-like senders that are NOT in sources
  const missingNewsletters: EmailSender[] = []
  const matchedSources = new Set<string>()

  for (const sender of recentSenders) {
    const emailLower = sender.email.toLowerCase()

    if (sourcesByEmail.has(emailLower)) {
      matchedSources.add(emailLower)
    } else if (isLikelyNewsletter(sender)) {
      missingNewsletters.push(sender)
    }
  }

  // Find sources that had NO emails in the last 2 weeks
  const sourcesWithNoEmails: typeof currentSources = []
  for (const source of currentSources) {
    if (!matchedSources.has(source.email.toLowerCase())) {
      sourcesWithNoEmails.push(source)
    }
  }

  // 5. Report findings
  console.log('=== RESULTS ===\n')

  console.log(`Sources WITH recent emails: ${matchedSources.size}`)
  console.log(`Sources WITHOUT recent emails: ${sourcesWithNoEmails.length}`)
  console.log(`Potential missing newsletters: ${missingNewsletters.length}\n`)

  if (sourcesWithNoEmails.length > 0) {
    console.log('--- Sources WITHOUT recent emails (may need address correction): ---')
    for (const source of sourcesWithNoEmails) {
      console.log(`  ${source.email} (${source.name})`)
    }
    console.log('')
  }

  if (missingNewsletters.length > 0) {
    console.log('--- Potential newsletters NOT in sources (top 30): ---')
    for (const sender of missingNewsletters.slice(0, 30)) {
      console.log(`  ${sender.email} (${sender.name}) - ${sender.count} emails`)
      if (sender.subjects.length > 0) {
        console.log(`    Subject: ${sender.subjects[0].slice(0, 60)}...`)
      }
    }
    console.log('')
  }

  // 6. Try to match missing sources with actual senders
  console.log('--- Attempting to find correct addresses for sources without emails: ---\n')

  const corrections: Array<{
    sourceId: string
    oldEmail: string
    newEmail: string
    sourceName: string
    senderName: string
    confidence: string
  }> = []

  for (const source of sourcesWithNoEmails) {
    // Try to find a matching sender by name similarity
    const sourceName = source.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const sourceEmailUser = source.email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')

    for (const sender of recentSenders) {
      const senderName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const senderEmailUser = sender.email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')

      // Skip if this email is already a source
      if (sourcesByEmail.has(sender.email.toLowerCase())) continue

      // Check for various match types
      let confidence = ''

      // Exact name match
      if (sourceName === senderName && sourceName.length > 3) {
        confidence = 'HIGH (exact name match)'
      }
      // Name contains match
      else if ((sourceName.includes(senderName) || senderName.includes(sourceName)) && Math.min(sourceName.length, senderName.length) > 4) {
        confidence = 'MEDIUM (name contains)'
      }
      // Email prefix match
      else if ((sourceEmailUser.includes(senderEmailUser) || senderEmailUser.includes(sourceEmailUser)) && Math.min(sourceEmailUser.length, senderEmailUser.length) > 4) {
        confidence = 'MEDIUM (email prefix match)'
      }

      if (confidence) {
        corrections.push({
          sourceId: source.id,
          oldEmail: source.email,
          newEmail: sender.email,
          sourceName: source.name,
          senderName: sender.name,
          confidence
        })
        break
      }
    }
  }

  if (corrections.length > 0) {
    console.log('Found potential corrections:\n')
    for (const c of corrections) {
      console.log(`  ${c.sourceName}:`)
      console.log(`    OLD: ${c.oldEmail}`)
      console.log(`    NEW: ${c.newEmail} (from: ${c.senderName})`)
      console.log(`    Confidence: ${c.confidence}`)
      console.log('')
    }

    // Apply HIGH confidence corrections automatically
    const highConfidence = corrections.filter(c => c.confidence.startsWith('HIGH'))

    if (highConfidence.length > 0) {
      console.log('\nApplying HIGH confidence corrections to database...\n')

      for (const c of highConfidence) {
        const { error } = await supabase
          .from('newsletter_sources')
          .update({ email: c.newEmail })
          .eq('id', c.sourceId)

        if (error) {
          console.log(`  ERROR updating ${c.sourceName}: ${error.message}`)
        } else {
          console.log(`  UPDATED: ${c.sourceName}`)
          console.log(`    ${c.oldEmail} -> ${c.newEmail}`)
        }
      }
    }

    // List medium confidence for manual review
    const mediumConfidence = corrections.filter(c => c.confidence.startsWith('MEDIUM'))
    if (mediumConfidence.length > 0) {
      console.log('\nMEDIUM confidence corrections (manual review recommended):')
      for (const c of mediumConfidence) {
        console.log(`  ${c.sourceName}: ${c.oldEmail} -> ${c.newEmail}`)
      }
    }
  } else {
    console.log('No automatic corrections found.\n')
  }

  // 7. Suggest adding missing newsletters
  if (missingNewsletters.length > 0) {
    console.log('\n--- Suggested additions (newsletters not in sources): ---')
    const topMissing = missingNewsletters
      .filter(s => s.count >= 2) // At least 2 emails
      .slice(0, 15)

    for (const sender of topMissing) {
      console.log(`  ADD: ${sender.email} as "${sender.name}" (${sender.count} emails)`)
    }
  }

  console.log('\n=== Done ===')
}

main().catch(console.error)
