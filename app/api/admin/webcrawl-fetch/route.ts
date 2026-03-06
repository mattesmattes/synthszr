import { NextRequest } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/auth/session'
import { backfillMissingEmbeddings } from '@/lib/embeddings/backfill'
import { parseWebcrawlerArticles } from '@/lib/webcrawl/processor'

// Default: fetch last 48h. When a targetDate is specified, extend to 120h to find older emails.
const DEFAULT_FETCH_WINDOW_HOURS = 48
const EXTENDED_FETCH_WINDOW_HOURS = 120

// Node.js runtime for cheerio compatibility
export const runtime = 'nodejs'

interface ProgressEvent {
  type: 'start' | 'email' | 'article' | 'embedding_backfill' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'embedding_backfill' | 'done'
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
        // Parse optional targetDate from request body
        let targetDate: string | null = null
        try {
          const body = await request.json()
          targetDate = body.targetDate || null
        } catch {
          // No body or invalid JSON — use defaults
        }

        const fetchWindowHours = targetDate ? EXTENDED_FETCH_WINDOW_HOURS : DEFAULT_FETCH_WINDOW_HOURS
        console.log(`[WebCrawl] Starting...${targetDate ? ` (targetDate: ${targetDate})` : ''}`)
        const supabase = createAdminClient()

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

        send({ type: 'start', phase: 'fetching', item: { title: `Suche +synthszr-webcrawler E-Mails${targetDate ? ` (${targetDate})` : ''}...`, status: 'processing' } })

        const gmailClient = new GmailClient(tokenData.refresh_token)

        // When a targetDate is set, fetch more emails so we can filter by date
        const maxEmails = targetDate ? 10 : 1
        const allEmails = await gmailClient.fetchEmailsBySubject(
          null,
          '+synthszr-webcrawler',
          maxEmails,
          fetchWindowHours
        )

        // Filter to emails matching the target date if specified
        const emails = targetDate
          ? allEmails.filter(e => e.date.toISOString().split('T')[0] === targetDate)
          : allEmails

        console.log(`[WebCrawl] Found ${emails.length} +synthszr-webcrawler emails`)

        if (emails.length === 0) {
          send({ type: 'complete', phase: 'done', summary: { emails: 0, articles: 0, errors: 0, totalCharacters: 0 } })
          controller.close()
          return
        }

        send({ type: 'email', phase: 'processing', current: 0, total: emails.length, item: { title: `${emails.length} WebCrawl E-Mails gefunden`, status: 'success' } })

        let processedEmails = 0
        let processedArticles = 0
        let errors = 0
        let totalCharacters = 0

        // Process each webcrawler email: parse articles directly from content
        for (let i = 0; i < emails.length; i++) {
          const email = emails[i]
          // Use targetDate if specified, otherwise use the email's actual date
          const emailDate = targetDate || email.date.toISOString().split('T')[0]

          send({
            type: 'email',
            phase: 'processing',
            current: i + 1,
            total: emails.length,
            item: { title: email.subject, from: email.from, status: 'processing' }
          })

          try {
            const htmlContent = email.htmlBody || email.textBody || ''

            // Parse webcrawler email into individual articles (multi-strategy)
            const articles = parseWebcrawlerArticles(htmlContent, email.textBody || '')

            console.log(`[WebCrawl] "${email.subject}" → ${articles.length} Artikel extrahiert`)

            if (articles.length === 0) {
              send({
                type: 'email',
                phase: 'processing',
                current: i + 1,
                total: emails.length,
                item: {
                  title: `${email.subject} (0 Artikel — alle Strategien fehlgeschlagen)`,
                  from: email.from,
                  status: 'error',
                  error: 'Keine Artikel im Email-Format erkannt'
                }
              })
              processedEmails++
              continue
            }

            let emailArticlesSaved = 0

            // Save each article to daily_repo
            for (let j = 0; j < articles.length; j++) {
              const article = articles[j]

              send({
                type: 'article',
                phase: 'extracting',
                current: j + 1,
                total: articles.length,
                item: { title: article.title, url: article.sourceUrl || undefined, status: 'processing' }
              })

              try {
                // Dedup by source URL if available
                if (article.sourceUrl) {
                  const { data: existing } = await supabase
                    .from('daily_repo')
                    .select('id')
                    .eq('source_url', article.sourceUrl)
                    .single()

                  if (existing) {
                    send({
                      type: 'article',
                      phase: 'extracting',
                      current: j + 1,
                      total: articles.length,
                      item: { title: article.title, url: article.sourceUrl || undefined, status: 'skipped' }
                    })
                    continue
                  }
                }

                // Fallback dedup by title + source_type
                const { data: existingByTitle } = await supabase
                  .from('daily_repo')
                  .select('id')
                  .eq('title', article.title)
                  .eq('source_type', 'webcrawl')
                  .single()

                if (existingByTitle) {
                  send({
                    type: 'article',
                    phase: 'extracting',
                    current: j + 1,
                    total: articles.length,
                    item: { title: article.title, status: 'skipped' }
                  })
                  continue
                }

                const { error: insertError } = await supabase
                  .from('daily_repo')
                  .insert({
                    source_type: 'webcrawl',
                    source_url: article.sourceUrl,
                    source_email: article.sourceIdentifier || email.from,
                    title: article.title,
                    content: article.content,
                    newsletter_date: emailDate,
                    email_received_at: email.date.toISOString(),
                  })

                if (insertError) {
                  throw new Error(`Insert fehlgeschlagen: ${insertError.message}`)
                }

                processedArticles++
                emailArticlesSaved++
                totalCharacters += article.content.length

                send({
                  type: 'article',
                  phase: 'extracting',
                  current: j + 1,
                  total: articles.length,
                  item: { title: article.title, url: article.sourceUrl || undefined, status: 'success' }
                })
              } catch (err) {
                errors++
                send({
                  type: 'article',
                  phase: 'extracting',
                  current: j + 1,
                  total: articles.length,
                  item: {
                    title: article.title,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Fehler beim Speichern'
                  }
                })
              }
            }

            processedEmails++

            send({
              type: 'email',
              phase: 'processing',
              current: i + 1,
              total: emails.length,
              item: {
                title: `${email.subject} (${articles.length} Artikel, ${emailArticlesSaved} neu)`,
                from: email.from,
                status: 'success'
              }
            })
          } catch (err) {
            errors++
            send({
              type: 'email',
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
        // PHASE 2: Generate missing embeddings
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
