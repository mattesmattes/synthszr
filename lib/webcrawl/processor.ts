import { GmailClient } from '@/lib/gmail/client'
import * as cheerio from 'cheerio'
import { createAdminClient } from '@/lib/supabase/admin'
import { backfillMissingEmbeddings } from '@/lib/embeddings/backfill'

const FETCH_WINDOW_HOURS = 48

interface ParsedArticle {
  title: string
  content: string
  sourceUrl: string | null
  sourceIdentifier: string | null
  priority: string | null
}

export interface WebcrawlProcessResult {
  success: boolean
  message?: string
  error?: string
  emails?: number
  articles?: number
  embeddingsGenerated?: number
}

function htmlToStructuredText(html: string): string {
  const $ = cheerio.load(html)
  $('script, style, head').remove()
  $('br').replaceWith('\n')
  $('p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, hr').each((_, el) => {
    $(el).prepend('\n').append('\n')
  })
  const text = ($('body').text() || $.root().text())
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

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

function parseWebcrawlerArticles(htmlContent: string, textBody: string): ParsedArticle[] {
  const sourceUrls = extractReadMoreLinks(htmlContent)
  const text = htmlToStructuredText(htmlContent) || textBody || ''
  if (!text) return []

  const sections = text.split(/Artikel\s*lesen\s*→?\s*/i)
  if (sections.length < 2) return []

  const articleSections = sections.slice(0, -1)
  const articles: ParsedArticle[] = []

  for (let i = 0; i < articleSections.length; i++) {
    let section = articleSections[i]

    if (i === 0) {
      const priorityIdx = section.search(/^.*\b(?:HIGH|MEDIUM|LOW)\b/m)
      if (priorityIdx > 0) section = section.substring(priorityIdx)
    }

    const lines = section.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    let lineIdx = 0
    let priority: string | null = null

    if (lines[lineIdx]?.match(/\b(HIGH|MEDIUM|LOW)\b/i)) {
      const m = lines[lineIdx].match(/\b(HIGH|MEDIUM|LOW)\b/i)
      priority = m ? m[1].toUpperCase() : null
      lineIdx++
    }

    while (lineIdx < lines.length && /^https?:\/\//i.test(lines[lineIdx])) {
      lineIdx++
    }

    const title = lines[lineIdx] || 'Untitled'
    lineIdx++

    let excerpt = ''
    if (lineIdx < lines.length && !lines[lineIdx]?.includes('📅') && !/^https?:\/\//i.test(lines[lineIdx])) {
      excerpt = lines[lineIdx]
      lineIdx++
    }

    let sourceIdentifier: string | null = null
    if (lineIdx < lines.length && lines[lineIdx]?.includes('📅')) {
      const metaLine = lines[lineIdx]
      const sourceMatch = metaLine.match(/📰\s*([^|📅🏷️]+)/)
      sourceIdentifier = sourceMatch ? sourceMatch[1].trim() : null
      lineIdx++
    }

    const bodyLines = lines.slice(lineIdx).filter(l => !/^https?:\/\//i.test(l))
    const bodyContent = bodyLines.join('\n').trim()
    const fullContent = excerpt ? `${excerpt}\n\n${bodyContent}` : bodyContent

    if (fullContent.length < 50) continue

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

export async function processWebcrawl(): Promise<WebcrawlProcessResult> {
  const supabase = createAdminClient()

  // Get Gmail tokens
  const { data: tokenData, error: tokenError } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .limit(1)
    .single()

  if (tokenError || !tokenData?.refresh_token) {
    return { success: false, error: 'Gmail nicht verbunden' }
  }

  const gmailClient = new GmailClient(tokenData.refresh_token)

  const emails = await gmailClient.fetchEmailsBySubject(
    null,
    '+synthszr-webcrawler',
    1,
    FETCH_WINDOW_HOURS
  )

  console.log(`[WebCrawl] Found ${emails.length} +synthszr-webcrawler emails`)

  if (emails.length === 0) {
    return { success: true, message: 'Keine neuen WebCrawl-E-Mails', emails: 0, articles: 0 }
  }

  let processedEmails = 0
  let processedArticles = 0

  for (const email of emails) {
    const emailDate = email.date.toISOString().split('T')[0]
    const htmlContent = email.htmlBody || email.textBody || ''
    const articles = parseWebcrawlerArticles(htmlContent, email.textBody || '')

    console.log(`[WebCrawl] "${email.subject}" → ${articles.length} Artikel`)

    for (const article of articles) {
      // Dedup by source URL
      if (article.sourceUrl) {
        const { data: existing } = await supabase
          .from('daily_repo')
          .select('id')
          .eq('source_url', article.sourceUrl)
          .single()
        if (existing) continue
      }

      // Fallback dedup by title + source_type
      const { data: existingByTitle } = await supabase
        .from('daily_repo')
        .select('id')
        .eq('title', article.title)
        .eq('source_type', 'webcrawl')
        .single()
      if (existingByTitle) continue

      await supabase.from('daily_repo').insert({
        source_type: 'webcrawl',
        source_url: article.sourceUrl,
        source_email: article.sourceIdentifier || email.from,
        title: article.title,
        content: article.content,
        newsletter_date: emailDate,
        email_received_at: email.date.toISOString(),
      })

      processedArticles++
    }

    processedEmails++
  }

  // Backfill embeddings for newly inserted articles
  let embeddingsGenerated = 0
  try {
    const backfillResult = await backfillMissingEmbeddings(50, 0)
    embeddingsGenerated = backfillResult.processed
  } catch (err) {
    console.error('[WebCrawl] Embedding backfill error:', err)
  }

  console.log(`[WebCrawl] Complete: ${processedEmails} emails, ${processedArticles} articles, ${embeddingsGenerated} embeddings`)

  return {
    success: true,
    emails: processedEmails,
    articles: processedArticles,
    embeddingsGenerated,
  }
}
