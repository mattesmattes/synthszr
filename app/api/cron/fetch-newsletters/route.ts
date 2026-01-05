import { NextRequest, NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'
import { extractArticleContent } from '@/lib/scraper/article-extractor'
import { createClient } from '@supabase/supabase-js'
import { jwtVerify } from 'jose'

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

// Supabase client for cron jobs (no cookies needed)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Vercel Cron protection
const CRON_SECRET = process.env.CRON_SECRET
const SESSION_COOKIE_NAME = 'synthszr_session'

function getSecretKey() {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) return null
  return new TextEncoder().encode(secret)
}

async function isAdminSession(request: NextRequest): Promise<boolean> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionToken) return false

  const secretKey = getSecretKey()
  if (!secretKey) return false

  try {
    await jwtVerify(sessionToken, secretKey)
    return true
  } catch {
    return false
  }
}

// Shared newsletter processing logic
async function processNewsletters() {
  const supabase = getSupabase()

  // Get Gmail tokens (single-user setup)
  const { data: tokenData, error: tokenError } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .limit(1)
    .single()

  if (tokenError || !tokenData?.refresh_token) {
    return {
      success: false,
      error: 'Gmail not connected. Please connect Gmail in Settings first.',
      status: 400
    }
  }

  // Get enabled newsletter sources
  const { data: sources, error: sourcesError } = await supabase
    .from('newsletter_sources')
    .select('email, name')
    .eq('enabled', true)

  if (sourcesError || !sources || sources.length === 0) {
    return {
      success: true,
      message: 'No enabled newsletter sources',
      processed: 0,
      articles: 0,
    }
  }

  // Get the last fetch timestamp
  const { data: settings } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  // For first fetch or missing timestamp, search last 36 hours
  const lastFetch = settings?.value?.timestamp
    ? new Date(settings.value.timestamp)
    : new Date(Date.now() - 36 * 60 * 60 * 1000) // Default: last 36 hours

  console.log('[Fetch] Last fetch timestamp:', lastFetch.toISOString())

  // Fetch emails from Gmail (up to 50 newsletters per run)
  const gmailClient = new GmailClient(tokenData.refresh_token)
  const senderEmails = sources.map(s => s.email)
  const emails = await gmailClient.fetchEmailsFromSenders(senderEmails, 50, lastFetch)

  let processedNewsletters = 0
  let processedArticles = 0
  let errors = 0
  const processedItems: Array<{ type: string; title: string; from?: string; url?: string; links?: number }> = []
  const errorDetails: Array<{ subject: string; error: string }> = []
  const articleUrls: Array<{ url: string; title: string; newsletterDate: string }> = []

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

      // Extract article links for processing
      const articleLinks = parsed.links.filter(link => link.type === 'article')
      for (const link of articleLinks) {
        articleUrls.push({
          url: link.url,
          title: link.text || 'Unbekannter Artikel',
          newsletterDate: email.date.toISOString().split('T')[0]
        })
      }

      // Store newsletter in daily_repo (full content, no truncation)
      // Also store the first article URL as source_url so newsletters have linkable sources
      const primaryArticleUrl = articleLinks.length > 0 ? articleLinks[0].url : null
      const { error: insertError } = await supabase
        .from('daily_repo')
        .insert({
          source_type: 'newsletter',
          source_email: email.from,
          source_url: primaryArticleUrl, // First article link from newsletter
          title: email.subject,
          content: parsed.plainText, // Full newsletter content
          raw_html: htmlContent,
          newsletter_date: email.date.toISOString().split('T')[0],
        })

      if (insertError) {
        console.error('Error inserting newsletter:', insertError)
        errors++
        errorDetails.push({ subject: email.subject, error: insertError.message })
      } else {
        processedNewsletters++
        processedItems.push({
          type: 'newsletter',
          title: email.subject,
          from: email.from,
          links: articleLinks.length
        })
      }
    } catch (err) {
      console.error('Error processing email:', err)
      errors++
      errorDetails.push({ subject: email.subject, error: err instanceof Error ? err.message : 'Unknown' })
    }
  }

  // Process article links (up to 25 articles per run)
  const articlesToProcess = articleUrls.slice(0, 25)
  console.log(`[Cron] Processing ${articlesToProcess.length} articles from ${articleUrls.length} total links`)

  for (const article of articlesToProcess) {
    try {
      // Check if article already exists
      const { data: existingArticle } = await supabase
        .from('daily_repo')
        .select('id')
        .eq('source_url', article.url)
        .single()

      if (existingArticle) {
        continue // Already processed
      }

      const extracted = await extractArticleContent(article.url)

      if (extracted && extracted.content) {
        const { error: articleInsertError } = await supabase
          .from('daily_repo')
          .insert({
            source_type: 'article',
            source_url: article.url,
            title: extracted.title || article.title,
            content: extracted.content, // Full article content
            newsletter_date: article.newsletterDate,
          })

        if (!articleInsertError) {
          processedArticles++
          processedItems.push({
            type: 'article',
            title: extracted.title || article.title,
            url: article.url
          })
        }
      }
    } catch (err) {
      console.error(`Error extracting article ${article.url}:`, err)
      // Don't count article extraction failures as critical errors
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

  return {
    success: true,
    message: `Processed ${processedNewsletters} newsletters and ${processedArticles} articles`,
    processed: processedNewsletters,
    articles: processedArticles,
    errors,
    totalEmails: emails.length,
    processedItems,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
  }
}

// GET for Vercel Cron (automatic scheduling)
export async function GET(request: NextRequest) {
  // Verify cron secret in production (for Vercel Cron)
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await processNewsletters()

    if ('status' in result && result.status) {
      return NextResponse.json(result, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Cron fetch-newsletters error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

// POST for manual triggers from admin panel (requires admin session)
export async function POST(request: NextRequest) {
  // Check if user is authenticated as admin
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminSession(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await processNewsletters()

    if ('status' in result && result.status) {
      return NextResponse.json(result, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Manual fetch-newsletters error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
