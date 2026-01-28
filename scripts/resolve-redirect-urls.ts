/**
 * Resolve encrypted redirect URLs by following HTTP redirects
 * This script fetches the actual destination URLs from tracking services
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { sanitizeUrl, isTrackingRedirectUrl } from '../lib/utils/url-sanitizer'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const REDIRECT_DOMAINS = [
  'link.mail.beehiiv.com',
  'e.customeriomail.com',
  'list-manage.com',
  'tracking.tldrnewsletter.com',
]

// Cache for resolved URLs to avoid duplicate requests
const resolvedUrlCache = new Map<string, string | null>()

/**
 * Follow redirects to get the final destination URL
 */
async function resolveRedirectUrl(url: string): Promise<string | null> {
  // Check cache first
  if (resolvedUrlCache.has(url)) {
    return resolvedUrlCache.get(url) || null
  }

  try {
    // Use fetch with redirect: 'manual' to capture the Location header
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; URLResolver/1.0)',
      },
    })

    let finalUrl: string | null = null

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) {
        // If the redirect is to another tracking URL, follow it
        if (isTrackingRedirectUrl(location)) {
          finalUrl = await resolveRedirectUrl(location)
        } else {
          finalUrl = location
        }
      }
    } else if (response.ok) {
      // No redirect, use the final URL
      finalUrl = response.url !== url ? response.url : null
    }

    // Sanitize the resolved URL
    if (finalUrl) {
      finalUrl = sanitizeUrl(finalUrl)
    }

    resolvedUrlCache.set(url, finalUrl)
    return finalUrl
  } catch (error) {
    console.error(`  Error resolving ${url.slice(0, 50)}:`, error instanceof Error ? error.message : 'unknown')
    resolvedUrlCache.set(url, null)
    return null
  }
}

// Recursively process TipTap JSON to find and resolve redirect URLs
async function resolveTipTapRedirects(node: unknown): Promise<{ node: unknown; modified: boolean; urlsFixed: number }> {
  let modified = false
  let urlsFixed = 0

  if (!node || typeof node !== 'object') {
    return { node, modified, urlsFixed }
  }

  // Handle arrays
  if (Array.isArray(node)) {
    const results = await Promise.all(node.map(item => resolveTipTapRedirects(item)))
    const newArray = results.map(r => r.node)
    const anyModified = results.some(r => r.modified)
    const totalFixed = results.reduce((sum, r) => sum + r.urlsFixed, 0)
    return { node: newArray, modified: anyModified, urlsFixed: totalFixed }
  }

  // Handle objects
  const obj = node as Record<string, unknown>
  const newObj: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Handle 'attrs' objects which contain href
    if (key === 'attrs' && typeof value === 'object' && value !== null) {
      const attrs = value as Record<string, unknown>
      const newAttrs: Record<string, unknown> = { ...attrs }

      if (typeof attrs.href === 'string' && isTrackingRedirectUrl(attrs.href)) {
        const resolved = await resolveRedirectUrl(attrs.href)
        if (resolved) {
          newAttrs.href = resolved
          modified = true
          urlsFixed++
          console.log(`  Resolved: ${attrs.href.slice(0, 40)}... → ${resolved.slice(0, 50)}`)
        } else {
          console.log(`  WARNING: Could not resolve: ${attrs.href.slice(0, 60)}...`)
        }
      }

      newObj[key] = newAttrs
    }
    // Recursively process nested objects/arrays
    else if (typeof value === 'object' && value !== null) {
      const result = await resolveTipTapRedirects(value)
      newObj[key] = result.node
      if (result.modified) modified = true
      urlsFixed += result.urlsFixed
    }
    else {
      newObj[key] = value
    }
  }

  return { node: newObj, modified, urlsFixed }
}

async function main() {
  console.log('=== Resolving Redirect URLs ===\n')

  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, content, status, created_at')
    .eq('status', 'published')
    .gte('created_at', '2025-12-29')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching posts:', error)
    return
  }

  console.log(`Found ${posts?.length || 0} published posts since 29.12.2025\n`)

  let postsModified = 0
  let totalUrlsFixed = 0
  let postsFailed = 0

  for (const post of posts || []) {
    if (!post.content) continue

    const contentStr = typeof post.content === 'string'
      ? post.content
      : JSON.stringify(post.content)

    // Quick check if this post has any redirect URLs
    const hasRedirects = REDIRECT_DOMAINS.some(d => contentStr.includes(d))
    if (!hasRedirects) continue

    console.log(`Processing: ${post.title?.slice(0, 50)}...`)

    let contentObj: unknown
    if (typeof post.content === 'string') {
      try {
        contentObj = JSON.parse(post.content)
      } catch {
        console.log(`  Skipping - invalid JSON`)
        continue
      }
    } else {
      contentObj = post.content
    }

    try {
      const result = await resolveTipTapRedirects(contentObj)

      if (result.modified) {
        const newContent = typeof post.content === 'string'
          ? JSON.stringify(result.node)
          : result.node

        const { error: updateError } = await supabase
          .from('generated_posts')
          .update({ content: newContent })
          .eq('id', post.id)

        if (updateError) {
          console.error(`  Failed to update: ${updateError.message}`)
          postsFailed++
        } else {
          console.log(`  ✓ Resolved ${result.urlsFixed} URLs`)
          postsModified++
          totalUrlsFixed += result.urlsFixed
        }
      } else {
        console.log(`  No redirect URLs resolved`)
      }
    } catch (err) {
      console.error(`  Error processing post: ${err}`)
      postsFailed++
    }

    // Small delay between posts to be nice to the redirect services
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log('\n=== Summary ===')
  console.log(`Posts modified: ${postsModified}`)
  console.log(`Total URLs resolved: ${totalUrlsFixed}`)
  console.log(`Posts failed: ${postsFailed}`)
}

main()
