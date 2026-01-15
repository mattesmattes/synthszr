import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GmailClient } from '@/lib/gmail/client'

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

// Generic newsletter platform domains - skip "same domain" matching for these
const GENERIC_NEWSLETTER_DOMAINS = new Set([
  'substack.com',
  'beehiiv.com',
  'buttondown.email',
  'mailchimp.com',
  'convertkit.com',
  'ghost.io',
  'getrevue.co',
  'medium.com',
  'mail.beehiiv.com',
])

// Generic sender prefixes that should not be matched
const GENERIC_SENDER_PREFIXES = new Set([
  'noreply',
  'no-reply',
  'newsletter',
  'notifications',
  'hello',
  'info',
  'support',
  'team',
  'news',
  'updates',
  'farfetch', // definitely wrong match
])

interface EmailSender {
  email: string
  name: string
  subjects: string[]
  count: number
  latestDate: Date
}

function isLikelyNewsletter(sender: EmailSender): boolean {
  const emailLower = sender.email.toLowerCase()

  for (const pattern of NEWSLETTER_PATTERNS) {
    if (emailLower.includes(pattern)) return true
  }

  const newsletterKeywords = ['newsletter', 'digest', 'weekly', 'daily', 'edition', '#', 'briefing', 'roundup']
  for (const subject of sender.subjects) {
    const subjectLower = subject.toLowerCase()
    for (const keyword of newsletterKeywords) {
      if (subjectLower.includes(keyword)) return true
    }
  }

  return sender.count >= 3
}

