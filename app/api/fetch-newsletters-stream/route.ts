import { NextRequest } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'
import { extractArticleContent, isArticleTooOld, isLikelyArticleUrl, isNonArticleLinkText } from '@/lib/scraper/article-extractor'
import { createClient } from '@/lib/supabase/server'
import { isAdminRequest } from '@/lib/auth/session'
import { DEFAULT_NEWSLETTER_FETCH_MS } from '@/lib/config/constants'
import { getLastFetchTimestamp, updateLastFetchTimestamp } from '@/lib/newsletter/timestamp'

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

/**
 * Extract specific Substack newsletter URL from email address
 * e.g., "Machine Learning Pills <mlpills@substack.com>" → "https://mlpills.substack.com"
 */
function getSubstackNewsletterUrl(email: string | null): string | null {
  if (!email || !email.includes('@substack.com')) return null
  const match = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!match) return null
  // Remove + variants (e.g., "getfivethings+tech" → "getfivethings")
  const subdomain = match[1].split('+')[0]
  return `https://${subdomain}.substack.com`
}

/**
 * Detect if a newsletter contains full article content vs. being a digest with teasers.
 * Full-content newsletters don't need article extraction - the newsletter IS the article.
 *
 * CONSERVATIVE approach: Only skip article extraction when we're VERY sure it's full content.
 * It's better to try crawling and fail than to miss articles.
 *
 * @param plainText - The newsletter's plain text content
 * @param totalArticleLinks - Number of links categorized as 'article' type (BEFORE URL filtering)
 * @param senderEmail - The sender's email address
 */
function isFullContentNewsletter(
  plainText: string,
  totalArticleLinks: number,
  senderEmail: string | null
): boolean {
  const contentLength = plainText?.length || 0

  // Known DIGEST newsletter patterns - NEVER skip these, always try to extract articles
  const knownDigestPatterns = [
    /getfivethings/i,           // Five Things Tech
    /morningbrew/i,             // Morning Brew
    /techmeme/i,                // Techmeme
    /theinformation/i,          // The Information
    /strictlyvc/i,              // StrictlyVC
    /businessinsider/i,         // Business Insider
    /washingtonpost/i,          // Washington Post
    /nytimes/i,                 // New York Times
    /wsj\.com/i,                // Wall Street Journal
    /newyorker/i,               // New Yorker
    /theatlantic/i,             // The Atlantic
    /beehiiv/i,                 // Beehiiv newsletters (often digests)
    /handelsblatt/i,            // Handelsblatt
  ]

  const isKnownDigest = knownDigestPatterns.some(p => p.test(senderEmail || ''))
  if (isKnownDigest) {
    return false  // Always try to extract articles from known digests
  }

  // If there are many article-type links (3+), it's likely a digest
  if (totalArticleLinks >= 3) {
    return false
  }

  // Very short content is never "full content"
  if (contentLength < 2000) return false

  // Only consider "full content" if:
  // 1. Very substantial content (10000+ chars) AND
  // 2. Very few article links (0-1)
  // This is a VERY conservative threshold
  if (contentLength > 10000 && totalArticleLinks <= 1) {
    console.log(`[Newsletter Fetch] Detected as FULL CONTENT newsletter (${contentLength} chars, ${totalArticleLinks} article links)`)
    return true
  }

  // Personal Substack with substantial content and NO article links = likely full content
  const isSubstack = senderEmail?.includes('@substack.com')
  if (isSubstack && contentLength > 5000 && totalArticleLinks === 0) {
    console.log(`[Newsletter Fetch] Detected as FULL CONTENT Substack (${contentLength} chars, 0 article links)`)
    return true
  }

  return false
}

// Configuration for +dailyrepo email imports
const EMAIL_NOTE_CONFIG = {
  senderEmail: null, // No sender filter - any email with +dailyrepo in subject
  subjectTag: '+dailyrepo',
  hoursBack: 24,
}

/**
 * Extract plain text from email body for email notes
 */
