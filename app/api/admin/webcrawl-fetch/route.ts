import { NextRequest } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml, type ExtractedLink } from '@/lib/email/parser'
import { extractArticleContent, isLikelyArticleUrl, isNonArticleLinkText } from '@/lib/scraper/article-extractor'
import { createClient } from '@/lib/supabase/server'
import { isAdminRequest } from '@/lib/auth/session'
import { backfillMissingEmbeddings } from '@/lib/embeddings/backfill'

/**
 * Extract URLs from plain text content (fallback when HTML has no <a> tags).
 * Webcrawler emails often list URLs as plain text without HTML wrapping.
 */
function extractUrlsFromPlainText(text: string): ExtractedLink[] {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi
  const matches = text.match(urlRegex) || []
  const seen = new Set<string>()
  const links: ExtractedLink[] = []

  for (const rawUrl of matches) {
    // Clean trailing punctuation that's likely not part of the URL
    const url = rawUrl.replace(/[.,;:!?)>\]]+$/, '')
    if (seen.has(url)) continue
    seen.add(url)
    links.push({ url, text: url, type: 'article' })
  }

  return links
}

// BULLETPROOF APPROACH: Always fetch last 48h, deduplicate by Gmail message ID
const FETCH_WINDOW_HOURS = 48

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

// Article processing constants
const MAX_ARTICLES_PER_RUN = 100
const BATCH_SIZE = 5

