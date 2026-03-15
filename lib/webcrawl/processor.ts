import { GmailClient } from '@/lib/gmail/client'
import * as cheerio from 'cheerio'
import { createAdminClient } from '@/lib/supabase/admin'
import { backfillMissingEmbeddings } from '@/lib/embeddings/backfill'
import { isTrackingRedirectUrl, sanitizeUrl } from '@/lib/utils/url-sanitizer'

const FETCH_WINDOW_HOURS = 72
const MAX_EMAILS = 5

/**
 * Resolve tracking redirect URLs (beehiiv, convertkit, etc.) to their
 * actual destination by following HTTP redirects.
 * Falls back to sanitizeUrl() if resolution fails.
 */
async function resolveTrackingUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (!isTrackingRedirectUrl(url)) return sanitizeUrl(url)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SynthszrBot/1.0)' },
    })

    const resolvedUrl = response.url
    if (resolvedUrl && resolvedUrl !== url && !isTrackingRedirectUrl(resolvedUrl)) {
      const cleaned = sanitizeUrl(resolvedUrl)
      if (cleaned) {
        console.log(`[WebCrawl] Resolved tracking URL → ${cleaned}`)
        return cleaned
      }
    }
  } catch (err) {
    console.warn(`[WebCrawl] Failed to resolve tracking URL: ${url.slice(0, 60)}...`, err)
  }

  // Fallback: keep the original URL (sanitizeUrl no longer returns null for tracking redirects)
  return sanitizeUrl(url)
}

