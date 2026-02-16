/**
 * URL Verifier
 * Checks TipTap content for tracking URLs before saving
 * Returns issues that need to be fixed before publishing
 */

import type { JSONContent } from '@tiptap/react'

// Tracking parameters that should never appear in published content
const TRACKING_PARAMS = [
  // Beehiiv
  '_bhlid', '_bhiiv', 'bhcid', 'bhcl_id', 'bh_uid',
  'last_resource_guid', 'jwt_token',
  // UTM
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  // Social
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'twclid', 'msclkid', 'li_fat_id',
  // Email
  'mc_eid', 'mc_cid', 'cio_id', 'cio_link_id', 'sg_uid', 'mkt_tok',
  // Session/User
  'subscriber_id', 'user_id', 'email_id', 'session_id', 'link_id',
  // HubSpot
  '__hsfp', '__hssc', '__hstc', '__s', 'hsCtaTracking',
  // Other
  '_kx', 'publication_id',
]

// Domains that are tracking/redirect services
const REDIRECT_DOMAINS = [
  'link.mail.beehiiv.com',
  'links.beehiiv.com',
  'u001.beehiiv.com',
  'e.customeriomail.com',
  'customeriomail.com',
  'list-manage.com',
  'tracking.tldrnewsletter.com',
  'click.convertkit-mail.com',
  'email.mg.substack.com',
  'sendgrid.net',
  'mailchimp.com',
]

// Path patterns that indicate tracking
const TRACKING_PATHS = [
  'every.to/emails/click',
]

export interface UrlIssue {
  url: string
  type: 'tracking_param' | 'redirect_domain' | 'tracking_path'
  details: string
}

export interface VerificationResult {
  isClean: boolean
  issues: UrlIssue[]
  urlCount: number
}

/**
 * Extract all URLs from TipTap JSON content
 */
function extractUrls(content: JSONContent): string[] {
  const urls: string[] = []

  function traverse(node: JSONContent) {
    // Check marks for links
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'link' && mark.attrs?.href) {
          urls.push(mark.attrs.href)
        }
      }
    }

    // Recursively check content
    if (node.content) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }

  traverse(content)
  return [...new Set(urls)] // Deduplicate
}

/**
 * Check a single URL for tracking issues
 */
function checkUrl(url: string): UrlIssue | null {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    const fullUrl = url.toLowerCase()

    // Check for redirect domains
    for (const domain of REDIRECT_DOMAINS) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return {
          url,
          type: 'redirect_domain',
          details: `Tracking-Redirect: ${domain}`,
        }
      }
    }

    // Check for tracking paths
    for (const path of TRACKING_PATHS) {
      if (fullUrl.includes(path)) {
        return {
          url,
          type: 'tracking_path',
          details: `Tracking-Path: ${path}`,
        }
      }
    }

    // Check for tracking parameters
    for (const param of TRACKING_PARAMS) {
      if (parsed.searchParams.has(param)) {
        return {
          url,
          type: 'tracking_param',
          details: `Tracking-Parameter: ${param}`,
        }
      }
    }

    return null
  } catch {
    // Invalid URL, skip
    return null
  }
}

/**
 * Verify TipTap content for tracking URLs
 * Call this before saving a blog post
 */
export function verifyContentUrls(content: JSONContent | string): VerificationResult {
  // Parse if string
  const parsed: JSONContent = typeof content === 'string'
    ? JSON.parse(content)
    : content

  const urls = extractUrls(parsed)
  const issues: UrlIssue[] = []

  for (const url of urls) {
    const issue = checkUrl(url)
    if (issue) {
      issues.push(issue)
    }
  }

  return {
    isClean: issues.length === 0,
    issues,
    urlCount: urls.length,
  }
}

/**
 * Format issues for display in alert/toast
 */
export function formatIssuesForDisplay(issues: UrlIssue[]): string {
  if (issues.length === 0) return ''

  const lines = issues.slice(0, 5).map(issue =>
    `• ${issue.details}\n  ${issue.url.slice(0, 60)}${issue.url.length > 60 ? '...' : ''}`
  )

  if (issues.length > 5) {
    lines.push(`... und ${issues.length - 5} weitere`)
  }

  return `Tracking-URLs gefunden:\n\n${lines.join('\n\n')}`
}

/**
 * Sanitize TipTap content by removing or cleaning tracking URLs
 * - Redirect domains: remove the link mark entirely (keep the text)
 * - Tracking params: strip the params from the URL
 * - Tracking paths: remove the link mark entirely (keep the text)
 * Returns the cleaned content and a list of what was changed
 */
export function sanitizeTiptapUrls(content: JSONContent | string): {
  content: JSONContent
  changes: string[]
} {
  const parsed: JSONContent = typeof content === 'string'
    ? JSON.parse(content)
    : JSON.parse(JSON.stringify(content)) // deep clone

  const changes: string[] = []

  function sanitizeNode(node: JSONContent): void {
    // Clean link marks on text nodes
    if (node.marks) {
      node.marks = node.marks.filter(mark => {
        if (mark.type !== 'link' || !mark.attrs?.href) return true

        const url = mark.attrs.href as string
        const issue = checkUrl(url)
        if (!issue) return true // clean URL, keep it

        if (issue.type === 'redirect_domain' || issue.type === 'tracking_path') {
          // Remove the entire link (keep the text)
          changes.push(`Entfernt: ${url.slice(0, 80)}`)
          return false // filter out this mark
        }

        if (issue.type === 'tracking_param') {
          // Strip tracking params but keep the link
          try {
            const parsed = new URL(url)
            for (const param of TRACKING_PARAMS) {
              if (parsed.searchParams.has(param)) {
                parsed.searchParams.delete(param)
              }
            }
            // Also strip utm_ and other prefixed params
            const toDelete: string[] = []
            parsed.searchParams.forEach((_, key) => {
              const k = key.toLowerCase()
              if (k.startsWith('utm_') || k.startsWith('mc_') || k.startsWith('fb_') || k.startsWith('__')) {
                toDelete.push(key)
              }
            })
            for (const key of toDelete) parsed.searchParams.delete(key)

            mark.attrs.href = parsed.toString()
            changes.push(`Bereinigt: ${url.slice(0, 60)} → ${mark.attrs.href.slice(0, 60)}`)
          } catch {
            // Can't parse, remove the link
            changes.push(`Entfernt (parse error): ${url.slice(0, 80)}`)
            return false
          }
        }

        return true
      })
    }

    // Recurse into children
    if (node.content) {
      for (const child of node.content) {
        sanitizeNode(child)
      }
    }
  }

  sanitizeNode(parsed)
  return { content: parsed, changes }
}