interface ProgressEvent {
  type: 'start' | 'email' | 'article' | 'embedding_backfill' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'embedding_backfill' | 'done'
  current?: number
  total?: number
  batch?: {
    current: number
    total: number
  }
  item?: {
    title: string
    from?: string
    url?: string
    status: 'pending' | 'processing' | 'success' | 'error' | 'skipped'
    error?: string
  }
  summary?: {
    emails: number
    articles: number
    errors: number
    totalCharacters: number
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        console.log('[WebCrawl] Starting...')
        const supabase = await createClient()

        // Get Gmail tokens
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

        send({ type: 'start', phase: 'fetching', item: { title: 'Suche +synthszr-webcrawler E-Mails...', status: 'processing' } })

        const gmailClient = new GmailClient(tokenData.refresh_token)

        // Fetch webcrawler emails (last 48h)
        const emails = await gmailClient.fetchEmailsBySubject(
          null,
          '+synthszr-webcrawler',
          5,
          FETCH_WINDOW_HOURS
        )

        console.log(`[WebCrawl] Found ${emails.length} +synthszr-webcrawler emails`)

        if (emails.length === 0) {
          send({ type: 'complete', phase: 'done', summary: { emails: 0, articles: 0, errors: 0, totalCharacters: 0 } })
          controller.close()
          return
        }

        // BULLETPROOF DEDUP: Check existing gmail_message_ids
        const incomingGmailIds = emails.map(e => e.id)
        const { data: existingEntries } = await supabase
          .from('daily_repo')
          .select('gmail_message_id')
          .in('gmail_message_id', incomingGmailIds)

        const existingGmailIds = new Set((existingEntries || []).map(e => e.gmail_message_id).filter(Boolean))
        console.log(`[WebCrawl] ${existingGmailIds.size} already imported, ${emails.length - existingGmailIds.size} new`)

        // Filter to only new emails
        const newEmails = emails.filter(e => !existingGmailIds.has(e.id))

        if (newEmails.length === 0) {
          send({ type: 'email', phase: 'processing', item: { title: 'Alle E-Mails bereits importiert', status: 'skipped' } })
          send({ type: 'complete', phase: 'done', summary: { emails: 0, articles: 0, errors: 0, totalCharacters: 0 } })
          controller.close()
          return
        }

        send({ type: 'email', phase: 'processing', current: 0, total: newEmails.length, item: { title: `${newEmails.length} neue WebCrawl E-Mails gefunden`, status: 'success' } })

        const todayDate = new Date().toISOString().split('T')[0]
        let processedEmails = 0
        let processedArticles = 0
        let errors = 0
        let totalCharacters = 0
        const articleUrls: Array<{ url: string; title: string; emailSubject: string }> = []

        // Process each webcrawler email
        for (let i = 0; i < newEmails.length; i++) {
          const email = newEmails[i]

          send({
            type: 'email',
            phase: 'processing',
            current: i + 1,
            total: newEmails.length,
            item: { title: email.subject, from: email.from, status: 'processing' }
          })

          try {
            const htmlContent = email.htmlBody || email.textBody || ''
            const parsed = parseNewsletterHtml(htmlContent, email.subject, email.from, email.date)

            // Extract article links from HTML <a> tags
            let links = parsed.links.filter(link => {
              if (link.type !== 'article') return false
              if (!isLikelyArticleUrl(link.url)) return false
              if (isNonArticleLinkText(link.text)) return false
              return true
            })

            console.log(`[WebCrawl] "${email.subject}" - ${parsed.links.length} total HTML links, ${links.length} article links after filtering`)

            // FALLBACK: If HTML parsing found no article links, extract URLs from plain text
            // Webcrawler emails often list URLs as plain text without <a> tags
            if (links.length === 0) {
              const plainText = parsed.plainText || email.textBody || ''
              const plainTextLinks = extractUrlsFromPlainText(plainText)
                .filter(link => isLikelyArticleUrl(link.url))

              if (plainTextLinks.length > 0) {
                console.log(`[WebCrawl] FALLBACK: Found ${plainTextLinks.length} URLs in plain text`)
                links = plainTextLinks
              }
            }

            for (const link of links) {
              articleUrls.push({
                url: link.url,
                title: link.text || 'Unbekannter Artikel',
                emailSubject: email.subject
              })
            }

            // Save the webcrawl email itself to daily_repo
            await supabase
              .from('daily_repo')
              .insert({
                source_type: 'webcrawl',
                source_email: email.from,
                source_url: null,
                title: email.subject,
                content: parsed.plainText,
                raw_html: htmlContent,
                newsletter_date: todayDate,
                email_received_at: email.date.toISOString(),
                gmail_message_id: email.id,
              })

            processedEmails++
            totalCharacters += parsed.plainText?.length || 0

            send({
              type: 'email',
              phase: 'processing',
              current: i + 1,
              total: newEmails.length,
              item: { title: `${email.subject} (${links.length} Links)`, from: email.from, status: 'success' }
            })
          } catch (err) {
            errors++
            send({
              type: 'email',
              phase: 'processing',
              current: i + 1,
              total: newEmails.length,
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
        // PHASE 2: Crawl articles from webcrawler links
        // ========================================
        const articlesToProcess = articleUrls.slice(0, MAX_ARTICLES_PER_RUN)

        if (articlesToProcess.length > 0) {
          const totalBatches = Math.ceil(articlesToProcess.length / BATCH_SIZE)
          send({
            type: 'article',
            phase: 'extracting',
            current: 0,
            total: articlesToProcess.length,
            item: { title: `Artikel werden extrahiert (${totalBatches} Batches)...`, status: 'processing' }
          })

          for (let batchStart = 0; batchStart < articlesToProcess.length; batchStart += BATCH_SIZE) {
            const batch = articlesToProcess.slice(batchStart, batchStart + BATCH_SIZE)
            const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1

            const batchResults = await Promise.all(batch.map(async (article, batchIndex) => {
              const globalIndex = batchStart + batchIndex
              try {
                // Check if article URL already exists
                const { data: existingArticle } = await supabase
                  .from('daily_repo')
                  .select('id')
                  .eq('source_url', article.url)
                  .single()

                if (existingArticle) {
                  return { globalIndex, article, status: 'skipped' as const, title: article.title, url: article.url }
                }

                const extracted = await extractArticleContent(article.url)

                if (extracted && extracted.content) {
                  const resolvedUrl = extracted.finalUrl || article.url

                  // Check resolved URL
                  if (!isLikelyArticleUrl(resolvedUrl)) {
                    return {
                      globalIndex, article, status: 'skipped' as const,
                      title: extracted.title || article.title, url: resolvedUrl,
                      error: 'Resolved URL is not an article'
                    }
                  }

                  // Check if resolved URL exists
                  if (extracted.finalUrl) {
                    const { data: existingResolved } = await supabase
                      .from('daily_repo')
                      .select('id')
                      .eq('source_url', resolvedUrl)
                      .single()

                    if (existingResolved) {
                      return { globalIndex, article, status: 'skipped' as const, title: extracted.title || article.title, url: resolvedUrl }
                    }
                  }

                  await supabase
                    .from('daily_repo')
                    .insert({
                      source_type: 'webcrawl',
                      source_url: resolvedUrl,
                      source_email: null,
                      title: extracted.title || article.title,
                      content: extracted.content,
                      newsletter_date: todayDate,
                      email_received_at: new Date().toISOString(),
                    })

                  return {
                    globalIndex, article, status: 'success' as const,
                    title: extracted.title || article.title, url: resolvedUrl,
                    contentLength: extracted.content.length
                  }
                } else {
                  return { globalIndex, article, status: 'error' as const, title: article.title, url: article.url, error: 'Kein Inhalt extrahiert' }
                }
              } catch (err) {
                return {
                  globalIndex, article, status: 'error' as const,
                  title: article.title, url: article.url,
                  error: err instanceof Error ? err.message : 'Extraction failed'
                }
              }
            }))

            for (const result of batchResults) {
              if (result.status === 'success') {
                processedArticles++
                totalCharacters += result.contentLength || 0
              } else if (result.status === 'error') {
                errors++
              }
              send({
                type: 'article',
                phase: 'extracting',
                current: result.globalIndex + 1,
                total: articlesToProcess.length,
                batch: { current: batchNum, total: totalBatches },
                item: {
                  title: result.title,
                  url: result.url,
                  status: result.status,
                  error: result.error
                }
              })
            }
          }
        }

        // ========================================
        // PHASE 3: Generate missing embeddings
        // ========================================
        send({
          type: 'embedding_backfill',
          phase: 'embedding_backfill',
          item: { title: 'Generiere fehlende Embeddings...', status: 'processing' }
        })

        try {
          const backfillResult = await backfillMissingEmbeddings(
            50, 0,
            (progress) => {
              send({
                type: 'embedding_backfill',
                phase: 'embedding_backfill',
                current: progress.current,
                total: progress.total,
                item: { title: progress.title || 'Embedding...', status: 'processing' }
              })
            }
          )

          if (backfillResult.processed > 0) {
            send({
              type: 'embedding_backfill',
              phase: 'embedding_backfill',
              item: {
                title: `${backfillResult.processed} Embeddings generiert`,
                status: 'success'
              }
            })
          } else {
            send({
              type: 'embedding_backfill',
              phase: 'embedding_backfill',
              item: { title: 'Alle Embeddings vorhanden', status: 'skipped' }
            })
          }
        } catch (err) {
          console.error('[WebCrawl] Embedding backfill error:', err)
          send({
            type: 'embedding_backfill',
            phase: 'embedding_backfill',
            item: {
              title: 'Embedding-Backfill fehlgeschlagen',
              status: 'error',
              error: err instanceof Error ? err.message : 'Unbekannter Fehler'
            }
          })
        }

        // Send completion
        console.log(`[WebCrawl] Complete: ${processedEmails} emails, ${processedArticles} articles, ${errors} errors`)
        send({
          type: 'complete',
          phase: 'done',
          summary: {
            emails: processedEmails,
            articles: processedArticles,
            errors,
            totalCharacters
          }
        })

      } catch (error) {
        console.error('[WebCrawl] Critical error:', error)
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
