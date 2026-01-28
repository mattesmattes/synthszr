/**
 * Sanitize URLs in published blog post content (TipTap JSON)
 * Finds and cleans tracking parameters from embedded URLs
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { sanitizeUrl, isTrackingRedirectUrl } from '../lib/utils/url-sanitizer'

/**
 * Extract destination URL from tracking redirect URLs
 * Many services encode the final destination in the path or query
 */
function extractDestinationFromRedirect(url: string): string | null {
  try {
    const parsed = new URL(url)

    // TLDR Newsletter: https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fexample.com%2Fpath
    if (parsed.hostname.includes('tldrnewsletter.com')) {
      // Path contains the encoded destination URL after /CL0/ or similar prefix
      const pathMatch = parsed.pathname.match(/\/CL\d+\/(.+)/)
      if (pathMatch) {
        const encodedDest = pathMatch[1]
        const decoded = decodeURIComponent(encodedDest)
        // Now sanitize the decoded destination URL
        return sanitizeUrl(decoded)
      }
    }

    // Beehiiv: sometimes has 'url' or 'redirect' param
    const redirectParam = parsed.searchParams.get('url') || parsed.searchParams.get('redirect')
    if (redirectParam) {
      return sanitizeUrl(redirectParam)
    }

    // Customer.io: Check for destination in path
    if (parsed.hostname.includes('customeriomail.com')) {
      // Often has structure like /e/xxxxx/https://...
      const pathParts = parsed.pathname.split('/')
      for (const part of pathParts) {
        if (part.startsWith('http')) {
          return sanitizeUrl(decodeURIComponent(part))
        }
      }
    }

    // Mailchimp/list-manage: Check for 'u' parameter with encoded URL
    if (parsed.hostname.includes('list-manage.com') || parsed.hostname.includes('mailchimp.com')) {
      const uParam = parsed.searchParams.get('u')
      if (uParam && uParam.startsWith('http')) {
        return sanitizeUrl(uParam)
      }
    }

    return null
  } catch {
    return null
  }
}

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Recursively process TipTap JSON to find and sanitize URLs
function sanitizeTipTapContent(node: unknown): { node: unknown; modified: boolean; urlsFixed: number } {
  let modified = false
  let urlsFixed = 0

  if (!node || typeof node !== 'object') {
    return { node, modified, urlsFixed }
  }

  // Handle arrays
  if (Array.isArray(node)) {
    const results = node.map(item => sanitizeTipTapContent(item))
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

      if (typeof attrs.href === 'string') {
        if (isTrackingRedirectUrl(attrs.href)) {
          // Try to extract destination URL from the redirect
          const extractedDest = extractDestinationFromRedirect(attrs.href)
          if (extractedDest) {
            newAttrs.href = extractedDest
            modified = true
            urlsFixed++
            console.log(`  Extracted: ${attrs.href.slice(0, 40)}... → ${extractedDest.slice(0, 50)}`)
          } else {
            console.log(`  WARNING: Could not extract dest from: ${attrs.href.slice(0, 60)}...`)
          }
        } else {
          const sanitized = sanitizeUrl(attrs.href)
          if (sanitized && sanitized !== attrs.href) {
            newAttrs.href = sanitized
            modified = true
            urlsFixed++
            console.log(`  Fixed: ${attrs.href.slice(0, 50)}... → ${sanitized.slice(0, 50)}...`)
          }
        }
      }

      newObj[key] = newAttrs
    }
    // Check for src attributes (images, embeds)
    else if (key === 'src' && typeof value === 'string' && value.startsWith('http')) {
      const sanitized = sanitizeUrl(value)
      if (sanitized && sanitized !== value) {
        newObj[key] = sanitized
        modified = true
        urlsFixed++
      } else {
        newObj[key] = value
      }
    }
    // Recursively process nested objects/arrays
    else if (typeof value === 'object' && value !== null) {
      const result = sanitizeTipTapContent(value)
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

async function sanitizePublishedPosts() {
  console.log('=== Sanitizing Published Posts ===\n')

  // Get all posts since 29.12.2025
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, content, status, created_at')
    .gte('created_at', '2025-12-29')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching posts:', error)
    return
  }

  console.log(`Found ${posts?.length || 0} posts since 29.12.2025\n`)

  let postsModified = 0
  let totalUrlsFixed = 0
  let postsFailed = 0

  for (const post of posts || []) {
    if (!post.content) continue

    // Content might be stored as JSON string or as object
    let contentObj: unknown
    let contentStr: string

    if (typeof post.content === 'string') {
      contentStr = post.content
      try {
        contentObj = JSON.parse(post.content)
      } catch {
        console.log(`  Skipping - invalid JSON: ${post.title?.slice(0, 40)}`)
        continue
      }
    } else {
      contentObj = post.content
      contentStr = JSON.stringify(post.content)
    }

    // Quick check if this post has any tracking params
    const hasTracking = contentStr.includes('_bhlid') ||
                        contentStr.includes('utm_source') ||
                        contentStr.includes('utm_medium') ||
                        contentStr.includes('fbclid') ||
                        contentStr.includes('mc_eid') ||
                        contentStr.includes('customeriomail.com') ||
                        contentStr.includes('mail.beehiiv.com')

    if (!hasTracking) continue

    console.log(`Processing: ${post.title?.slice(0, 50)}... (${post.status})`)

    try {
      const result = sanitizeTipTapContent(contentObj)

      if (result.modified) {
        // Save in the same format as it was stored (string or object)
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
          console.log(`  ✓ Fixed ${result.urlsFixed} URLs`)
          postsModified++
          totalUrlsFixed += result.urlsFixed
        }
      } else {
        console.log(`  No hrefs to fix (tracking might be in other places)`)
      }
    } catch (err) {
      console.error(`  Error processing post: ${err}`)
      postsFailed++
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Posts modified: ${postsModified}`)
  console.log(`Total URLs fixed: ${totalUrlsFixed}`)
  console.log(`Posts failed: ${postsFailed}`)
}

sanitizePublishedPosts()
