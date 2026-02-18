import { NextRequest } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import * as cheerio from 'cheerio'
import { createClient } from '@/lib/supabase/server'
import { isAdminRequest } from '@/lib/auth/session'
import { backfillMissingEmbeddings } from '@/lib/embeddings/backfill'

// Always fetch last 48h, deduplicate at article level by source_url/title
const FETCH_WINDOW_HOURS = 48

// Node.js runtime for cheerio compatibility
export const runtime = 'nodejs'

interface ParsedArticle {
  title: string
  content: string
  sourceUrl: string | null
  sourceIdentifier: string | null
  priority: string | null
}

/**
 * Convert HTML to text preserving paragraph structure.
 * Unlike cheerio's .text() which collapses ALL whitespace,
 * this inserts newlines for block-level elements.
 */
function htmlToStructuredText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, head').remove()

  // Replace <br> with newlines
  $('br').replaceWith('\n')

  // Add newlines around block elements
  $('p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, hr').each((_, el) => {
    $(el).prepend('\n').append('\n')
  })

  const text = ($('body').text() || $.root().text())
    .replace(/[ \t]+/g, ' ')       // collapse horizontal whitespace only
    .replace(/\n[ \t]+/g, '\n')    // trim leading whitespace on lines
    .replace(/[ \t]+\n/g, '\n')    // trim trailing whitespace on lines
    .replace(/\n{3,}/g, '\n\n')    // max 2 consecutive newlines
    .trim()

  return text
}

/**
 * Extract all "Artikel lesen" link URLs from the HTML in order.
 * These are the source URLs for each article.
 */
function extractReadMoreLinks(html: string): string[] {
  const $ = cheerio.load(html)
  const urls: string[] = []

  $('a').each((_, el) => {
    const text = $(el).text().trim()
    if (/artikel\s*lesen/i.test(text)) {
      const href = $(el).attr('href')
      if (href) urls.push(href)
    }
  })

  return urls
}

/**
 * Parse a webcrawler email into individual article blocks.
 * Each article ends with an "Artikel lesen →" link.
 * Articles typically have: priority label, title, excerpt, metadata (📅📰🏷️), body text.
 */
function parseWebcrawlerArticles(
  htmlContent: string,
  textBody: string
): ParsedArticle[] {
  // Extract source URLs from "Artikel lesen" links (preserving order)
  const sourceUrls = extractReadMoreLinks(htmlContent)

  // Get structured text with preserved line breaks
  const text = htmlToStructuredText(htmlContent) || textBody || ''

  if (!text) return []

  // Split text by "Artikel lesen" markers
  const sections = text.split(/Artikel\s*lesen\s*→?\s*/i)

  // Need at least 2 sections (1 article + footer)
  if (sections.length < 2) {
    console.log('[WebCrawl] No "Artikel lesen" markers found in email')
    return []
  }

  // Last section is footer/trailing text — drop it
  const articleSections = sections.slice(0, -1)

  console.log(`[WebCrawl] Found ${articleSections.length} article sections, ${sourceUrls.length} source URLs`)

  const articles: ParsedArticle[] = []

  for (let i = 0; i < articleSections.length; i++) {
    let section = articleSections[i]

    // For the first section, skip intro text before the first priority label
    if (i === 0) {
      const priorityIdx = section.search(/^.*\b(?:HIGH|MEDIUM|LOW)\b/im)
      if (priorityIdx > 0) {
        section = section.substring(priorityIdx)
      }
    }

    const lines = section.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    let lineIdx = 0
    let priority: string | null = null

    // Check for priority label (HIGH/MEDIUM/LOW, possibly with emoji prefix)
    if (lines[lineIdx]?.match(/\b(HIGH|MEDIUM|LOW)\b/i)) {
      const m = lines[lineIdx].match(/\b(HIGH|MEDIUM|LOW)\b/i)
      priority = m ? m[1].toUpperCase() : null
      lineIdx++
    }

    // Skip URL lines that may appear before the title (source links in the HTML)
    while (lineIdx < lines.length && /^https?:\/\//i.test(lines[lineIdx])) {
      lineIdx++
    }

    // Title
    const title = lines[lineIdx] || 'Untitled'
    lineIdx++

    // Excerpt (line before metadata — skip if it looks like metadata or a URL)
    let excerpt = ''
    if (lineIdx < lines.length && !lines[lineIdx]?.includes('📅') && !/^https?:\/\//i.test(lines[lineIdx])) {
      excerpt = lines[lineIdx]
      lineIdx++
    }

    // Metadata line: 📅 date | 📰 source | 🏷️ category
    let sourceIdentifier: string | null = null
    if (lineIdx < lines.length && lines[lineIdx]?.includes('📅')) {
      const metaLine = lines[lineIdx]
      const sourceMatch = metaLine.match(/📰\s*([^|📅🏷️]+)/)
      sourceIdentifier = sourceMatch ? sourceMatch[1].trim() : null
      lineIdx++
    }

    // Content: everything remaining (filter out standalone URL lines)
    const bodyLines = lines.slice(lineIdx).filter(l => !/^https?:\/\//i.test(l))
    const bodyContent = bodyLines.join('\n').trim()
    const fullContent = excerpt ? `${excerpt}\n\n${bodyContent}` : bodyContent

    if (fullContent.length < 50) continue // Skip empty/tiny articles

    articles.push({
      title,
      content: fullContent,
      sourceUrl: sourceUrls[i] || null,
      sourceIdentifier,
      priority,
    })
  }

  return articles
}

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

        // Fetch only the most recent webcrawler email
        const emails = await gmailClient.fetchEmailsBySubject(
          null,
          '+synthszr-webcrawler',
          1,
          FETCH_WINDOW_HOURS
        )

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
          const emailDate = email.date.toISOString().split('T')[0]

          send({
            type: 'email',
            phase: 'processing',
            current: i + 1,
            total: emails.length,
            item: { title: email.subject, from: email.from, status: 'processing' }
          })

          try {
            const htmlContent = email.htmlBody || email.textBody || ''

            // Parse webcrawler email into individual articles
            const articles = parseWebcrawlerArticles(htmlContent, email.textBody || '')

            console.log(`[WebCrawl] "${email.subject}" → ${articles.length} Artikel extrahiert`)

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

                await supabase
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
