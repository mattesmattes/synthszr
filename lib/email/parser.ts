import * as cheerio from 'cheerio'

export interface ExtractedLink {
  url: string
  text: string
  type: 'article' | 'social' | 'unsubscribe' | 'other'
}

export interface ParsedNewsletter {
  subject: string
  from: string
  date: Date
  plainText: string
  links: ExtractedLink[]
  images: string[]
}

// Domains that are typically social media or not article content
const SOCIAL_DOMAINS = [
  'twitter.com', 'x.com',
  'facebook.com', 'fb.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'threads.net',
  'reddit.com',
]

// Patterns that indicate unsubscribe/management links
const UNSUBSCRIBE_PATTERNS = [
  'unsubscribe',
  'abmelden',
  'opt-out',
  'optout',
  'manage preferences',
  'email preferences',
  'einstellungen',
  'abbestellen',
]

/**
 * Parse newsletter HTML and extract relevant content
 */
export function parseNewsletterHtml(
  html: string,
  subject: string,
  from: string,
  date: Date
): ParsedNewsletter {
  const $ = cheerio.load(html)

  // Extract plain text (cleaned)
  const plainText = extractPlainText($)

  // Extract all links
  const links = extractLinks($)

  // Extract images
  const images = extractImages($)

  return {
    subject,
    from,
    date,
    plainText,
    links,
    images,
  }
}

/**
 * Extract clean plain text from HTML
 */
function extractPlainText($: cheerio.CheerioAPI): string {
  // Remove script, style, and other non-content elements
  $('script, style, head, nav, footer, .footer, .unsubscribe').remove()

  // Get text content
  let text = $('body').text() || $.root().text()

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim()

  return text
}

/**
 * Extract and categorize links from HTML
 */
function extractLinks($: cheerio.CheerioAPI): ExtractedLink[] {
  const links: ExtractedLink[] = []
  const seenUrls = new Set<string>()

  $('a[href]').each((_, element) => {
    const $el = $(element)
    const href = $el.attr('href')
    const text = $el.text().trim()

    if (!href) return

    // Skip mailto, tel, and anchor links
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
      return
    }

    // Clean and normalize the URL
    const cleanUrl = cleanAndNormalizeUrl(href)
    if (!cleanUrl) return

    // Skip duplicates
    if (seenUrls.has(cleanUrl)) return
    seenUrls.add(cleanUrl)

    // Categorize the link
    const type = categorizeLink(cleanUrl, text)

    links.push({
      url: cleanUrl,
      text: text || cleanUrl,
      type,
    })
  })

  return links
}

/**
 * Extract image URLs from HTML
 */
function extractImages($: cheerio.CheerioAPI): string[] {
  const images: string[] = []
  const seenUrls = new Set<string>()

  $('img[src]').each((_, element) => {
    const src = $(element).attr('src')
    if (!src) return

    // Skip data URIs and tracking pixels
    if (src.startsWith('data:')) return
    if (src.includes('tracking') || src.includes('pixel') || src.includes('beacon')) return

    // Skip tiny images (likely tracking)
    const width = $(element).attr('width')
    const height = $(element).attr('height')
    if ((width && parseInt(width) < 10) || (height && parseInt(height) < 10)) return

    if (!seenUrls.has(src)) {
      seenUrls.add(src)
      images.push(src)
    }
  })

  return images
}

/**
 * Clean and normalize a URL
 */
function cleanAndNormalizeUrl(url: string): string | null {
  try {
    // Handle relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url
    }

    // Parse URL
    const parsed = new URL(url)

    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'mc_cid', 'mc_eid',
      'ref', 'source',
      'fbclid', 'gclid',
      '__s', '_hsenc', '_hsmi',
    ]

    trackingParams.forEach(param => {
      parsed.searchParams.delete(param)
    })

    // Reconstruct URL without tracking params
    return parsed.toString()
  } catch {
    // Invalid URL
    return null
  }
}

