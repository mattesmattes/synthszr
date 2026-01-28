/**
 * One-time migration script to sanitize existing URLs in the database
 * Removes tracking parameters from source_url in daily_repo table
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { sanitizeUrl, isTrackingRedirectUrl } from '../lib/utils/url-sanitizer'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function sanitizeExistingUrls() {
  console.log('=== URL Sanitization Migration ===\n')

  // Get all items with source_url
  const { data: items, error } = await supabase
    .from('daily_repo')
    .select('id, source_url, title')
    .not('source_url', 'is', null)

  if (error) {
    console.error('Error fetching items:', error)
    return
  }

  console.log(`Found ${items?.length || 0} items with source_url\n`)

  let sanitized = 0
  let blocked = 0
  let unchanged = 0
  let failed = 0

  for (const item of items || []) {
    if (!item.source_url) {
      unchanged++
      continue
    }

    // Check if it's a tracking redirect URL
    if (isTrackingRedirectUrl(item.source_url)) {
      console.log(`BLOCKED (tracking redirect): ${item.source_url.slice(0, 60)}...`)
      console.log(`  Title: ${item.title?.slice(0, 50)}...`)

      // Set to null since we can't safely use this URL
      const { error: updateError } = await supabase
        .from('daily_repo')
        .update({ source_url: null })
        .eq('id', item.id)

      if (updateError) {
        console.error(`  Failed to update: ${updateError.message}`)
        failed++
      } else {
        blocked++
      }
      continue
    }

    // Sanitize the URL
    const cleanUrl = sanitizeUrl(item.source_url)

    if (cleanUrl !== item.source_url) {
      console.log(`SANITIZED: ${item.source_url.slice(0, 60)}...`)
      console.log(`  → ${cleanUrl?.slice(0, 60)}...`)

      const { error: updateError } = await supabase
        .from('daily_repo')
        .update({ source_url: cleanUrl })
        .eq('id', item.id)

      if (updateError) {
        console.error(`  Failed to update: ${updateError.message}`)
        failed++
      } else {
        sanitized++
      }
    } else {
      unchanged++
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Sanitized: ${sanitized}`)
  console.log(`Blocked (tracking redirects set to null): ${blocked}`)
  console.log(`Unchanged: ${unchanged}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${(items?.length || 0)}`)
}

sanitizeExistingUrls()
