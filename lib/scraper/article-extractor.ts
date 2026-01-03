import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

/**
 * Extract publish date from HTML document using common meta tags and elements
 */
function extractPublishDate(document: Document): Date | null {
  // Try various meta tags for publish date (in order of reliability)
  const dateSelectors = [
    // Open Graph / Schema.org
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[name="DC.date.issued"]',
    'meta[itemprop="datePublished"]',
    // Substack specific
    'meta[property="article:modified_time"]',
    // Time elements
    'time[datetime]',
    'time[pubdate]',
    // JSON-LD (check script tags)
  ]

  for (const selector of dateSelectors) {
    const element = document.querySelector(selector)
    if (element) {
      const dateStr = element.getAttribute('content') || element.getAttribute('datetime')
      if (dateStr) {
        const parsed = new Date(dateStr)
        if (!isNaN(parsed.getTime())) {
          return parsed
        }
      }
    }
  }

  // Try JSON-LD structured data
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || '')
      // Handle arrays and single objects
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        const dateStr = item.datePublished || item.dateCreated
        if (dateStr) {
          const parsed = new Date(dateStr)
          if (!isNaN(parsed.getTime())) {
            return parsed
          }
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null
}

/**
 * Check if an article is too old (default: older than 48 hours)
 */
export function isArticleTooOld(publishedDate: Date | null, maxAgeHours: number = 48): boolean {
  if (!publishedDate) {
    // If we can't determine the date, assume it's okay (don't block)
    return false
  }
  const ageMs = Date.now() - publishedDate.getTime()
  const ageHours = ageMs / (1000 * 60 * 60)
  return ageHours > maxAgeHours
}

export interface ExtractedArticle {
  title: string | null
  content: string | null
  textContent: string | null
  excerpt: string | null
  byline: string | null
  siteName: string | null
  length: number
  publishedDate: Date | null  // Extracted publish date for age filtering
  finalUrl: string | null     // Final URL after redirects (for tracking URL resolution)
}

/**
 * Extract article content from a URL using Mozilla Readability
 */
export async function extractArticleContent(url: string): Promise<ExtractedArticle | null> {
  try {
    // Fetch the page with a reasonable timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SynthszrBot/1.0; +https://synthszr.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`)
      return null
    }

    const html = await response.text()

    // Parse with JSDOM
    const dom = new JSDOM(html, { url })
    const document = dom.window.document

    // Extract publish date BEFORE Readability modifies the DOM
    const publishedDate = extractPublishDate(document)

    // Use Readability to extract the article
    const reader = new Readability(document)
    const article = reader.parse()

    if (!article) {
      console.error(`Readability could not parse ${url}`)
      return null
    }

    // Get the final URL after redirects (response.url contains the resolved URL)
    // This resolves tracking URLs like substack.com/redirect/... to the actual article URL
    const finalUrl = response.url !== url ? response.url : null

    if (finalUrl) {
      console.log(`[ArticleExtractor] Resolved redirect: ${url.slice(0, 50)}... → ${finalUrl.slice(0, 50)}...`)
    }

    return {
      title: article.title ?? null,
      content: article.content ?? null, // HTML content
      textContent: article.textContent ?? null, // Plain text
      excerpt: article.excerpt ?? null,
      byline: article.byline ?? null,
      siteName: article.siteName ?? null,
      length: article.length ?? 0,
      publishedDate,
      finalUrl,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Timeout fetching ${url}`)
    } else {
      console.error(`Error extracting article from ${url}:`, error)
    }
    return null
  }
}

/**
 * Check if a URL is likely to be an article (not a video, PDF, etc.)
 */
export function isLikelyArticleUrl(url: string): boolean {
  const urlLower = url.toLowerCase()

  // Skip non-article URLs
  const skipPatterns = [
    /\.(pdf|jpg|jpeg|png|gif|mp4|mp3|zip|exe)$/i,
    /youtube\.com/,
    /vimeo\.com/,
    /twitter\.com\/\w+\/status/,
    /x\.com\/\w+\/status/,
    /linkedin\.com\/posts/,
    /facebook\.com/,
    /instagram\.com/,
    /tiktok\.com/,
    /mailto:/,
    /tel:/,
    /#$/,
    /unsubscribe/i,
    /manage.preferences/i,
    /view.in.browser/i,
  ]

  for (const pattern of skipPatterns) {
    if (pattern.test(urlLower)) {
      return false
    }
  }

  return true
}

/**
 * Extract and filter article URLs from parsed links
 */
export function filterArticleUrls(
  links: Array<{ url: string; text: string; type: string }>,
  maxUrls: number = 10
): string[] {
  const seen = new Set<string>()
  const articleUrls: string[] = []

  for (const link of links) {
    if (link.type !== 'article') continue
    if (!isLikelyArticleUrl(link.url)) continue

    // Normalize URL (remove tracking params)
    try {
      const url = new URL(link.url)
      // Remove common tracking parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source']
      trackingParams.forEach(param => url.searchParams.delete(param))

      const normalizedUrl = url.toString()

      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl)
        articleUrls.push(normalizedUrl)

        if (articleUrls.length >= maxUrls) break
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return articleUrls
}
