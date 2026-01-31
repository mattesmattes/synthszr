/**
 * URL Sanitizer
 * Removes tracking parameters and session identifiers from URLs
 * to prevent leaking subscriber data when publishing links
 */

// Tracking parameters to always remove
const TRACKING_PARAMS = new Set([
  // Beehiiv
  '_bhlid',
  '_bhiiv',
  'bhcid',
  'bhcl_id',
  'bh_uid',
  'last_resource_guid',
  'jwt_token',
  // UTM tracking
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  // Facebook/Meta
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  // Google
  'gclid',
  'gclsrc',
  'dclid',
  // Mailchimp
  'mc_eid',
  'mc_cid',
  // Twitter/X
  'twclid',
  // LinkedIn
  'li_fat_id',
  // Microsoft/Bing
  'msclkid',
  // HubSpot
  '__hsfp',
  '__hssc',
  '__hstc',
  'hsCtaTracking',
  // Marketo
  'mkt_tok',
  // Drip
  '__s',
  // Klaviyo
  '_kx',
  // Generic tracking
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'src',
  'campaign',
  'trk',
  'track',
  'tracking',
  'sid',
  'session',
  'sessionid',
  'session_id',
  'subscriber',
  'subscriber_id',
  'user_id',
  'email_id',
  'link_id',
  'redirect',
  'redir',
  // Substack
  'r', // Substack referrer tracking
  'publication_id',
  // SendGrid
  'sg_uid',
  // Customer.io
  'cio_id',
  'cio_link_id',
])

// Patterns for parameters that look like session/tracking IDs (long hex strings)
const SUSPICIOUS_PARAM_PATTERNS = [
  /^[a-f0-9]{24,}$/i,  // Long hex strings (24+ chars)
  /^[a-f0-9-]{32,}$/i, // UUID-like strings
]

// Domains that are tracking/redirect services (URLs should be flagged, not published)
const TRACKING_REDIRECT_DOMAINS = [
  'links.beehiiv.com',
  'u001.beehiiv.com',
  'mail.beehiiv.com',
  'customeriomail.com',
  'click.convertkit-mail.com',
  'click.convertkit-mail2.com',
  'email.mg.substack.com',
  'list-manage.com',
  'mailchimp.com',
  'sendinblue.com',
  'sendgrid.net',
  'mailgun.org',
  'tracking.tldrnewsletter.com',
  't.co', // Twitter shortener
]

// Tracking paths - hostname + path combinations that indicate tracking URLs
const TRACKING_PATHS = [
  { hostname: 'substack.com', pathPrefix: '/redirect' },
  { hostname: 'every.to', pathPrefix: '/emails/click' },
  { hostname: 'link.mail.beehiiv.com', pathPrefix: '/' },
]

/**
 * Check if a URL is a tracking/redirect service URL that shouldn't be published
 */
export function isTrackingRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    // Check domain-only tracking services
    const isDomainTracker = TRACKING_REDIRECT_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    )
    if (isDomainTracker) return true

    // Check hostname + path tracking patterns
    const isPathTracker = TRACKING_PATHS.some(tracker =>
      (hostname === tracker.hostname || hostname.endsWith('.' + tracker.hostname)) &&
      pathname.startsWith(tracker.pathPrefix)
    )
    return isPathTracker
  } catch {
    return false
  }
}

/**
 * Check if a parameter value looks like a tracking/session ID
 */
function isSuspiciousParamValue(value: string): boolean {
  // Check if value matches suspicious patterns
  return SUSPICIOUS_PARAM_PATTERNS.some(pattern => pattern.test(value))
}

/**
 * Sanitize a URL by removing tracking parameters
 * Returns the cleaned URL or null if the URL is a tracking redirect that can't be cleaned
 */
