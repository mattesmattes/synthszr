import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'
import { extractArticleContent } from '@/lib/scraper/article-extractor'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_NEWSLETTER_FETCH_MS, MS_PER_HOUR } from '@/lib/config/constants'
import { generateEmbedding, prepareTextForEmbedding } from '@/lib/embeddings/generator'

export interface NewsletterProcessResult {
  success: boolean
  message?: string
  error?: string
  status?: number
  processed?: number
  articles?: number
  articleStats?: {
    attempted: number
    stored: number
    skipped: number
    failed: number
    noContent: number
  }
  errors?: number
  totalEmails?: number
  processedItems?: Array<{ type: string; title: string; from?: string; url?: string; links?: number }>
  errorDetails?: Array<{ subject: string; error: string }>
  debug?: {
    latestEntryAt?: string
    fetchingSince?: string
    skippedDuplicates?: number
    enabledSources?: number
    labelPattern?: string
    gmailQuery?: string
  }
}

export interface NewsletterProcessOptions {
  /** Force fetch since a specific date (ISO string or Date) */
  forceSince?: string | Date
  /** Label pattern to fetch from (e.g., "newsstand" matches "newsstand-ai", "newsstand-marketing") */
  labelPattern?: string
  /** Skip fetching from registered sources (only fetch from labels) */
  labelsOnly?: boolean
}

/**
 * Process newsletters from Gmail - shared logic for both cron and manual triggers
 * @param options.forceSince - Force fetch since a specific date (bypasses auto-detection)
 */
