import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GmailClient } from '@/lib/gmail/client'

// Domains/patterns that are typically ads or transactional emails, not newsletters
const AD_PATTERNS = [
  'noreply',
  'no-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
  'notifications@',
  'alerts@',
  'billing@',
  'invoice@',
  'receipt@',
  'order@',
  'shipping@',
  'delivery@',
  'tracking@',
  'support@',
  'help@',
  'feedback@',
  'survey@',
  'promo@',
  'deals@',
  'sales@',
  'marketing@',
  'ads@',
  'advertisement@',
  'unsubscribe',
  '@bounce.',
  '@email.amazon',
  '@amazon.com',
  '@paypal.com',
  '@ebay.com',
  '@linkedin.com',
  '@facebookmail.com',
  '@twitter.com',
  '@accounts.google',
  '@google.com',
  '@apple.com',
  '@microsoft.com',
  '@outlook.com',
  '@github.com',
  '@gitlab.com',
  '@vercel.com',
  '@stripe.com',
  '@shopify.com',
]

// Domains that are typically newsletter platforms (positive indicator)
const NEWSLETTER_PLATFORM_DOMAINS = [
  'substack.com',
  'beehiiv.com',
  'buttondown.email',
  'mailchimp.com',
  'convertkit.com',
  'revue.co',
  'ghost.io',
  'tinyletter.com',
  'getrevue.co',
  'substackcdn.com',
]

function isLikelyAd(email: string, name: string): boolean {
  const emailLower = email.toLowerCase()
  const nameLower = name.toLowerCase()

  // Check against ad patterns
  for (const pattern of AD_PATTERNS) {
    if (emailLower.includes(pattern) || nameLower.includes(pattern)) {
      return true
    }
  }

  return false
}

function isLikelyNewsletter(email: string, subjects: string[]): boolean {
  const emailLower = email.toLowerCase()

  // Check if from known newsletter platform
  for (const domain of NEWSLETTER_PLATFORM_DOMAINS) {
    if (emailLower.includes(domain)) {
      return true
    }
  }

  // Check subjects for newsletter-like patterns
  const newsletterKeywords = [
    'newsletter',
    'digest',
    'weekly',
    'daily',
    'roundup',
    'update',
    'edition',
    'issue',
    '#',
    'briefing',
  ]

  for (const subject of subjects) {
    const subjectLower = subject.toLowerCase()
    for (const keyword of newsletterKeywords) {
      if (subjectLower.includes(keyword)) {
        return true
      }
    }
  }

  return false
}

export async function GET() {
  try {
    const supabase = await createClient()

    // Get Gmail refresh token from gmail_tokens table
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json(
        { error: 'Gmail not connected. Please connect Gmail first.' },
        { status: 400 }
      )
    }

    const refreshToken = tokenData.refresh_token

    // Get existing newsletter sources to exclude
    const { data: existingSources } = await supabase
      .from('newsletter_sources')
      .select('email')

    const existingEmails = new Set(
      (existingSources || []).map(s => s.email.toLowerCase())
    )

    // Scan Gmail for unique senders
    const gmail = new GmailClient(refreshToken)
    const senders = await gmail.scanUniqueSenders(30, 500)

    // Filter and score senders
    const filteredSenders = senders
      .filter(sender => {
        // Exclude already added sources
        if (existingEmails.has(sender.email.toLowerCase())) {
          return false
        }

        // Exclude obvious ads
        if (isLikelyAd(sender.email, sender.name)) {
          return false
        }

        // Must have at least 2 emails to be considered a newsletter
        if (sender.count < 2) {
          return false
        }

        return true
      })
      .map(sender => ({
        ...sender,
        isLikelyNewsletter: isLikelyNewsletter(sender.email, sender.subjects),
        latestDate: sender.latestDate.toISOString(),
      }))
      // Sort: likely newsletters first, then by count
      .sort((a, b) => {
        if (a.isLikelyNewsletter && !b.isLikelyNewsletter) return -1
        if (!a.isLikelyNewsletter && b.isLikelyNewsletter) return 1
        return b.count - a.count
      })

    return NextResponse.json({
      senders: filteredSenders,
      total: senders.length,
      filtered: filteredSenders.length,
    })
  } catch (error) {
    console.error('Error scanning Gmail senders:', error)
    return NextResponse.json(
      { error: 'Failed to scan Gmail senders' },
      { status: 500 }
    )
  }
}