export async function GET(request: Request) {
  // Temporary bypass with secret (remove after use)
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'fix-nl-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // 1. Get Gmail refresh token
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
    }

    // 2. Fetch recent email senders (last 14 days)
    const gmail = new GmailClient(tokenData.refresh_token)
    const recentSenders = await gmail.scanUniqueSenders(14, 500)

    // 3. Get current newsletter sources
    const { data: currentSources, error: sourcesError } = await supabase
      .from('newsletter_sources')
      .select('id, email, name')
      .eq('enabled', true)

    if (sourcesError) {
      return NextResponse.json({ error: sourcesError.message }, { status: 500 })
    }

    // Create a map of current sources by email (lowercase)
    const sourcesByEmail = new Map<string, typeof currentSources[0]>()
    for (const source of currentSources || []) {
      sourcesByEmail.set(source.email.toLowerCase(), source)
    }

    // 4. Analyze
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

    // Find sources without recent emails
    const sourcesWithNoEmails: typeof currentSources = []
    for (const source of currentSources || []) {
      if (!matchedSources.has(source.email.toLowerCase())) {
        sourcesWithNoEmails.push(source)
      }
    }

    // 5. Try to match missing sources with actual senders using smart matching
    const corrections: Array<{
      sourceId: string
      oldEmail: string
      newEmail: string
      sourceName: string
      senderName: string
      confidence: string
      reason: string
    }> = []

    for (const source of sourcesWithNoEmails) {
      const sourceName = source.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sourceEmail = source.email.toLowerCase()
      const sourceEmailUser = sourceEmail.split('@')[0].replace(/[^a-z0-9]/g, '')
      const sourceEmailDomain = sourceEmail.split('@')[1] || ''

      // Extract core domain (e.g., "aisecret" from "aisecret.us", "a16z" from "substack.com")
      const sourceDomainParts = sourceEmailDomain.split('.')
      const sourceCoreDomain = sourceDomainParts[0]

      for (const sender of recentSenders) {
        const senderName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const senderEmail = sender.email.toLowerCase()
        const senderEmailUser = senderEmail.split('@')[0].replace(/[^a-z0-9]/g, '')
        const senderEmailUserRaw = senderEmail.split('@')[0]
        const senderEmailDomain = senderEmail.split('@')[1] || ''
        const senderDomainParts = senderEmailDomain.split('.')

        // Skip if this email is already a source
        if (sourcesByEmail.has(senderEmail)) continue

        // Skip generic senders (noreply, newsletter, etc.)
        if (GENERIC_SENDER_PREFIXES.has(senderEmailUserRaw.replace(/-/g, ''))) continue

        let confidence = ''
        let reason = ''

        // 1. Same domain (different user) - HIGH confidence
        // e.g., newsletter@aisecret.us -> hello@aisecret.us
        // BUT: Skip if it's a generic newsletter platform domain
        if (sourceEmailDomain === senderEmailDomain &&
            sourceEmailUser !== senderEmailUser &&
            !GENERIC_NEWSLETTER_DOMAINS.has(sourceEmailDomain)) {
          confidence = 'HIGH'
          reason = 'same domain, different user'
        }
        // 2. Domain contains source identifier (the unique part before @)
        // e.g., a16z@substack.com -> noreply@email.a16z.com (a16z in domain)
        // Only if sourceEmailUser is specific enough (not generic like "newsletter")
        else if (senderEmailDomain.includes(sourceEmailUser) &&
                 sourceEmailUser.length > 3 &&
                 !GENERIC_SENDER_PREFIXES.has(sourceEmailUser)) {
          confidence = 'HIGH'
          reason = `sender domain contains "${sourceEmailUser}"`
        }
        // 3. Exact name match (strict - names must be meaningful)
        else if (sourceName === senderName && sourceName.length > 5) {
          confidence = 'MEDIUM'  // Downgrade to MEDIUM - names can be ambiguous
          reason = 'exact name match'
        }

        if (confidence) {
          corrections.push({
            sourceId: source.id,
            oldEmail: source.email,
            newEmail: sender.email,
            sourceName: source.name,
            senderName: sender.name,
            confidence,
            reason
          })
          break
        }
      }
    }

    // 6. DON'T auto-apply - just report for manual review
    const applied: string[] = []
    // Disabled auto-apply after wrong corrections
    // const highConfidence = corrections.filter(c => c.confidence === 'HIGH')
    // for (const c of highConfidence) { ... }

    return NextResponse.json({
      success: true,
      stats: {
        totalSources: currentSources?.length || 0,
        sourcesWithEmails: matchedSources.size,
        sourcesWithoutEmails: sourcesWithNoEmails.length,
        potentialNewsletters: missingNewsletters.length,
      },
      sourcesWithoutEmails: sourcesWithNoEmails.map(s => ({
        email: s.email,
        name: s.name
      })),
      corrections: corrections.map(c => ({
        source: c.sourceName,
        oldEmail: c.oldEmail,
        newEmail: c.newEmail,
        senderName: c.senderName,
        confidence: c.confidence,
        reason: c.reason
      })),
      applied,
      suggestedAdditions: missingNewsletters
        .filter(s => s.count >= 2)
        .slice(0, 20)
        .map(s => ({
          email: s.email,
          name: s.name,
          count: s.count,
          subjects: s.subjects.slice(0, 2)
        }))
    })
  } catch (error) {
    console.error('Error analyzing newsletter sources:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// POST to revert wrong corrections
export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'fix-nl-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const results: string[] = []

    // Revert the wrong auto-applied corrections
    const reversions = [
      { name: 'AI Supremacy (Michael Spencer)', correctEmail: 'aisupremacy+siphon@substack.com' },
      { name: 'Machine Learning Pills', correctEmail: 'mlpills@substack.com' },
      { name: 'Azeem Azhar, Exponential View', correctEmail: 'exponentialview@substack.com' },
      { name: 'Five Things', correctEmail: 'getfivethings+tech@substack.com' },
      { name: 'Internal Tech Emails', correctEmail: 'techemails@substack.com' },
      { name: 'Sairam from The Art of Saience', correctEmail: 'artofsaience@substack.com' },
      { name: 'Ben Thompson', correctEmail: 'email@stratechery.com' },
      { name: 'Exponential View', correctEmail: 'exponentialview@substack.com' },
      { name: 'Michael Spencer and Hodman Murad from AI Supremacy', correctEmail: 'aisupremacy+guides@substack.com' },
      { name: 'Newcomer', correctEmail: 'newcomer@substack.com' },
      { name: 'The Neuron', correctEmail: 'team@theneurondaily.com' },
      { name: 'Scarlet Ink', correctEmail: 'scarletink@substack.com' },
    ]

    for (const r of reversions) {
      const { error } = await supabase
        .from('newsletter_sources')
        .update({ email: r.correctEmail })
        .eq('name', r.name)

      if (error) {
        results.push(`ERROR ${r.name}: ${error.message}`)
      } else {
        results.push(`REVERTED: ${r.name} -> ${r.correctEmail}`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
