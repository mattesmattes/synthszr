/**
 * Force resolve remaining redirect URLs with more aggressive following
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { sanitizeUrl, isTrackingRedirectUrl } from '../lib/utils/url-sanitizer'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const resolvedCache = new Map<string, string | null>()

/**
 * Aggressively follow redirects up to N hops
 */
async function resolveWithRetries(url: string, maxHops = 5): Promise<string | null> {
  if (resolvedCache.has(url)) {
    return resolvedCache.get(url) || null
  }

  let currentUrl = url
  let hops = 0

  while (hops < maxHops) {
    try {
      console.log(`    [hop ${hops + 1}] Fetching: ${currentUrl.slice(0, 60)}...`)

      const response = await fetch(currentUrl, {
        method: 'GET',  // Use GET instead of HEAD - some services don't support HEAD
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      console.log(`    [hop ${hops + 1}] Status: ${response.status}`)

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location) {
          // Handle relative URLs
          const nextUrl = location.startsWith('http')
            ? location
            : new URL(location, currentUrl).toString()

          console.log(`    [hop ${hops + 1}] Redirect to: ${nextUrl.slice(0, 60)}...`)

          // If we've reached a non-tracking URL, we're done
          if (!isTrackingRedirectUrl(nextUrl)) {
            const cleaned = sanitizeUrl(nextUrl)
            resolvedCache.set(url, cleaned)
            return cleaned
          }

          currentUrl = nextUrl
          hops++
          continue
        }
      }

      // If we get a 200 OK, the page didn't redirect - check if we're on a tracking domain
      if (response.ok) {
        if (!isTrackingRedirectUrl(currentUrl)) {
          const cleaned = sanitizeUrl(currentUrl)
          resolvedCache.set(url, cleaned)
          return cleaned
        }
        // Still on tracking domain with 200 - can't extract destination
        console.log(`    [hop ${hops + 1}] 200 OK on tracking domain - no redirect available`)
        break
      }

      // Non-redirect, non-OK response
      console.log(`    [hop ${hops + 1}] Unexpected status ${response.status}`)
      break

    } catch (error) {
      console.log(`    [hop ${hops + 1}] Error:`, error instanceof Error ? error.message : 'unknown')
      break
    }
  }

  resolvedCache.set(url, null)
  return null
}

async function resolveTipTapRedirects(node: unknown): Promise<{ node: unknown; modified: boolean; urlsFixed: number }> {
  let modified = false
  let urlsFixed = 0

  if (!node || typeof node !== 'object') {
    return { node, modified, urlsFixed }
  }

  if (Array.isArray(node)) {
    const results = await Promise.all(node.map(item => resolveTipTapRedirects(item)))
    return {
      node: results.map(r => r.node),
      modified: results.some(r => r.modified),
      urlsFixed: results.reduce((sum, r) => sum + r.urlsFixed, 0)
    }
  }

  const obj = node as Record<string, unknown>
  const newObj: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'attrs' && typeof value === 'object' && value !== null) {
      const attrs = value as Record<string, unknown>
      const newAttrs: Record<string, unknown> = { ...attrs }

      if (typeof attrs.href === 'string' && isTrackingRedirectUrl(attrs.href)) {
        console.log(`  Attempting: ${attrs.href.slice(0, 60)}...`)
        const resolved = await resolveWithRetries(attrs.href)
        if (resolved) {
          newAttrs.href = resolved
          modified = true
          urlsFixed++
          console.log(`  ✓ Resolved to: ${resolved.slice(0, 60)}`)
        } else {
          console.log(`  ✗ Could not resolve`)
        }
      }

      newObj[key] = newAttrs
    } else if (typeof value === 'object' && value !== null) {
      const result = await resolveTipTapRedirects(value)
      newObj[key] = result.node
      if (result.modified) modified = true
      urlsFixed += result.urlsFixed
    } else {
      newObj[key] = value
    }
  }

  return { node: newObj, modified, urlsFixed }
}

async function main() {
  console.log('=== Force Resolving Remaining Redirect URLs ===\n')

  const REDIRECT_DOMAINS = ['link.mail.beehiiv.com', 'e.customeriomail.com']

  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, content, status')
    .eq('status', 'published')
    .gte('created_at', '2025-12-29')

  let postsModified = 0
  let totalUrlsFixed = 0

  for (const post of posts || []) {
    if (!post.content) continue

    const contentStr = typeof post.content === 'string'
      ? post.content
      : JSON.stringify(post.content)

    const hasRedirects = REDIRECT_DOMAINS.some(d => contentStr.includes(d))
    if (!hasRedirects) continue

    console.log(`\nProcessing: ${post.title?.slice(0, 50)}...`)

    let contentObj = typeof post.content === 'string'
      ? JSON.parse(post.content)
      : post.content

    const result = await resolveTipTapRedirects(contentObj)

    if (result.modified) {
      const newContent = typeof post.content === 'string'
        ? JSON.stringify(result.node)
        : result.node

      const { error } = await supabase
        .from('generated_posts')
        .update({ content: newContent })
        .eq('id', post.id)

      if (!error) {
        postsModified++
        totalUrlsFixed += result.urlsFixed
      }
    }

    await new Promise(r => setTimeout(r, 1000))
  }

  console.log('\n=== Summary ===')
  console.log(`Posts modified: ${postsModified}`)
  console.log(`URLs resolved: ${totalUrlsFixed}`)
}

main()
