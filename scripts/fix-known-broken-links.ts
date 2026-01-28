/**
 * Fix known broken newsletter source links
 * Replace expired Beehiiv tracking links with actual newsletter homepages
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Map known newsletter names to their homepages
const NEWSLETTER_HOMEPAGE_MAP: Record<string, string> = {
  'TAAFT - There\'s An AI For That': 'https://theresanaiforthat.com/',
  'Superhuman – Zain Kahn': 'https://www.superhuman.ai/',
  'Superhuman': 'https://www.superhuman.ai/',
  'The Information': 'https://www.theinformation.com/',
  'The Neuron': 'https://www.theneurondaily.com/',
  'AI Mini Vegas Sphere for Your Desk': 'https://theresanaiforthat.com/', // This is from TAAFT
}

function fixBrokenLinksInNode(node: unknown): { node: unknown; modified: boolean; fixed: number } {
  let modified = false
  let fixed = 0

  if (!node || typeof node !== 'object') {
    return { node, modified, fixed }
  }

  if (Array.isArray(node)) {
    const results = node.map(item => fixBrokenLinksInNode(item))
    return {
      node: results.map(r => r.node),
      modified: results.some(r => r.modified),
      fixed: results.reduce((sum, r) => sum + r.fixed, 0)
    }
  }

  const obj = node as Record<string, unknown>
  const newObj: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Check if this is a text node with marks
    if (key === 'marks' && Array.isArray(value)) {
      const text = obj.text as string | undefined

      const newMarks = value.map((mark: Record<string, unknown>) => {
        if (mark.type === 'link' && mark.attrs) {
          const attrs = mark.attrs as Record<string, unknown>
          const href = attrs.href as string | undefined

          // Check if this is a broken tracking link
          if (href && (href.includes('link.mail.beehiiv.com') || href.includes('e.customeriomail.com'))) {
            // Try to find a replacement based on the text
            if (text) {
              for (const [pattern, replacement] of Object.entries(NEWSLETTER_HOMEPAGE_MAP)) {
                if (text.includes(pattern) || text === pattern) {
                  console.log(`  Fixing: "${text}" → ${replacement}`)
                  modified = true
                  fixed++
                  return {
                    ...mark,
                    attrs: { ...attrs, href: replacement }
                  }
                }
              }
            }
            console.log(`  WARNING: No replacement found for: "${text}" (${href.slice(0, 50)}...)`)
          }
        }
        return mark
      })

      newObj[key] = newMarks
    } else if (typeof value === 'object' && value !== null) {
      const result = fixBrokenLinksInNode(value)
      newObj[key] = result.node
      if (result.modified) modified = true
      fixed += result.fixed
    } else {
      newObj[key] = value
    }
  }

  return { node: newObj, modified, fixed }
}

async function main() {
  console.log('=== Fixing Known Broken Newsletter Links ===\n')

  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, content')
    
    

  let postsModified = 0
  let totalFixed = 0

  for (const post of posts || []) {
    const contentStr = JSON.stringify(post.content)
    if (!contentStr.includes('link.mail.beehiiv.com') && !contentStr.includes('e.customeriomail.com')) continue

    console.log(`Processing: ${post.title?.slice(0, 50)}...`)

    const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    const result = fixBrokenLinksInNode(content)

    if (result.modified) {
      const newContent = typeof post.content === 'string'
        ? JSON.stringify(result.node)
        : result.node

      const { error } = await supabase
        .from('generated_posts')
        .update({ content: newContent })
        .eq('id', post.id)

      if (!error) {
        console.log(`  ✓ Fixed ${result.fixed} links`)
        postsModified++
        totalFixed += result.fixed
      } else {
        console.log(`  ✗ Error updating: ${error.message}`)
      }
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Posts modified: ${postsModified}`)
  console.log(`Links fixed: ${totalFixed}`)
}

main()
