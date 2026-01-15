import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GmailClient } from '@/lib/gmail/client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'test-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const { data: tokenData } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (!tokenData?.refresh_token) {
      return NextResponse.json({ error: 'No Gmail token' }, { status: 400 })
    }

    const gmail = new GmailClient(tokenData.refresh_token)

    // Test specific emails that user reported
    const testEmails = [
      'connie@strictlyvc.com',
      'status@mail.status.news',
      'hi@mail.theresanaiforthat.com',
      'futurism@mail.beehiiv.com',
      'theleverage@substack.com',
    ]

    const results: Record<string, { found: number; subjects: string[] }> = {}

    // Test each email individually
    for (const email of testEmails) {
      const emails = await gmail.fetchEmailsFromSenders([email], 5, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      results[email] = {
        found: emails.length,
        subjects: emails.map(e => e.subject.slice(0, 50)),
      }
    }

    // Also get enabled source count
    const { data: sources } = await supabase
      .from('newsletter_sources')
      .select('email')
      .eq('enabled', true)

    // Test batch fetch with all sources (same params as processor)
    const allEmails = sources?.map(s => s.email) || []
    const batchResult = await gmail.fetchEmailsFromSenders(
      allEmails,
      50, // Same as processor
      new Date(Date.now() - 36 * 60 * 60 * 1000) // Last 36h (same as processor default)
    )

    // Check if test emails are in batch results
    const testEmailsInBatch = batchResult.filter(e =>
      testEmails.some(te => e.from.toLowerCase().includes(te.split('@')[0]))
    )

    return NextResponse.json({
      individualTests: results,
      batchTest: {
        sourcesCount: allEmails.length,
        emailsFound: batchResult.length,
        testEmailsFoundInBatch: testEmailsInBatch.length,
        testEmailsSubjects: testEmailsInBatch.map(e => ({
          from: e.from,
          subject: e.subject.slice(0, 50)
        })),
        sampleSubjects: batchResult.slice(0, 10).map(e => ({
          from: e.from,
          subject: e.subject.slice(0, 50)
        }))
      }
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