export async function processNewsletters(options?: NewsletterProcessOptions): Promise<NewsletterProcessResult> {
  const supabase = createAdminClient()

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

  // Determine fetch window based on the LAST EXISTING entry in daily_repo
  // This ensures we don't miss newsletters if today's entries were deleted
  const { data: latestEntry } = await supabase
    .from('daily_repo')
    .select('collected_at, newsletter_date')
    .order('collected_at', { ascending: false })
    .limit(1)
    .single()

  // Also get the last_newsletter_fetch setting as a fallback
  const { data: settings } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'last_newsletter_fetch')
    .single()

  // Use forceSince if provided, otherwise auto-detect
  let lastFetch: Date
  let debugLatestEntryAt: string | undefined

  if (options?.forceSince) {
    // Manual override - use the provided date
    lastFetch = new Date(options.forceSince)
    console.log('[Newsletter] FORCED fetch since:', lastFetch.toISOString())
  } else if (latestEntry?.collected_at) {
    // Use the timestamp of the most recent entry still in the database
    lastFetch = new Date(latestEntry.collected_at)
    debugLatestEntryAt = `${latestEntry.collected_at} (date: ${latestEntry.newsletter_date})`
    console.log('[Newsletter] Using last existing entry timestamp:', lastFetch.toISOString(), 'newsletter_date:', latestEntry.newsletter_date)
  } else if (settings?.value?.timestamp) {
    // Fallback to settings if no entries exist
    lastFetch = new Date(settings.value.timestamp)
    console.log('[Newsletter] Using settings timestamp:', lastFetch.toISOString())
  } else {
    // Default: 36h lookback
    lastFetch = new Date(Date.now() - DEFAULT_NEWSLETTER_FETCH_MS)
    console.log('[Newsletter] Using default 36h lookback')
  }

  console.log('[Newsletter] Fetching newsletters since:', lastFetch.toISOString())
  const debugFetchingSince = lastFetch.toISOString()

  // Fetch emails from Gmail (up to 50 newsletters per run)
  const gmailClient = new GmailClient(tokenData.refresh_token)
  const senderEmails = sources.map(s => s.email)

  // Build the query for debug output
  const fromQuery = senderEmails.map(email => `from:${email}`).join(' OR ')
  const dateStr = lastFetch.toISOString().split('T')[0].replace(/-/g, '/')
  const debugGmailQuery = `(${fromQuery}) after:${dateStr}`

  const emails: Awaited<ReturnType<typeof gmailClient.fetchEmailsFromSenders>> = []
  const emailIds = new Set<string>()

  // STEP 1: Fetch from registered sources (unless labelsOnly)
  if (!options?.labelsOnly) {
    console.log('[Newsletter] Enabled sources:', senderEmails.length, 'emails:', senderEmails.join(', '))
    console.log('[Newsletter] Gmail query:', debugGmailQuery.slice(0, 200) + '...')

    const sourceEmails = await gmailClient.fetchEmailsFromSenders(senderEmails, 50, lastFetch)
    console.log('[Newsletter] Gmail returned:', sourceEmails.length, 'emails from registered sources')

    for (const email of sourceEmails) {
      if (!emailIds.has(email.id)) {
        emails.push(email)
        emailIds.add(email.id)
        console.log(`[Newsletter] - From: ${email.from} | Subject: ${email.subject.slice(0, 50)}...`)
      }
    }
  }

  // STEP 2: Fetch from Gmail labels (newsstand-* by default)
  // This catches newsletters that are labeled but not registered as sources
  const labelPattern = options?.labelPattern ?? 'newsstand'
  console.log(`[Newsletter] Fetching from labels matching: "${labelPattern}"`)

  try {
    const labelEmails = await gmailClient.fetchEmailsFromLabels(labelPattern, 50, lastFetch)
    console.log(`[Newsletter] Found ${labelEmails.length} emails from labels`)

    let labelEmailsAdded = 0
    for (const email of labelEmails) {
      if (!emailIds.has(email.id)) {
        emails.push(email)
        emailIds.add(email.id)
        labelEmailsAdded++
        console.log(`[Newsletter] + Label: ${email.from} | ${email.subject.slice(0, 50)}...`)
      }
    }
    console.log(`[Newsletter] Added ${labelEmailsAdded} new emails from labels (${labelEmails.length - labelEmailsAdded} duplicates skipped)`)
  } catch (labelError) {
    console.error('[Newsletter] Error fetching from labels:', labelError)
    // Continue - label fetch is optional
  }

  // STEP 3: Fetch emails with "+dailyrepo" subject tag (user-tagged emails for import)
  const hoursBack = Math.ceil((Date.now() - lastFetch.getTime()) / MS_PER_HOUR) || 36
  const taggedEmails = await gmailClient.fetchEmailsBySubject(null, '+dailyrepo', 20, hoursBack)
  console.log(`[Newsletter] Found ${taggedEmails.length} emails with +dailyrepo tag`)

  for (const taggedEmail of taggedEmails) {
    if (!emailIds.has(taggedEmail.id)) {
      emails.push(taggedEmail)
      emailIds.add(taggedEmail.id)
    }
  }

  console.log(`[Newsletter] Total unique emails to process: ${emails.length}`)

  let processedNewsletters = 0
  let processedArticles = 0
  let skippedDuplicates = 0
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
        console.log(`[Newsletter] SKIPPED (duplicate): ${email.subject.slice(0, 50)}... from ${email.from}`)
        skippedDuplicates++
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
      const { data: insertedNewsletter, error: insertError } = await supabase
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
        .select('id')
        .single()

      if (insertError) {
        console.error('[Newsletter] Error inserting:', insertError)
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

        // Generate embedding for the newsletter
        try {
          const text = prepareTextForEmbedding(email.subject, parsed.plainText)
          if (text.length >= 10) {
            const embedding = await generateEmbedding(text)
            const embeddingString = `[${embedding.join(',')}]`
            await supabase
              .from('daily_repo')
              .update({ embedding: embeddingString })
              .eq('id', insertedNewsletter.id)
          }
        } catch (embeddingError) {
          console.error('[Newsletter] Error generating embedding:', embeddingError)
          // Don't fail the whole process for embedding errors
        }
      }
    } catch (err) {
      console.error('[Newsletter] Error processing email:', err)
      errors++
      errorDetails.push({ subject: email.subject, error: err instanceof Error ? err.message : 'Unknown' })
    }
  }

  // Process article links (up to 25 articles per run)
  const articlesToProcess = articleUrls.slice(0, 25)
  console.log(`[Newsletter] Processing ${articlesToProcess.length} articles from ${articleUrls.length} total links`)

  let articlesSkipped = 0
  let articlesFailed = 0
  let articlesNoContent = 0

  for (const article of articlesToProcess) {
    try {
      // Check if article already exists (by URL or resolved URL)
      const { data: existingArticle } = await supabase
        .from('daily_repo')
        .select('id')
        .eq('source_url', article.url)
        .single()

      if (existingArticle) {
        articlesSkipped++
        continue // Already processed
      }

      const extracted = await extractArticleContent(article.url)

      if (!extracted) {
        articlesFailed++
        console.log(`[Newsletter] Extraction failed for: ${article.url.slice(0, 60)}...`)
        continue
      }

      if (!extracted.content) {
        articlesNoContent++
        console.log(`[Newsletter] No content extracted for: ${article.url.slice(0, 60)}...`)
        continue
      }

      // Use the resolved final URL if available, otherwise the original
      const sourceUrl = extracted.finalUrl || article.url

      // Check for duplicate by resolved URL too
      const { data: existingByFinalUrl } = await supabase
        .from('daily_repo')
        .select('id')
        .eq('source_url', sourceUrl)
        .single()

      if (existingByFinalUrl) {
        articlesSkipped++
        continue
      }

      const { error: articleInsertError } = await supabase
        .from('daily_repo')
        .insert({
          source_type: 'article',
          source_url: sourceUrl, // Use resolved URL
          title: extracted.title || article.title,
          content: extracted.content, // Full article content
          newsletter_date: article.newsletterDate,
        })

      if (!articleInsertError) {
        processedArticles++
        processedItems.push({
          type: 'article',
          title: extracted.title || article.title,
          url: sourceUrl
        })

        // Generate embedding for the article
        try {
          const { data: insertedArticle } = await supabase
            .from('daily_repo')
            .select('id')
            .eq('source_url', sourceUrl)
            .single()

          if (insertedArticle) {
            const articleText = prepareTextForEmbedding(
              extracted.title || article.title,
              extracted.content
            )
            if (articleText.length >= 10) {
              const articleEmbedding = await generateEmbedding(articleText)
              const articleEmbeddingString = `[${articleEmbedding.join(',')}]`
              await supabase
                .from('daily_repo')
                .update({ embedding: articleEmbeddingString })
                .eq('id', insertedArticle.id)
            }
          }
        } catch (embeddingError) {
          console.error('[Newsletter] Error generating article embedding:', embeddingError)
          // Don't fail the whole process for embedding errors
        }
      } else {
        console.error(`[Newsletter] Insert error for ${sourceUrl}:`, articleInsertError.message)
      }
    } catch (err) {
      articlesFailed++
      console.error(`[Newsletter] Error extracting article ${article.url}:`, err)
      // Don't count article extraction failures as critical errors
    }
  }

  console.log(`[Newsletter] Article processing: ${processedArticles} stored, ${articlesSkipped} skipped (existing), ${articlesFailed} failed, ${articlesNoContent} no content`)

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
    articleStats: {
      attempted: articlesToProcess.length,
      stored: processedArticles,
      skipped: articlesSkipped,
      failed: articlesFailed,
      noContent: articlesNoContent,
    },
    errors,
    totalEmails: emails.length,
    processedItems,
    errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    debug: {
      latestEntryAt: debugLatestEntryAt,
      fetchingSince: debugFetchingSince,
      skippedDuplicates,
      enabledSources: senderEmails.length,
      labelPattern,
      gmailQuery: debugGmailQuery.length > 500 ? debugGmailQuery.slice(0, 500) + '...' : debugGmailQuery,
    },
  }
}
