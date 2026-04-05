import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { isTrackingRedirectUrl } from '@/lib/utils/url-sanitizer'

/**
 * Decode tracking redirect URLs to get the actual target URL.
 * Many newsletter services wrap article links in tracking redirects.
 * Some encode the destination in the URL itself (TLDR, Customer.io),
 * others use opaque tokens that only resolve via HTTP redirect (Beehiiv, Mailchimp).
 */
export function decodeTrackingUrl(url: string): string {
  // TLDR tracking URLs encode the destination in the path:
  // Format: https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fwww.example.com%2Farticle/1/...
  if (url.includes('tracking.tldrnewsletter.com/CL0/') || url.includes('tldrnewsletter.com/CL0/')) {
    try {
      const match = url.match(/CL0\/([^/]+)/)
      if (match) {
        const decoded = decodeURIComponent(match[1])
        if (decoded.startsWith('http')) {
          console.log(`[ArticleExtractor] Decoded TLDR redirect: ${url.slice(0, 50)}... → ${decoded.slice(0, 60)}...`)
          return decoded
        }
      }
    } catch {
      // Failed to decode, fall through
    }
  }

  // Sendgrid/generic tracking with URL in path:
  // Format: https://u12345.ct.sendgrid.net/ls/click?upn=...&url=https%3A%2F%2F...
  if (url.includes('sendgrid.net/') || url.includes('/track/click')) {
    try {
      const parsed = new URL(url)
      const targetUrl = parsed.searchParams.get('url') || parsed.searchParams.get('u')
      if (targetUrl?.startsWith('http')) {
        console.log(`[ArticleExtractor] Decoded Sendgrid redirect: ${url.slice(0, 50)}... → ${targetUrl.slice(0, 60)}...`)
        return targetUrl
      }
    } catch {
      // Failed to decode, fall through
    }
  }

  // Substack redirect URLs: destination resolved via HTTP redirect.
  // The JWT `j` param only contains subscriber ID, not the target URL.
  // Let fetch() handle the redirect chain automatically.

  // Beehiiv tracking URLs: sometimes have destination in query param
  if (url.includes('beehiiv.com/')) {
    try {
      const parsed = new URL(url)
      const targetUrl = parsed.searchParams.get('url') || parsed.searchParams.get('redirect_url')
      if (targetUrl?.startsWith('http')) {
        console.log(`[ArticleExtractor] Decoded Beehiiv redirect: ${url.slice(0, 50)}... → ${targetUrl.slice(0, 60)}...`)
        return targetUrl
      }
    } catch {
      // Fall through to HTTP redirect
    }
  }

  // Mailchimp/list-manage tracking URLs: destination in 'u' or 'url' param
  if (url.includes('list-manage.com/') || url.includes('mailchimp.com/')) {
    try {
      const parsed = new URL(url)
      const targetUrl = parsed.searchParams.get('url') || parsed.searchParams.get('u')
      if (targetUrl?.startsWith('http')) {
        console.log(`[ArticleExtractor] Decoded Mailchimp redirect: ${url.slice(0, 50)}... → ${targetUrl.slice(0, 60)}...`)
        return targetUrl
      }
    } catch {
      // Fall through
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
      // Failed to decode, fall through
    }
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
export async function extractArticleContent(url: string, attempt = 1): Promise<ExtractedArticle | null> {
  try {
    // First, try to decode tracking URLs (like TLDR, Customer.io)
    const decodedUrl = decodeTrackingUrl(url)
    let urlToFetch = decodedUrl !== url ? decodedUrl : url

    // Pre-resolve tracking redirects via HEAD request (Beehiiv, Mailchimp, ConvertKit, etc.)
    // Many tracking services use opaque tokens that can only be resolved via HTTP redirect
    if (urlToFetch === url && isTrackingRedirectUrl(url)) {
      try {
        const headController = new AbortController()
        const headTimeout = setTimeout(() => headController.abort(), 8000)
        const headResponse = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: headController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        })
        clearTimeout(headTimeout)
        if (headResponse.url && headResponse.url !== url) {
          urlToFetch = headResponse.url
          console.log(`[ArticleExtractor] Resolved tracking redirect via HEAD: ${url.slice(0, 50)}... → ${urlToFetch.slice(0, 50)}...`)
        }
      } catch {
        // HEAD failed, continue with original URL
      }
    }

    // Fetch the page (25s timeout, extended from 15s for slow news sites)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 25000)

    const response = await fetch(urlToFetch, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      clearTimeout(timeoutId)
      // Retry once on transient errors (429, 500, 502, 503, 504)
      if (attempt === 1 && [429, 500, 502, 503, 504].includes(response.status)) {
        console.warn(`[ArticleExtractor] Retry after ${response.status}: ${url.slice(0, 80)}...`)
        await new Promise(r => setTimeout(r, 2000))
        return extractArticleContent(url, 2)
      }
      console.error(`[ArticleExtractor] Failed ${url.slice(0, 80)}...: ${response.status}`)
      return null
    }

    // Check Content-Type - reject non-HTML content (PDFs, images, etc.)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      clearTimeout(timeoutId)
      console.warn(`[ArticleExtractor] Skipping non-HTML content: ${url} (Content-Type: ${contentType})`)
      return null
    }

    const html = await response.text()
    clearTimeout(timeoutId)

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
      // Retry once on timeout
      if (attempt === 1) {
        console.warn(`[ArticleExtractor] Timeout, retrying: ${url.slice(0, 80)}...`)
        await new Promise(r => setTimeout(r, 1000))
        return extractArticleContent(url, 2)
      }
      console.error(`[ArticleExtractor] Timeout (final): ${url.slice(0, 80)}...`)
    } else {
      console.error(`[ArticleExtractor] Error: ${url.slice(0, 80)}...`, error instanceof Error ? error.message : error)
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
    /^https?:\/\/[^\/]+\/\?/,  // Domain with only query params (e.g., theinformation.com/?utm=...)

    // Newsletter metadata/utility pages
    /zendesk\.com/i,           // Help centers
    /\/newsletters\/?(\?|$)/i, // Newsletter listing pages (with or without query params)
    /\/newsletter\/manage/i,   // Newsletter management pages (newyorker.com)
    /\/subscribe\?/i,          // Subscribe pages with params
    /\/deep-research\/?$/i,    // Tool pages
    /\/titv\/?$/i,             // Video hub pages (but allow /titv/specific-video)

    // Help centers and support pages
    /help\.[^\/]+\.[a-z]+\//i, // help.*.com/* subdomains (help.nytimes.com, etc.)
    /zendesk\.com/i,           // Zendesk help centers (theinformation.zendesk.com, etc.)
    /\/v2\/offers\//i,         // Subscription offer pages (newyorker.com/v2/offers/)
    /\/about\/?(\?|$)/i,       // About pages (e.g., wirecutter/about/)

    // User/author profile pages
    /\/u\/[a-z0-9_-]+(\?|$)/i, // User profiles (theinformation.com/u/username)
    /\/author\/[a-z0-9_-]+(\?|$)/i, // Author pages
    /\/authors?\/[a-z0-9_-]+(\?|$)/i, // Author pages (plural)
    /\/team\/[a-z0-9_-]+(\?|$)/i,    // Team member pages

    // German legal/utility pages
    /\/impressum\/?(\?|$)/i,        // Imprint
    /\/datenschutz\/?(\?|$)/i,      // Privacy policy
    /\/agb\/?(\?|$)/i,              // Terms & conditions
    /\/kontakt\/?(\?|$)/i,          // Contact
    /\/abmelden\/?(\?|$)/i,         // Unsubscribe
    /\/nutzungsbedingungen\/?(\?|$)/i, // Terms of use
    /\/privacy\/?(\?|$)/i,          // Privacy (English path)
    /\/terms\/?(\?|$)/i,            // Terms (English path)
    /\/legal\/?(\?|$)/i,            // Legal
    /\/contact\/?(\?|$)/i,          // Contact (English path)
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
    // English
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

    // German footer/utility links
    /^abmelden/i,           // Unsubscribe
    /^abbestellen/i,        // Unsubscribe (alternative)
    /^impressum/i,          // Imprint/Legal notice
    /^datenschutz/i,        // Privacy policy
    /^kontakt$/i,           // Contact
    /^agb$/i,               // Terms & conditions
    /^nutzungsbedingungen/i, // Terms of use
    /^im browser (ansehen|anzeigen|öffnen)/i, // View in browser
    /^newsletter abbestellen/i,
    /^email.?einstellungen/i, // Email settings
    /^profil bearbeiten/i,  // Edit profile
    /^einstellungen ändern/i, // Change settings
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

/**
 * Fallback: extract article content via markdown.new service
 * Used when Readability extraction fails (paywalls, JS-heavy pages, anti-bot)
 */
export async function extractViaMarkdownNew(url: string): Promise<{ title: string | null; content: string } | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    console.log(`[ArticleExtractor] Trying markdown.new fallback for: ${url.slice(0, 80)}...`)
    const response = await fetch(`https://markdown.new/${url}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain, text/markdown, */*',
      },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.log(`[ArticleExtractor] markdown.new returned ${response.status} for: ${url.slice(0, 60)}`)
      return null
    }

    const markdown = await response.text()
    if (!markdown || markdown.length < 100) {
      console.log(`[ArticleExtractor] markdown.new returned too little content (${markdown.length} chars)`)
      return null
    }

    // Extract title from first heading
    const titleMatch = markdown.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : null

    console.log(`[ArticleExtractor] markdown.new success: ${markdown.length} chars, title: "${(title || 'none').slice(0, 50)}"`)
    return { title, content: markdown }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`[ArticleExtractor] markdown.new timeout for: ${url.slice(0, 60)}`)
    } else {
      console.log(`[ArticleExtractor] markdown.new error for: ${url.slice(0, 60)}:`, error instanceof Error ? error.message : error)
    }
    return null
  }
}
