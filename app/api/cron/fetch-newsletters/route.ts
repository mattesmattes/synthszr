import { NextRequest, NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'
import { createClient } from '@/lib/supabase/server'

// Vercel Cron protection
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: NextRequest) {
  // Verify cron secret in production
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const supabase = await createClient()

    // Get Gmail tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .eq('id', 'primary')
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json({
        success: false,
        error: 'Gmail not connected',
      }, { status: 400 })
    }

    // Get enabled newsletter sources
    const { data: sources, error: sourcesError } = await supabase
      .from('newsletter_sources')
      .select('email, name')
      .eq('enabled', true)

    if (sourcesError || !sources || sources.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No enabled newsletter sources',
        processed: 0,
      })
    }

    // Get the last fetch timestamp
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'last_newsletter_fetch')
      .single()

    const lastFetch = settings?.value?.timestamp
      ? new Date(settings.value.timestamp)
      : new Date(Date.now() - 24 * 60 * 60 * 1000) // Default: last 24 hours

    // Fetch emails from Gmail
    const gmailClient = new GmailClient(tokenData.refresh_token)
    const senderEmails = sources.map(s => s.email)
    const emails = await gmailClient.fetchEmailsFromSenders(senderEmails, 50, lastFetch)

    let processed = 0
    let errors = 0

    // Process each email
    for (const email of emails) {
      try {
        // Check if already processed
        const { data: existing } = await supabase
          .from('daily_repo')
          .select('id')
          .eq('source_email', email.from)
          .eq('title', email.subject)
          .single()

        if (existing) {
          continue // Already processed
        }

        // Parse the newsletter
        const htmlContent = email.htmlBody || email.textBody || ''
        const parsed = parseNewsletterHtml(
          htmlContent,
          email.subject,
          email.from,
          email.date
        )

        // Extract article links for later processing
        const articleLinks = parsed.links
          .filter(link => link.type === 'article')
          .map(link => link.url)

        // Store in daily_repo
        const { error: insertError } = await supabase
          .from('daily_repo')
          .insert({
            source_type: 'newsletter',
            source_email: email.from,
            title: email.subject,
            content: parsed.plainText,
            raw_html: htmlContent,
            newsletter_date: email.date.toISOString().split('T')[0],
            metadata: {
              links: parsed.links,
              images: parsed.images,
              article_urls: articleLinks,
            },
          })

        if (insertError) {
          console.error('Error inserting newsletter:', insertError)
          errors++
        } else {
          processed++
        }
      } catch (err) {
        console.error('Error processing email:', err)
        errors++
      }
    }

    // Update last fetch timestamp
    await supabase
      .from('settings')
      .upsert({
        key: 'last_newsletter_fetch',
        value: { timestamp: new Date().toISOString() },
      }, {
        onConflict: 'key'
      })

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} newsletters`,
      processed,
      errors,
      totalEmails: emails.length,
    })
  } catch (error) {
    console.error('Cron fetch-newsletters error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

// Also allow POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