/**
 * Categorize a link based on URL and text
 */
function categorizeLink(url: string, text: string): ExtractedLink['type'] {
  const lowerUrl = url.toLowerCase()
  const lowerText = text.toLowerCase()

  // Check for unsubscribe links
  for (const pattern of UNSUBSCRIBE_PATTERNS) {
    if (lowerUrl.includes(pattern) || lowerText.includes(pattern)) {
      return 'unsubscribe'
    }
  }

  // Check for social media links
  try {
    const hostname = new URL(url).hostname.replace('www.', '')
    for (const domain of SOCIAL_DOMAINS) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return 'social'
      }
    }
  } catch {
    // Invalid URL, categorize as other
    return 'other'
  }

  // Check if it looks like an article link
  if (isLikelyArticleUrl(url)) {
    return 'article'
  }

  return 'other'
}

/**
 * Check if a URL is likely an article
 */
function isLikelyArticleUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase()

  // Skip common non-article paths
  const nonArticlePaths = [
    '/login', '/signup', '/register',
    '/account', '/profile', '/settings',
    '/cart', '/checkout', '/shop',
    '/about', '/contact', '/privacy', '/terms',
    '/unsubscribe', '/preferences',
    '/subscribe', '/subscription',
    '/app', '/app-link',
    '/survey', '/form',
    '/introducing-the-substack-app',
  ]

  for (const path of nonArticlePaths) {
    if (lowerUrl.includes(path)) {
      return false
    }
  }

  // Skip non-article domains entirely
  const nonArticleDomains = [
    'typeform.com',      // Surveys
    'forms.gle',         // Google Forms
    'surveymonkey.com',  // Surveys
    'docs.google.com',   // Google Docs
    'drive.google.com',  // Google Drive
    'calendly.com',      // Scheduling
    'zoom.us',           // Video calls
    'teams.microsoft.com',
    'slack.com',
    'discord.com',
    'apps.apple.com',    // App Store
    'play.google.com',   // Play Store
    'wsj.com/subscribe', // Subscription pages
    'nytimes.com/subscription',
  ]

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const domain of nonArticleDomains) {
      if (hostname.includes(domain) || lowerUrl.includes(domain)) {
        return false
      }
    }
  } catch {
    return false
  }

  // Skip URLs with subscription/survey keywords
  const skipKeywords = [
    'subscribe?',
    'subscription?',
    'survey',
    'form.typeform',
    'win-$',
    'win $',
    'annual-survey',
  ]

  for (const keyword of skipKeywords) {
    if (lowerUrl.includes(keyword)) {
      return false
    }
  }

  // Common article URL patterns
  const articlePatterns = [
    /\/\d{4}\/\d{2}\//, // Date-based paths like /2024/01/
    /\/articles?\//,
    /\/posts?\//,
    /\/blog\//,
    /\/news\//,
    /\/story\//,
    /\/p\/[a-z0-9-]+/i, // Medium-style paths
    /-[a-z0-9]{6,}$/i, // URLs ending with slug-hash
  ]

  for (const pattern of articlePatterns) {
    if (pattern.test(lowerUrl)) {
      return true
    }
  }

  // Has a meaningful path (not just homepage)
  try {
    const pathname = new URL(url).pathname
    if (pathname.length > 10 && pathname.includes('/')) {
      return true
    }
  } catch {
    return false
  }

  return false
}

/**
 * Extract the main content areas from a newsletter
 */
export function extractMainContent($: cheerio.CheerioAPI): string {
  // Try to find the main content container
  const mainSelectors = [
    'article',
    '[role="main"]',
    '.content',
    '.main-content',
    '.email-content',
    '.body-content',
    'table.body', // Common in email templates
  ]

  for (const selector of mainSelectors) {
    const content = $(selector).first()
    if (content.length > 0) {
      return content.html() || ''
    }
  }

  // Fallback to body
  return $('body').html() || $.html()
}
