import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

/**
 * Decode tracking redirect URLs to get the actual target URL
 * Supports: Substack JWT redirects, Customer.io tracking, email tracking URLs
 */
function decodeTrackingUrl(url: string): string {
  // Substack redirect URLs are JWT tokens with the target URL in the payload
  // Format: https://substack.com/redirect/2/eyJ...
  if (url.includes('substack.com/redirect/')) {
    try {
      const parts = url.split('/')
      const token = parts[parts.length - 1]
      // JWT format: header.payload.signature - we need the payload
      const payloadPart = token.split('.')[0]
      // Base64 decode the payload
      const decoded = Buffer.from(payloadPart, 'base64').toString('utf8')
      const payload = JSON.parse(decoded)
      if (payload.e && payload.e.startsWith('http')) {
        console.log(`[ArticleExtractor] Decoded Substack redirect: ${url.slice(0, 40)}... → ${payload.e.slice(0, 50)}...`)
        return payload.e
      }
    } catch {
      // Failed to decode, return original
    }
  }

  // Customer.io tracking URLs (used by The Information, etc.)
  // Format: https://e.customeriomail.com/e/c/eyJ...base64...
  if (url.includes('customeriomail.com/e/c/')) {
    try {
      const parts = url.split('/')
      const token = parts[parts.length - 1]
      const decoded = Buffer.from(token, 'base64').toString('utf8')
      const payload = JSON.parse(decoded)
      if (payload.href && payload.href.startsWith('http')) {
        console.log(`[ArticleExtractor] Decoded Customer.io redirect: ${url.slice(0, 40)}... → ${payload.href.slice(0, 50)}...`)
        return payload.href
      }
    } catch {
      // Failed to decode, return original
    }
  }

  // Substack app-link URLs - extract from query params
  // Format: https://substack.com/app-link/post?publication_id=X&post_id=Y
  if (url.includes('substack.com/app-link/')) {
    // These don't contain the actual URL, so we can't decode them
    // They will be resolved via HTTP redirect when fetched
  }

  return url
}

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
    // First, try to decode tracking URLs (like Substack JWT redirects)
    const decodedUrl = decodeTrackingUrl(url)
    const urlToFetch = decodedUrl !== url ? decodedUrl : url

    // Fetch the page with a reasonable timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15s timeout

    const response = await fetch(urlToFetch, {
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

    // Check Content-Type - reject non-HTML content (PDFs, images, etc.)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      console.warn(`[ArticleExtractor] Skipping non-HTML content: ${url} (Content-Type: ${contentType})`)
      return null
    }

    const html = await response.text()

    // Additional safety check: reject suspiciously large responses (likely binary/PDF)
    if (html.length > 500000) {
      console.warn(`[ArticleExtractor] Skipping oversized content: ${url} (${(html.length / 1000).toFixed(0)}k chars)`)
      return null
    }

    // Check for binary content that slipped through (PDF starts with %PDF-)
    if (html.startsWith('%PDF-') || html.startsWith('PK') /* ZIP */ || html.includes('\x00')) {
      console.warn(`[ArticleExtractor] Skipping binary content: ${url}`)
      return null
    }

    // Parse with JSDOM - use the actual fetched URL for proper relative link resolution
    const dom = new JSDOM(html, { url: urlToFetch })
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

    // Get the final URL - prefer decoded URL, then HTTP redirect, then original
    // This resolves tracking URLs like substack.com/redirect/... to the actual article URL
    let finalUrl: string | null = null

    // If we decoded a tracking URL, use that
    if (decodedUrl !== url) {
      finalUrl = decodedUrl
    }
    // If there was an HTTP redirect, use the response URL
    else if (response.url !== urlToFetch) {
      finalUrl = response.url
      console.log(`[ArticleExtractor] HTTP redirect: ${url.slice(0, 50)}... → ${finalUrl.slice(0, 50)}...`)
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
 * Check if a URL is likely to be an article (not a video, PDF, subscribe page, etc.)
 */
export function isLikelyArticleUrl(url: string): boolean {
  const urlLower = url.toLowerCase()

  // Skip non-article URLs
  const skipPatterns = [
    // File types (check before query params too)
    /\.(pdf|jpg|jpeg|png|gif|mp4|mp3|zip|exe)(\?|$)/i,

    // Social media (not articles)
    /youtube\.com/,
    /vimeo\.com/,
    /twitter\.com\/\w+\/status/,
    /x\.com\/\w+\/status/,
    /facebook\.com/,
    /instagram\.com/,
    /tiktok\.com/,

    // LinkedIn - any page (profiles, company pages, posts)
    /linkedin\.com/,

    // Profile pages (not articles)
    /substack\.com\/@\w+$/,  // Substack author profiles
    /medium\.com\/@\w+$/,    // Medium author profiles (without article path)

    // Subscribe/signup pages
    /\/subscribe\/?$/i,
    /\/signup\/?$/i,
    /\/register\/?$/i,

    // Email/utility links
    /mailto:/,
    /tel:/,
    /#$/,
    /unsubscribe/i,
    /manage.preferences/i,
    /view.in.browser/i,
    /email-preferences/i,

    // App store links
    /apps\.apple\.com/,
    /play\.google\.com/,
    /app-link\/post\?/,  // Substack app deep links (often don't resolve well)

    // Tracking/redirect pages that aren't articles
    /\/introducing-the-substack-app/i,

    // Generic homepage patterns (often not specific articles)
    /^https?:\/\/[^\/]+\/?$/,  // Just domain with no path
  ]

  for (const pattern of skipPatterns) {
    if (pattern.test(urlLower)) {
      return false
    }
  }

  return true
}

/**
 * Check if link text suggests this is NOT an article link
 */
export function isNonArticleLinkText(text: string): boolean {
  const textLower = text.toLowerCase().trim()

  const skipTextPatterns = [
    /^subscribe/i,
    /^sign up/i,
    /^join/i,
    /^follow/i,
    /^download the app/i,
    /^get the app/i,
    /^introducing the .* app/i,
    /^view in browser/i,
    /^unsubscribe/i,
    /^manage preferences/i,
    /\| linkedin$/i,  // "Company | LinkedIn"
    /\| substack$/i,  // "Author | Substack"
  ]

  for (const pattern of skipTextPatterns) {
    if (pattern.test(textLower)) {
      return true
    }
  }

  return false
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
    if (isNonArticleLinkText(link.text)) continue  // Skip "Subscribe to X" etc.

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