export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)

    // If this is a tracking redirect URL, return null (shouldn't be used)
    if (isTrackingRedirectUrl(url)) {
      console.log(`[URL Sanitizer] Blocked tracking redirect: ${url.slice(0, 80)}...`)
      return null
    }

    // Remove known tracking parameters
    const paramsToRemove: string[] = []

    parsed.searchParams.forEach((value, key) => {
      const keyLower = key.toLowerCase()

      // Check if key is a known tracking param
      if (TRACKING_PARAMS.has(keyLower)) {
        paramsToRemove.push(key)
        return
      }

      // Check if key starts with common tracking prefixes
      if (keyLower.startsWith('utm_') ||
          keyLower.startsWith('mc_') ||
          keyLower.startsWith('fb_') ||
          keyLower.startsWith('__')) {
        paramsToRemove.push(key)
        return
      }

      // Check if value looks like a session/tracking ID
      if (isSuspiciousParamValue(value)) {
        console.log(`[URL Sanitizer] Removing suspicious param: ${key}=${value.slice(0, 20)}...`)
        paramsToRemove.push(key)
      }
    })

    // Remove the identified params
    for (const param of paramsToRemove) {
      parsed.searchParams.delete(param)
    }

    // Also clean up hash if it looks like tracking
    if (parsed.hash && isSuspiciousParamValue(parsed.hash.slice(1))) {
      parsed.hash = ''
    }

    return parsed.toString()
  } catch (error) {
    console.error('[URL Sanitizer] Failed to parse URL:', url, error)
    return url // Return original if parsing fails
  }
}

/**
 * Sanitize a URL and extract a clean version for public display
 * Also returns metadata about what was removed
 */
export function sanitizeUrlWithInfo(url: string | null | undefined): {
  sanitized: string | null
  original: string | null
  isBlocked: boolean
  removedParams: string[]
} {
  if (!url) {
    return { sanitized: null, original: null, isBlocked: false, removedParams: [] }
  }

  const isBlocked = isTrackingRedirectUrl(url)
  if (isBlocked) {
    return { sanitized: null, original: url, isBlocked: true, removedParams: [] }
  }

  try {
    const parsed = new URL(url)
    const removedParams: string[] = []

    parsed.searchParams.forEach((value, key) => {
      const keyLower = key.toLowerCase()

      if (TRACKING_PARAMS.has(keyLower) ||
          keyLower.startsWith('utm_') ||
          keyLower.startsWith('mc_') ||
          keyLower.startsWith('fb_') ||
          keyLower.startsWith('__') ||
          isSuspiciousParamValue(value)) {
        removedParams.push(key)
      }
    })

    for (const param of removedParams) {
      parsed.searchParams.delete(param)
    }

    return {
      sanitized: parsed.toString(),
      original: url,
      isBlocked: false,
      removedParams
    }
  } catch {
    return { sanitized: url, original: url, isBlocked: false, removedParams: [] }
  }
}

/**
 * Batch sanitize multiple URLs
 */
export function sanitizeUrls(urls: (string | null | undefined)[]): (string | null)[] {
  return urls.map(sanitizeUrl)
}

/**
 * Sanitize all URLs within text/markdown content
 * Removes tracking URLs entirely or cleans tracking params from other URLs
 */
export function sanitizeContentUrls(content: string | null | undefined): string {
  if (!content) return ''

  // Match markdown links: [text](url) and raw URLs: https://...
  const markdownLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
  const rawUrlRegex = /(https?:\/\/[^\s<>\[\]"']+)/g

  let result = content

  // First, handle markdown links
  result = result.replace(markdownLinkRegex, (match, text, url) => {
    // If it's a tracking redirect, remove the entire link (keep just the text)
    if (isTrackingRedirectUrl(url)) {
      console.log(`[URL Sanitizer] Removed tracking link from content: ${url.slice(0, 50)}...`)
      return text || '' // Just keep the link text
    }
    // Otherwise, sanitize the URL
    const cleaned = sanitizeUrl(url)
    if (cleaned && cleaned !== url) {
      return `[${text}](${cleaned})`
    }
    return match
  })

  // Then, handle raw URLs (not in markdown format)
  result = result.replace(rawUrlRegex, (url) => {
    // Skip if this URL is part of a markdown link (already handled)
    // Check if preceded by ]( which indicates markdown link
    const urlIndex = result.indexOf(url)
    if (urlIndex > 1 && result.slice(urlIndex - 2, urlIndex) === '](') {
      return url // Skip, already handled
    }

    // If it's a tracking redirect, remove it entirely
    if (isTrackingRedirectUrl(url)) {
      console.log(`[URL Sanitizer] Removed raw tracking URL from content: ${url.slice(0, 50)}...`)
      return '' // Remove the URL
    }
    // Otherwise, sanitize the URL
    const cleaned = sanitizeUrl(url)
    return cleaned || ''
  })

  return result
}