function extractPlainTextFromEmail(htmlBody: string | null, textBody: string | null): string {
  if (textBody) return textBody.trim()
  if (!htmlBody) return ''

  return htmlBody
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n/g, '\n\n')
    .trim()
}

/**
 * Clean up the subject line by removing the +dailyrepo tag
 */
function cleanDailyRepoSubject(subject: string): string {
  return subject
    .replace(/\+dailyrepo/gi, '')
    .replace(/^\s*[-:]\s*/, '')
    .trim() || 'E-Mail Notiz'
}

interface UnfetchedEmail {
  email: string
  name: string
  count: number
  subjects: string[]
  latestDate: string
}

interface ProgressEvent {
  type: 'start' | 'newsletter' | 'article' | 'email_note' | 'unfetched_emails' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'importing_notes' | 'scanning_unfetched' | 'done'
  current?: number
  total?: number
  item?: {
    title: string
    from?: string
    url?: string
    status: 'pending' | 'processing' | 'success' | 'error' | 'skipped'
    error?: string
  }
  summary?: {
    newsletters: number
    articles: number
    emailNotes: number
    errors: number
    totalCharacters: number
  }
  unfetchedEmails?: UnfetchedEmail[]
}

export async function POST(request: NextRequest) {
  // Check admin session
  if (!(await isAdminRequest(request))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Parse request body for optional targetDate and force flag
  let targetDate: string | undefined
  let force = false
  try {
    const body = await request.json()
    targetDate = body.targetDate
    force = body.force === true
  } catch {
    // No body or invalid JSON - that's fine, use default behavior
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        console.log('[Newsletter Fetch] Starting...', targetDate ? `for date ${targetDate}` : 'since last crawl')
        const supabase = await createClient()

        // Get Gmail tokens
        console.log('[Newsletter Fetch] Getting Gmail tokens...')
        const { data: tokenData, error: tokenError } = await supabase
          .from('gmail_tokens')
          .select('refresh_token')
          .limit(1)
          .single()

        if (tokenError || !tokenData?.refresh_token) {
          send({ type: 'error', phase: 'fetching', item: { title: 'Gmail nicht verbunden', status: 'error' } })
          controller.close()
          return
        }

        // Get enabled newsletter sources
        const { data: sources } = await supabase
          .from('newsletter_sources')
          .select('email, name')
          .eq('enabled', true)

        if (!sources || sources.length === 0) {
          send({ type: 'complete', phase: 'done', summary: { newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 } })
          controller.close()
          return
        }

        send({ type: 'start', phase: 'fetching', total: sources.length })

        // Fetch emails - use targetDate if provided, otherwise since last crawl
        const gmailClient = new GmailClient(tokenData.refresh_token)
        let afterDate: Date
        let beforeDate: Date | undefined

        if (targetDate) {
          // For specific date: search for emails from that day (historical re-import)
          // Use UTC dates to avoid timezone issues with Gmail's date query
          afterDate = new Date(targetDate + 'T00:00:00Z')  // Force UTC
          beforeDate = new Date(targetDate + 'T23:59:59Z')  // Force UTC
          console.log(`[Newsletter Fetch] Historical import for date range: ${targetDate} (UTC: ${afterDate.toISOString()} to ${beforeDate.toISOString()})`)
        } else {
          // No targetDate: fetch all emails since last successful crawl
          // Timestamp is derived from actual daily_repo data to ensure consistency
          // This prevents issues when items are deleted - the timestamp auto-adjusts
          afterDate = await getLastFetchTimestamp(supabase, DEFAULT_NEWSLETTER_FETCH_MS / (1000 * 60 * 60))
          console.log(`[Newsletter Fetch] Fetching since: ${afterDate.toISOString()}`)
        }

        const senderEmails = sources.map(s => s.email)

        send({ type: 'newsletter', phase: 'fetching', item: { title: 'Emails werden abgerufen...', status: 'processing' } })

        // Dynamic maxResults: at least 2 emails per source, minimum 200
        const maxResults = Math.max(200, senderEmails.length * 2)
        console.log('[Newsletter Fetch] Fetching emails from', senderEmails.length, 'sources (maxResults:', maxResults, '):', senderEmails.slice(0, 5), senderEmails.length > 5 ? '...' : '')

        // Fetch emails from registered sources
        const senderEmails_fetched = await gmailClient.fetchEmailsFromSenders(senderEmails, maxResults, afterDate, beforeDate)
        console.log('[Newsletter Fetch] Fetched', senderEmails_fetched.length, 'emails from sources')

        // Also fetch emails from newsstand labels (catches newsletters not yet registered as sources)
        const NEWSSTAND_LABELS = ['newsstand-ai', 'newsstand-marketing', '#newsstand-ai', '#newsstand-marketing']
        send({ type: 'newsletter', phase: 'fetching', item: { title: 'Emails aus Labels werden abgerufen...', status: 'processing' } })

        let labelEmails: typeof senderEmails_fetched = []
        for (const labelPattern of NEWSSTAND_LABELS) {
          try {
            const emails = await gmailClient.fetchEmailsFromLabels(labelPattern, 100, afterDate)
            if (emails.length > 0) {
              console.log(`[Newsletter Fetch] Fetched ${emails.length} emails from label "${labelPattern}"`)
              labelEmails = labelEmails.concat(emails)
            }
          } catch (err) {
            console.log(`[Newsletter Fetch] No emails from label "${labelPattern}" (may not exist)`)
          }
        }
        console.log('[Newsletter Fetch] Total emails from labels:', labelEmails.length)

        // Merge and deduplicate by email ID
        const seenIds = new Set<string>()
        let allEmails: typeof senderEmails_fetched = []

        for (const email of [...senderEmails_fetched, ...labelEmails]) {
          if (!seenIds.has(email.id)) {
            seenIds.add(email.id)
            allEmails.push(email)
          }
        }
        console.log('[Newsletter Fetch] Total unique emails after merge:', allEmails.length)

        // Filter emails that are older than afterDate (Gmail's after: query only uses date, not time)
        // This ensures we only process emails received AFTER the timestamp, not just on the same day
        const emails = targetDate
          ? allEmails // For historical imports, keep all emails of that day
          : allEmails.filter(email => email.date >= afterDate)

        if (emails.length < allEmails.length) {
          console.log(`[Newsletter Fetch] Filtered ${allEmails.length - emails.length} emails older than ${afterDate.toISOString()}`)
        }

        // Log unique senders found
        const uniqueSenders = new Set(emails.map(e => e.from))
        console.log('[Newsletter Fetch] Unique senders in fetch:', uniqueSenders.size, Array.from(uniqueSenders).slice(0, 5))

        send({ type: 'newsletter', phase: 'processing', current: 0, total: emails.length, item: { title: `${emails.length} Emails gefunden (${uniqueSenders.size} Quellen)`, status: 'success' } })

        let processedNewsletters = 0
        let processedArticles = 0
        let skippedNewsletters = 0
        let errors = 0
        let totalCharacters = 0
        const articleUrls: Array<{ url: string; title: string; newsletterTitle: string; newsletterEmail: string }> = []

        // BATCH DEDUP: Fetch all existing entries for relevant dates in ONE query
        // This avoids N database queries (one per email) which causes Vercel timeouts
        const relevantDates = new Set<string>()
        for (const email of emails) {
          const date = targetDate || email.date.toISOString().split('T')[0]
          relevantDates.add(date)
        }
        const dateList = Array.from(relevantDates)
        console.log('[Newsletter Fetch] Checking existing entries for dates:', dateList)

        const { data: existingEntries } = await supabase
          .from('daily_repo')
          .select('id, source_email, title, newsletter_date')
          .in('newsletter_date', dateList)

        // Build in-memory lookup Set with composite keys
        const existingSet = new Set<string>()
        const existingIdMap = new Map<string, string>()  // key -> id (for force delete)
        for (const entry of existingEntries || []) {
          const key = `${entry.source_email}|${entry.title}|${entry.newsletter_date}`
          existingSet.add(key)
          existingIdMap.set(key, entry.id)
        }
        console.log(`[Newsletter Fetch] Found ${existingSet.size} existing entries for dedup`)

        // Process newsletters
        for (let i = 0; i < emails.length; i++) {
          const email = emails[i]

          send({
            type: 'newsletter',
            phase: 'processing',
            current: i + 1,
            total: emails.length,
            item: { title: email.subject, from: email.from, status: 'processing' }
          })

          try {
            // Check if already exists using in-memory lookup (fast!)
            const newsletterDate = targetDate || email.date.toISOString().split('T')[0]
            const dedupKey = `${email.from}|${email.subject}|${newsletterDate}`
            const existingId = existingIdMap.get(dedupKey)

            if (existingId) {
              if (force) {
                // Delete existing entry to allow re-processing
                await supabase.from('daily_repo').delete().eq('id', existingId)
              } else {
                skippedNewsletters++
                console.log(`[Newsletter Fetch] Skipping duplicate: "${email.subject}" from ${email.from} (date: ${newsletterDate})`)
                send({
                  type: 'newsletter',
                  phase: 'processing',
                  current: i + 1,
                  total: emails.length,
                  item: { title: email.subject, from: email.from, status: 'skipped' }
                })
                continue
              }
            }

            const htmlContent = email.htmlBody || email.textBody || ''
            const parsed = parseNewsletterHtml(htmlContent, email.subject, email.from, email.date)

            // Log all extracted links for debugging
            console.log(`[Newsletter Fetch] "${email.subject}" - Found ${parsed.links.length} total links`)
            const articleTypeLinks = parsed.links.filter(l => l.type === 'article')
            console.log(`[Newsletter Fetch] "${email.subject}" - ${articleTypeLinks.length} links with type='article'`)

            // Debug: log first 3 article links for visibility
            if (articleTypeLinks.length > 0) {
              console.log(`[Newsletter Fetch] Sample article links:`, articleTypeLinks.slice(0, 3).map(l => ({ url: l.url.slice(0, 80), text: l.text.slice(0, 30) })))
            }

            // Extract article links - filter out non-article URLs and subscribe links
            const links = parsed.links.filter(link => {
              if (link.type !== 'article') return false
              if (!isLikelyArticleUrl(link.url)) {
                console.log(`[Newsletter Fetch] Filtered out by isLikelyArticleUrl: ${link.url.slice(0, 80)}`)
                return false
              }
              if (isNonArticleLinkText(link.text)) {
                console.log(`[Newsletter Fetch] Filtered out by isNonArticleLinkText: "${link.text.slice(0, 50)}"`)
                return false
              }
              return true
            })
            console.log(`[Newsletter Fetch] "${email.subject}" - ${links.length} links after all filters`)

            // Check if this is a full-content newsletter (already contains the full article)
            // vs. a digest/curated newsletter (teasers with links to external articles)
            // Use articleTypeLinks.length (BEFORE filtering) to detect digests correctly
            const hasFullContent = isFullContentNewsletter(parsed.plainText, articleTypeLinks.length, email.from)

            // Only extract article links if this is NOT a full-content newsletter
            // Full-content newsletters don't need external article extraction
            if (!hasFullContent) {
              for (const link of links) {
                articleUrls.push({
                  url: link.url,
                  title: link.text || 'Unbekannter Artikel',
                  newsletterTitle: email.subject,
                  newsletterEmail: email.from  // Track source newsletter for article
                })
              }
            } else {
              console.log(`[Newsletter Fetch] Skipping article extraction - newsletter "${email.subject}" has full content`)
            }

            // Store newsletter - use targetDate if provided, otherwise use email date
            // For Substack newsletters: use specific newsletter URL (for proper favicon)
            // For others: use first article URL as source_url
            // newsletterDate is already defined above for deduplication
            const substackUrl = getSubstackNewsletterUrl(email.from)
            const primaryArticleUrl = links.length > 0 ? links[0].url : null
            // Prefer Substack-specific URL for proper favicon display
            const sourceUrl = substackUrl || primaryArticleUrl
            const { error: insertError } = await supabase
              .from('daily_repo')
              .insert({
                source_type: 'newsletter',
                source_email: email.from,
                source_url: sourceUrl,
                title: email.subject,
                content: parsed.plainText,
                raw_html: htmlContent,
                newsletter_date: newsletterDate,
                email_received_at: email.date.toISOString(),
              })

            if (insertError) {
              throw new Error(insertError.message)
            }

            processedNewsletters++
            totalCharacters += parsed.plainText?.length || 0
            send({
              type: 'newsletter',
              phase: 'processing',
              current: i + 1,
              total: emails.length,
              item: { title: email.subject, from: email.from, status: 'success' }
            })
          } catch (err) {
            errors++
            send({
              type: 'newsletter',
              phase: 'processing',
              current: i + 1,
              total: emails.length,
              item: {
                title: email.subject,
                from: email.from,
                status: 'error',
                error: err instanceof Error ? err.message : 'Unbekannter Fehler'
              }
            })
          }
        }

        // ========================================
        // PHASE 2: Import +dailyrepo email notes
        // ========================================
        let processedEmailNotes = 0

        send({
          type: 'email_note',
          phase: 'importing_notes',
          item: { title: 'Suche +dailyrepo E-Mails...', status: 'processing' }
        })

        try {
          const emailNotes = await gmailClient.fetchEmailsBySubject(
            EMAIL_NOTE_CONFIG.senderEmail,
            EMAIL_NOTE_CONFIG.subjectTag,
            50,
            EMAIL_NOTE_CONFIG.hoursBack
          )

          console.log('[Newsletter Fetch] Found', emailNotes.length, '+dailyrepo emails')

          if (emailNotes.length > 0) {
            send({
              type: 'email_note',
              phase: 'importing_notes',
              current: 0,
              total: emailNotes.length,
              item: { title: `${emailNotes.length} +dailyrepo E-Mails gefunden`, status: 'success' }
            })

            for (let i = 0; i < emailNotes.length; i++) {
              const note = emailNotes[i]
              const cleanedTitle = cleanDailyRepoSubject(note.subject)

              send({
                type: 'email_note',
                phase: 'importing_notes',
                current: i + 1,
                total: emailNotes.length,
                item: { title: cleanedTitle, from: note.from, status: 'processing' }
              })

              try {
                // Check if already exists
                const { data: existing } = await supabase
                  .from('daily_repo')
                  .select('id')
                  .eq('source_email', note.from)
                  .eq('title', cleanedTitle)
                  .eq('source_type', 'email_note')
                  .single()

                if (existing) {
                  if (force) {
                    await supabase.from('daily_repo').delete().eq('id', existing.id)
                  } else {
                    send({
                      type: 'email_note',
                      phase: 'importing_notes',
                      current: i + 1,
                      total: emailNotes.length,
                      item: { title: cleanedTitle, from: note.from, status: 'skipped' }
                    })
                    continue
                  }
                }

                const content = extractPlainTextFromEmail(note.htmlBody, note.textBody)

                if (!content || content.length < 10) {
                  errors++
                  send({
                    type: 'email_note',
                    phase: 'importing_notes',
                    current: i + 1,
                    total: emailNotes.length,
                    item: { title: cleanedTitle, from: note.from, status: 'error', error: 'Kein Inhalt' }
                  })
                  continue
                }

                const noteDate = targetDate || note.date.toISOString().split('T')[0]
                const { error: insertError } = await supabase
                  .from('daily_repo')
                  .insert({
                    source_type: 'email_note',
                    source_email: note.from,
                    source_url: null,
                    title: cleanedTitle,
                    content: content,
                    newsletter_date: noteDate,
                    email_received_at: note.date.toISOString(),
                  })

                if (insertError) {
                  throw new Error(insertError.message)
                }

                processedEmailNotes++
                totalCharacters += content.length
                send({
                  type: 'email_note',
                  phase: 'importing_notes',
                  current: i + 1,
                  total: emailNotes.length,
                  item: { title: cleanedTitle, from: note.from, status: 'success' }
                })

              } catch (err) {
                errors++
                send({
                  type: 'email_note',
                  phase: 'importing_notes',
                  current: i + 1,
                  total: emailNotes.length,
                  item: {
                    title: cleanedTitle,
                    from: note.from,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Unbekannter Fehler'
                  }
                })
              }
            }
          } else {
            send({
              type: 'email_note',
              phase: 'importing_notes',
              item: { title: 'Keine +dailyrepo E-Mails gefunden', status: 'skipped' }
            })
          }
        } catch (err) {
          console.error('[Newsletter Fetch] Error fetching +dailyrepo emails:', err)
          send({
            type: 'email_note',
            phase: 'importing_notes',
            item: {
              title: '+dailyrepo Import fehlgeschlagen',
              status: 'error',
              error: err instanceof Error ? err.message : 'Unbekannter Fehler'
            }
          })
        }

        // ========================================
        // PHASE 3: Extract articles from newsletters
        // ========================================

        // Process article links (limit to first 25 for comprehensive coverage)
        const articlesToProcess = articleUrls.slice(0, 25)

        if (articlesToProcess.length > 0) {
          send({
            type: 'article',
            phase: 'extracting',
            current: 0,
            total: articlesToProcess.length,
            item: { title: 'Artikel werden extrahiert...', status: 'processing' }
          })

          for (let i = 0; i < articlesToProcess.length; i++) {
            const article = articlesToProcess[i]

            send({
              type: 'article',
              phase: 'extracting',
              current: i + 1,
              total: articlesToProcess.length,
              item: { title: article.title, url: article.url, status: 'processing' }
            })

            try {
              // Check if article already exists
              const { data: existingArticle } = await supabase
                .from('daily_repo')
                .select('id')
                .eq('source_url', article.url)
                .single()

              if (existingArticle) {
                if (force) {
                  // Delete existing entry to allow re-processing
                  await supabase.from('daily_repo').delete().eq('id', existingArticle.id)
                } else {
                  send({
                    type: 'article',
                    phase: 'extracting',
                    current: i + 1,
                    total: articlesToProcess.length,
                    item: { title: article.title, url: article.url, status: 'skipped' }
                  })
                  continue
                }
              }

              const extracted = await extractArticleContent(article.url)

              if (extracted && extracted.content) {
                // Check if article is too old (max 48 hours for daily newsletter)
                if (isArticleTooOld(extracted.publishedDate, 48)) {
                  const ageInfo = extracted.publishedDate
                    ? ` (${Math.round((Date.now() - extracted.publishedDate.getTime()) / (1000 * 60 * 60 * 24))} Tage alt)`
                    : ''
                  send({
                    type: 'article',
                    phase: 'extracting',
                    current: i + 1,
                    total: articlesToProcess.length,
                    item: {
                      title: extracted.title || article.title,
                      url: article.url,
                      status: 'skipped',
                      error: `Artikel zu alt${ageInfo}`
                    }
                  })
                  continue
                }

                // Use targetDate if provided, otherwise use today
                const articleDate = targetDate || new Date().toISOString().split('T')[0]
                // Use the resolved final URL if available (resolves tracking redirects)
                // This ensures we store clean URLs like mlpills.substack.com/p/... instead of substack.com/redirect/...
                const resolvedUrl = extracted.finalUrl || article.url

                // Check if the RESOLVED URL already exists (prevents duplicates from different tracking URLs)
                if (extracted.finalUrl) {
                  const { data: existingResolved } = await supabase
                    .from('daily_repo')
                    .select('id')
                    .eq('source_url', resolvedUrl)
                    .single()

                  if (existingResolved && !force) {
                    send({
                      type: 'article',
                      phase: 'extracting',
                      current: i + 1,
                      total: articlesToProcess.length,
                      item: { title: extracted.title || article.title, url: resolvedUrl, status: 'skipped' }
                    })
                    continue
                  }
                }

                await supabase
                  .from('daily_repo')
                  .insert({
                    source_type: 'article',
                    source_url: resolvedUrl,
                    source_email: article.newsletterEmail,  // Track which newsletter this article came from
                    title: extracted.title || article.title,
                    content: extracted.content,
                    newsletter_date: articleDate,
                    email_received_at: new Date().toISOString(),  // Use extraction time for articles
                  })

                processedArticles++
                totalCharacters += extracted.content?.length || 0
                send({
                  type: 'article',
                  phase: 'extracting',
                  current: i + 1,
                  total: articlesToProcess.length,
                  item: { title: extracted.title || article.title, url: resolvedUrl, status: 'success' }
                })
              } else {
                send({
                  type: 'article',
                  phase: 'extracting',
                  current: i + 1,
                  total: articlesToProcess.length,
                  item: { title: article.title, url: article.url, status: 'error', error: 'Kein Inhalt extrahiert' }
                })
              }
            } catch (err) {
              send({
                type: 'article',
                phase: 'extracting',
                current: i + 1,
                total: articlesToProcess.length,
                item: {
                  title: article.title,
                  url: article.url,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Extraction failed'
                }
              })
            }
          }
        }

        // Update last fetch timestamp based on actual data in daily_repo
        // This ensures consistency - if items are deleted, the timestamp auto-adjusts
        await updateLastFetchTimestamp(supabase)

        // ========================================
        // PHASE 4: Scan all mail for potential newsletter sources
        // ========================================
        let unfetchedEmails: UnfetchedEmail[] = []

        try {
          send({
            type: 'newsletter',
            phase: 'scanning_unfetched',
            item: { title: 'Scanne alle Mails nach Newsletter-Quellen...', status: 'processing' }
          })

          // Get all registered sources (email addresses)
          const sourceEmailsLower = senderEmails.map(e => e.toLowerCase())

          // Get excluded senders
          const { data: excludedSenders } = await supabase
            .from('excluded_senders')
            .select('email')

          const excludedEmailsLower = (excludedSenders || []).map(e => e.email.toLowerCase())

          // Find the most recent newsletter in daily_repo (actual data, not deleted)
          // This ensures we scan from the newest existing fetch, typically ~24h ago
          const { data: latestFetch } = await supabase
            .from('daily_repo')
            .select('newsletter_date')
            .order('newsletter_date', { ascending: false })
            .limit(1)
            .single()

          // Scan at least the last 2 days to catch new senders
          // Even if last fetch was today, we want to find senders from yesterday too
          const twoDaysAgo = new Date()
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
          twoDaysAgo.setHours(0, 0, 0, 0)

          let scanAfterDate: Date
          if (latestFetch?.newsletter_date) {
            const lastFetchDate = new Date(latestFetch.newsletter_date)
            // Use the earlier of: last fetch date or 2 days ago
            scanAfterDate = lastFetchDate < twoDaysAgo ? lastFetchDate : twoDaysAgo
            console.log(`[Newsletter Fetch] Scanning emails since: ${scanAfterDate.toISOString().split('T')[0]}`)
            send({
              type: 'newsletter',
              phase: 'scanning_unfetched',
              item: { title: `Scanne Mails seit ${scanAfterDate.toISOString().split('T')[0]}...`, status: 'processing' }
            })
          } else {
            // Fallback: scan last 7 days if no data exists
            scanAfterDate = new Date()
            scanAfterDate.setDate(scanAfterDate.getDate() - 7)
            console.log('[Newsletter Fetch] No existing fetches found, scanning last 7 days')
            send({
              type: 'newsletter',
              phase: 'scanning_unfetched',
              item: { title: 'Scanne Mails der letzten 7 Tage...', status: 'processing' }
            })
          }

          console.log(`[Newsletter Fetch] Sources count: ${sourceEmailsLower.length}, Excluded count: ${excludedEmailsLower.length}`)

          // Scan mail for unique senders since calculated date
          // Limited to 100 messages to avoid timeout (each message requires individual API call)
          const allSenders = await gmailClient.scanUniqueSenders(scanAfterDate, 7, 100)
          console.log(`[Newsletter Fetch] Scanned ${allSenders.length} unique senders from mail`)

          send({
            type: 'newsletter',
            phase: 'scanning_unfetched',
            item: { title: `${allSenders.length} Sender gefunden, filtere...`, status: 'processing' }
          })

          // Filter to only unfetched senders (not in sources, not excluded)
          let filteredOutAsSource = 0
          let filteredOutAsExcluded = 0

          unfetchedEmails = allSenders
            .filter(sender => {
              const emailLower = sender.email.toLowerCase()
              if (sourceEmailsLower.includes(emailLower)) {
                filteredOutAsSource++
                return false
              }
              if (excludedEmailsLower.includes(emailLower)) {
                filteredOutAsExcluded++
                return false
              }
              return true
            })
            .map(sender => ({
              email: sender.email,
              name: sender.name,
              count: sender.count,
              subjects: sender.subjects.slice(0, 3),
              latestDate: sender.latestDate.toISOString()
            }))
            .sort((a, b) => b.count - a.count)

          console.log(`[Newsletter Fetch] Filtered: ${filteredOutAsSource} sources, ${filteredOutAsExcluded} excluded, ${unfetchedEmails.length} remaining`)

          // Show result in progress list with breakdown
          if (unfetchedEmails.length > 0) {
            send({
              type: 'newsletter',
              phase: 'scanning_unfetched',
              item: { title: `${unfetchedEmails.length} neue Quellen gefunden (${filteredOutAsSource} bereits Sources, ${filteredOutAsExcluded} excluded)`, status: 'success' }
            })
          } else {
            send({
              type: 'newsletter',
              phase: 'scanning_unfetched',
              item: { title: `Keine neuen Quellen (${filteredOutAsSource} bereits Sources, ${filteredOutAsExcluded} excluded)`, status: 'skipped' }
            })
          }
        } catch (err) {
          console.error('[Newsletter Fetch] Error scanning unfetched emails:', err)
          send({
            type: 'newsletter',
            phase: 'scanning_unfetched',
            item: { title: 'Scan fehlgeschlagen', status: 'error', error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
          })
          // Continue - this is optional functionality
        }

        // Log final stats
        console.log(`[Newsletter Fetch] Complete: ${processedNewsletters} newsletters, ${processedArticles} articles, ${processedEmailNotes} notes, ${skippedNewsletters} skipped, ${errors} errors`)

        // Send unfetched emails if any found
        console.log(`[Newsletter Fetch] Sending unfetched_emails event: ${unfetchedEmails.length} emails`)
        if (unfetchedEmails.length > 0) {
          send({
            type: 'unfetched_emails',
            phase: 'done',
            unfetchedEmails
          })
          console.log(`[Newsletter Fetch] unfetched_emails event sent successfully`)
        } else {
          console.log(`[Newsletter Fetch] No unfetched emails to send`)
        }

        // Send completion
        send({
          type: 'complete',
          phase: 'done',
          summary: {
            newsletters: processedNewsletters,
            articles: processedArticles,
            emailNotes: processedEmailNotes,
            errors,
            totalCharacters
          }
        })

      } catch (error) {
        console.error('[Newsletter Fetch] Critical error:', error)
        send({
          type: 'error',
          phase: 'done',
          item: {
            title: 'Kritischer Fehler',
            status: 'error',
            error: error instanceof Error ? error.message : 'Unbekannter Fehler'
          }
        })
      }

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
