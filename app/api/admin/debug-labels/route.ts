import { NextRequest, NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/auth/session'
import { processNewsletters } from '@/lib/newsletter/processor'

export const runtime = 'nodejs'

// POST to trigger a fetch with forceSince
export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const debugSecret = url.searchParams.get('secret')

  if (process.env.NODE_ENV === 'production' && debugSecret !== 'debug-labels-2026') {
    const isAdmin = await isAdminRequest(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Force fetch from 2 days ago
  const forceSince = new Date()
  forceSince.setDate(forceSince.getDate() - 2)

  const result = await processNewsletters({ forceSince: forceSince.toISOString() })
  return NextResponse.json(result)
}

export async function GET(request: NextRequest) {
  // Check admin auth in production (allow temp debug secret)
  const url = new URL(request.url)
  const debugSecret = url.searchParams.get('secret')

  if (process.env.NODE_ENV === 'production' && debugSecret !== 'debug-labels-2026') {
    const isAdmin = await isAdminRequest(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createAdminClient()

  // Get Gmail token
  const { data: tokenData } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .limit(1)
    .single()

  if (!tokenData?.refresh_token) {
    return NextResponse.json({ error: 'No Gmail token' }, { status: 400 })
  }

  const client = new GmailClient(tokenData.refresh_token)

  try {
    // List all labels
    const labels = await client.listLabels()

    // Find newsstand labels
    const newsstandLabels = labels.filter(l =>
      l.name.toLowerCase().includes('newsstand')
    )

    // Also find labels that might be newsletter-related
    const newsletterLabels = labels.filter(l =>
      l.name.toLowerCase().includes('news') ||
      l.name.toLowerCase().includes('letter') ||
      l.name.toLowerCase().includes('digest')
    )

    // Test fetch from newsstand labels
    const afterDate = new Date()
    afterDate.setDate(afterDate.getDate() - 2) // Last 2 days

    let labelEmails: any[] = []
    if (newsstandLabels.length > 0) {
      labelEmails = await client.fetchEmailsFromLabels('newsstand', 10, afterDate)
    }

    return NextResponse.json({
      totalLabels: labels.length,
      allUserLabels: labels
        .filter(l => !l.name.startsWith('CATEGORY_') &&
          !['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'UNREAD', 'IMPORTANT', 'CHAT'].includes(l.name))
        .map(l => l.name)
        .slice(0, 50),
      newsstandLabels: newsstandLabels.map(l => l.name),
      newsletterRelatedLabels: newsletterLabels.map(l => l.name),
      testFetchResults: {
        pattern: 'newsstand',
        afterDate: afterDate.toISOString(),
        emailsFound: labelEmails.length,
        emails: labelEmails.map(e => ({
          from: e.from?.slice(0, 50),
          subject: e.subject?.slice(0, 50),
        }))
      }
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