export interface ParsedArticle {
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

// ─── Shared parsing utilities ───────────────────────────────────────────────

export function htmlToStructuredText(html: string): string {
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

function extractPriority(text: string): string | null {
  const m = text.match(/\b(HIGH|MEDIUM|LOW)\b/i)
  return m ? m[1].toUpperCase() : null
}

const UTILITY_LINK_PATTERNS = [
  'unsubscribe', 'mailto:', 'list-manage', 'campaign-archive',
  'twitter.com/', 'x.com/', 'linkedin.com/', 'facebook.com/',
  'instagram.com/', 'abmelden', 'impressum', 'datenschutz',
  'privacy', 'preferences', '#',
]

function isUtilityLink(href: string, text: string): boolean {
  const lower = (href + ' ' + text).toLowerCase()
  return UTILITY_LINK_PATTERNS.some(p => lower.includes(p)) || href.startsWith('tel:')
}

// ─── Strategy 1: "Artikel lesen" markers (original approach) ────────────────

function extractArtikelLesenLinks(html: string): string[] {
  if (!html) return []
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

/** Parse article sections that were split by a read-more marker */
function parseMarkerSections(sections: string[], sourceUrls: string[]): ParsedArticle[] {
  const articles: ParsedArticle[] = []

  for (let i = 0; i < sections.length; i++) {
    try {
      let section = sections[i]

      // For first section, skip intro text before the first priority label
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

      while (lineIdx < lines.length && /^https?:\/\//i.test(lines[lineIdx])) lineIdx++

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
    } catch (err) {
      console.warn(`[WebCrawl] Fehler beim Parsen von Sektion ${i}:`, err)
      // Continue with next section
    }
  }

  return articles
}

function tryArtikelLesenStrategy(html: string, text: string): ParsedArticle[] {
  const sourceUrls = extractArtikelLesenLinks(html)
  const sections = text.split(/Artikel\s*lesen\s*→?\s*/i)
  if (sections.length < 2) return []
  return parseMarkerSections(sections.slice(0, -1), sourceUrls)
}

// ─── Strategy 2: Read-more link variants ────────────────────────────────────

function extractVariantLinks(html: string): string[] {
  if (!html) return []
  const $ = cheerio.load(html)
  const urls: string[] = []
  $('a').each((_, el) => {
    const linkText = $(el).text().trim()
    if (/(?:read\s*more|weiterlesen|mehr\s*(?:lesen|erfahren)|zum\s*artikel|quelle|source)/i.test(linkText)) {
      const href = $(el).attr('href')
      if (href && href.startsWith('http')) urls.push(href)
    }
  })
  return urls
}

function tryReadMoreVariants(html: string, text: string): ParsedArticle[] {
  const sourceUrls = extractVariantLinks(html)
  const patterns = [
    /(?:Read\s*more|Weiterlesen|Mehr\s*(?:lesen|erfahren))\s*→?\s*/gi,
    /(?:Zum\s*Artikel|→\s*Quelle|→\s*Source|→\s*Original)\s*/gi,
  ]
  for (const pattern of patterns) {
    const sections = text.split(pattern)
    if (sections.length >= 2) {
      const articles = parseMarkerSections(sections.slice(0, -1), sourceUrls)
      if (articles.length > 0) return articles
    }
  }
  return []
}

// ─── Strategy 3: HTML structure — extract articles around external links ────

function tryHtmlLinksStrategy(html: string): ParsedArticle[] {
  if (!html) return []
  const $ = cheerio.load(html)

  // Find all external links that look like article sources
  const linkData: { href: string; sectionText: string }[] = []

  $('a[href^="http"]').each((_, el) => {
    const href = $(el).attr('href')?.trim()
    if (!href) return
    if (isUtilityLink(href, $(el).text())) return
    // Skip links pointing to synthszr itself
    if (href.includes('synthszr.com') || href.includes('synthszr.vercel.app')) return

    // Walk up to find a meaningful container
    let $container = $(el).parent()
    for (let i = 0; i < 6; i++) {
      const $parent = $container.parent()
      if (!$parent.length || $parent.is('body, html')) break
      // Stop if parent contains significantly more text (multiple sections)
      if ($parent.text().length > $container.text().length * 3) break
      $container = $parent
    }

    const sectionText = $container.text().trim()
    if (sectionText.length > 50) {
      linkData.push({ href, sectionText })
    }
  })

  if (linkData.length < 2) return []

  // Deduplicate by URL
  const seenUrls = new Set<string>()
  const articles: ParsedArticle[] = []

  for (const data of linkData) {
    if (seenUrls.has(data.href)) continue
    seenUrls.add(data.href)

    const lines = data.sectionText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) continue

    let titleIdx = 0
    const priority = extractPriority(lines[0] || '')
    if (priority) titleIdx = 1
    while (titleIdx < lines.length && /^https?:\/\//i.test(lines[titleIdx])) titleIdx++

    const title = lines[titleIdx] || 'Untitled'
    const contentLines = lines.slice(titleIdx + 1).filter(l => !/^https?:\/\/\S+$/i.test(l))
    const content = contentLines.join('\n').trim()

    if (content.length < 30) continue

    // Try to extract source identifier from metadata line
    let sourceIdentifier: string | null = null
    const metaLine = contentLines.find(l => l.includes('📰'))
    if (metaLine) {
      const sourceMatch = metaLine.match(/📰\s*([^|📅🏷️]+)/)
      sourceIdentifier = sourceMatch ? sourceMatch[1].trim() : null
    }

    articles.push({
      title,
      content,
      sourceUrl: data.href,
      sourceIdentifier,
      priority,
    })
  }

  return articles
}

// ─── Strategy 4: Section separator splitting ────────────────────────────────

function trySeparatorStrategy(text: string): ParsedArticle[] {
  const separatorPatterns = [
    /\n\s*(?:─{3,}|━{3,}|={3,}|-{3,}|_{3,}|\*{3,})\s*\n/,
    /\n\s*(?:•\s*•\s*•|···)\s*\n/,
  ]

  for (const pattern of separatorPatterns) {
    const sections = text.split(pattern).filter(s => s.trim().length > 50)
    if (sections.length >= 2) {
      const articles = parseGenericSections(sections)
      if (articles.length >= 2) return articles
    }
  }
  return []
}

// ─── Strategy 5: URL boundary splitting ─────────────────────────────────────

function tryUrlBoundaryStrategy(text: string): ParsedArticle[] {
  // Split into segments separated by standalone URL lines
  const lines = text.split('\n')
  const segments: { lines: string[]; url: string | null }[] = []
  let currentLines: string[] = []
  let lastUrl: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^https?:\/\/\S+$/i.test(trimmed) && !isUtilityLink(trimmed, '')) {
      if (currentLines.length > 0) {
        segments.push({ lines: currentLines, url: lastUrl })
      }
      lastUrl = trimmed
      currentLines = []
    } else {
      currentLines.push(trimmed)
    }
  }
  if (currentLines.length > 0) {
    segments.push({ lines: currentLines, url: lastUrl })
  }

  // Need at least 2 meaningful segments
  const meaningfulSegments = segments.filter(s => {
    const content = s.lines.filter(Boolean)
    return content.length >= 2 && content.join(' ').length > 50
  })

  if (meaningfulSegments.length < 2) return []

  const articles: ParsedArticle[] = []
  for (const seg of meaningfulSegments) {
    const content = seg.lines.map(l => l.trim()).filter(Boolean)
    if (content.length < 2) continue

    let titleIdx = 0
    const priority = extractPriority(content[0] || '')
    if (priority) titleIdx = 1

    const title = content[titleIdx] || 'Untitled'
    const body = content.slice(titleIdx + 1).join('\n').trim()

    if (body.length < 30) continue

    articles.push({
      title,
      content: body,
      sourceUrl: seg.url,
      sourceIdentifier: null,
      priority,
    })
  }

  return articles
}

// ─── Generic section parser (for separator strategy) ────────────────────────

function parseGenericSections(sections: string[]): ParsedArticle[] {
  const articles: ParsedArticle[] = []

  for (const section of sections) {
    try {
      const lines = section.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2) continue

      // Find URL in section
      const urlLine = lines.find(l => /^https?:\/\/\S+$/i.test(l))
      const contentLines = lines.filter(l => !/^https?:\/\/\S+$/i.test(l))

      if (contentLines.length < 1) continue

      let titleIdx = 0
      let priority: string | null = null
      if (/\b(HIGH|MEDIUM|LOW)\b/i.test(contentLines[0])) {
        priority = contentLines[0].match(/\b(HIGH|MEDIUM|LOW)\b/i)?.[1]?.toUpperCase() || null
        titleIdx = 1
      }

      const title = contentLines[titleIdx] || 'Untitled'

      let sourceIdentifier: string | null = null
      const metaLine = contentLines.find(l => l.includes('📰'))
      if (metaLine) {
        const sourceMatch = metaLine.match(/📰\s*([^|📅🏷️]+)/)
        sourceIdentifier = sourceMatch ? sourceMatch[1].trim() : null
      }

      const bodyLines = contentLines.slice(titleIdx + 1)
        .filter(l => !l.includes('📅') || !l.includes('📰'))
      const content = bodyLines.join('\n').trim()

      if (content.length < 30 && !urlLine) continue

      articles.push({
        title,
        content: content || section.trim(),
        sourceUrl: urlLine || null,
        sourceIdentifier,
        priority,
      })
    } catch (err) {
      console.warn(`[WebCrawl] Fehler beim Parsen einer generischen Sektion:`, err)
    }
  }

  return articles
}

// ─── Main parsing function with cascading strategies ────────────────────────

export function parseWebcrawlerArticles(htmlContent: string, textBody: string): ParsedArticle[] {
  const text = htmlToStructuredText(htmlContent) || textBody || ''
  if (!text) {
    console.warn('[WebCrawl] Leerer Email-Inhalt, nichts zu parsen')
    return []
  }

  const strategies: [string, () => ParsedArticle[]][] = [
    ['Artikel-lesen-Marker', () => tryArtikelLesenStrategy(htmlContent, text)],
    ['Read-more-Varianten', () => tryReadMoreVariants(htmlContent, text)],
    ['HTML-Linkstruktur', () => tryHtmlLinksStrategy(htmlContent)],
    ['Trennlinien', () => trySeparatorStrategy(text)],
    ['URL-Grenzen', () => tryUrlBoundaryStrategy(text)],
  ]

  for (const [name, strategy] of strategies) {
    try {
      const articles = strategy()
      if (articles.length > 0) {
        console.log(`[WebCrawl] Strategie "${name}": ${articles.length} Artikel gefunden`)
        return articles
      }
    } catch (err) {
      console.error(`[WebCrawl] Strategie "${name}" fehlgeschlagen:`, err)
    }
  }

  // All strategies failed — log diagnostic info
  console.warn(`[WebCrawl] Alle Parsing-Strategien fehlgeschlagen`)
  console.warn(`[WebCrawl] Text-Laenge: ${text.length}, HTML-Laenge: ${htmlContent?.length || 0}`)
  console.warn(`[WebCrawl] Erste 500 Zeichen:\n${text.substring(0, 500)}`)
  return []
}

// ─── Main process function ──────────────────────────────────────────────────

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
    MAX_EMAILS,
    FETCH_WINDOW_HOURS
  )

  console.log(`[WebCrawl] Found ${emails.length} +synthszr-webcrawler emails`)

  if (emails.length === 0) {
    return { success: true, message: 'Keine neuen WebCrawl-E-Mails', emails: 0, articles: 0 }
  }

  let processedEmails = 0
  let processedArticles = 0

  for (const email of emails) {
    try {
      const emailDate = email.date.toISOString().split('T')[0]
      const htmlContent = email.htmlBody || email.textBody || ''
      const articles = parseWebcrawlerArticles(htmlContent, email.textBody || '')

      console.log(`[WebCrawl] "${email.subject}" (${email.date.toISOString()}) → ${articles.length} Artikel geparst`)

      if (articles.length === 0) {
        console.warn(`[WebCrawl] Keine Artikel in Email "${email.subject}" gefunden — Email wird uebersprungen, Verarbeitung laeuft weiter`)
      }

      let skippedDuplicates = 0
      let newArticlesThisEmail = 0
      for (const article of articles) {
        try {
          // Resolve tracking redirect URLs to actual article URLs first
          // (needed for accurate dedup against already-resolved URLs in DB)
          const resolvedUrl = await resolveTrackingUrl(article.sourceUrl)

          // Dedup by source URL (check both resolved and original)
          if (resolvedUrl || article.sourceUrl) {
            const urlsToCheck = [resolvedUrl, article.sourceUrl].filter(Boolean) as string[]
            const { data: existing } = await supabase
              .from('daily_repo')
              .select('id')
              .in('source_url', urlsToCheck)
              .limit(1)
              .single()
            if (existing) {
              skippedDuplicates++
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
            skippedDuplicates++
            continue
          }

          await supabase.from('daily_repo').insert({
            source_type: 'webcrawl',
            source_url: resolvedUrl,
            source_email: article.sourceIdentifier || email.from,
            title: article.title,
            content: article.content,
            newsletter_date: emailDate,
            email_received_at: email.date.toISOString(),
          })

          processedArticles++
          newArticlesThisEmail++
        } catch (err) {
          console.error(`[WebCrawl] Fehler beim Speichern von Artikel "${article.title}":`, err)
          // Continue with next article
        }
      }

      console.log(`[WebCrawl] "${email.subject}" → neu: ${newArticlesThisEmail}, uebersprungen (Duplikat): ${skippedDuplicates}`)
      processedEmails++
    } catch (err) {
      console.error(`[WebCrawl] Fehler beim Verarbeiten von Email "${email.subject}":`, err)
      // Continue with next email
    }
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
