import { NextRequest } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'
import { extractArticleContent } from '@/lib/scraper/article-extractor'
import { createClient } from '@/lib/supabase/server'
import { jwtVerify } from 'jose'

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'synthszr_session'

function getSecretKey() {
  const secret = process.env.ADMIN_PASSWORD
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

interface ProgressEvent {
  type: 'start' | 'newsletter' | 'article' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'done'
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
    errors: number
    totalCharacters: number
  }
}

export async function POST(request: NextRequest) {
  // Check admin session
  if (!(await isAdminSession(request))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
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
        console.log('[Newsletter Fetch] Starting...')
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
          send({ type: 'complete', phase: 'done', summary: { newsletters: 0, articles: 0, errors: 0, totalCharacters: 0 } })
          controller.close()
          return
        }

        send({ type: 'start', phase: 'fetching', total: sources.length })

        // Fetch emails
        const gmailClient = new GmailClient(tokenData.refresh_token)
        const afterDate = new Date(Date.now() - 36 * 60 * 60 * 1000)
        const senderEmails = sources.map(s => s.email)

        send({ type: 'newsletter', phase: 'fetching', item: { title: 'Emails werden abgerufen...', status: 'processing' } })

        console.log('[Newsletter Fetch] Fetching emails from senders:', senderEmails)
        const emails = await gmailClient.fetchEmailsFromSenders(senderEmails, 50, afterDate)
        console.log('[Newsletter Fetch] Fetched', emails.length, 'emails')

        send({ type: 'newsletter', phase: 'processing', current: 0, total: emails.length, item: { title: `${emails.length} Emails gefunden`, status: 'success' } })

        let processedNewsletters = 0
        let processedArticles = 0
        let errors = 0
        let totalCharacters = 0
        const articleUrls: Array<{ url: string; title: string; newsletterTitle: string }> = []

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
            // Check if already exists
            const { data: existing } = await supabase
              .from('daily_repo')
              .select('id')
              .eq('source_email', email.from)
              .eq('title', email.subject)
              .single()

            if (existing) {
              send({
                type: 'newsletter',
                phase: 'processing',
                current: i + 1,
                total: emails.length,
                item: { title: email.subject, from: email.from, status: 'skipped' }
              })
              continue
            }

            const htmlContent = email.htmlBody || email.textBody || ''
            const parsed = parseNewsletterHtml(htmlContent, email.subject, email.from, email.date)

            // Extract article links
            const links = parsed.links.filter(link => link.type === 'article')
            for (const link of links) {
              articleUrls.push({
                url: link.url,
                title: link.text || 'Unbekannter Artikel',
                newsletterTitle: email.subject
              })
            }

            // Store newsletter
            const { error: insertError } = await supabase
              .from('daily_repo')
              .insert({
                source_type: 'newsletter',
                source_email: email.from,
                title: email.subject,
                content: parsed.plainText,
                raw_html: htmlContent,
                newsletter_date: email.date.toISOString().split('T')[0],
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
                send({
                  type: 'article',
                  phase: 'extracting',
                  current: i + 1,
                  total: articlesToProcess.length,
                  item: { title: article.title, url: article.url, status: 'skipped' }
                })
                continue
              }

              const extracted = await extractArticleContent(article.url)

              if (extracted && extracted.content) {
                await supabase
                  .from('daily_repo')
                  .insert({
                    source_type: 'article',
                    source_url: article.url,
                    title: extracted.title || article.title,
                    content: extracted.content,
                    newsletter_date: new Date().toISOString().split('T')[0],
                  })

                processedArticles++
                totalCharacters += extracted.content?.length || 0
                send({
                  type: 'article',
                  phase: 'extracting',
                  current: i + 1,
                  total: articlesToProcess.length,
                  item: { title: extracted.title || article.title, url: article.url, status: 'success' }
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

        // Update last fetch timestamp
        await supabase
          .from('settings')
          .upsert({
            key: 'last_newsletter_fetch',
            value: { timestamp: new Date().toISOString() },
          }, { onConflict: 'key' })

        // Send completion
        send({
          type: 'complete',
          phase: 'done',
          summary: {
            newsletters: processedNewsletters,
            articles: processedArticles,
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
