import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Source link patterns to detect (names of publications)
const SOURCE_PATTERNS = [
  'Exponential View', 'Tech Brew', 'The Electric', 'How I AI', 'The Algorithmic Bridge',
  'The Verge', 'TechCrunch', 'Wired', 'Ars Technica', 'MIT Technology Review',
  'Bloomberg', 'Reuters', 'Financial Times', 'Wall Street Journal', 'New York Times',
  'Stratechery', 'Benedict Evans', 'Ben Thompson', 'a]16z', 'Andreessen Horowitz',
  'Hacker News', 'Slashdot', 'The Information', 'Protocol', 'The Register',
  'ZDNet', 'CNET', 'Engadget', 'Gizmodo', 'Mashable', 'VentureBeat', 'SiliconAngle',
  'Medium', 'Substack', 'LinkedIn', 'Twitter', 'X.com',
  // Add newsletter names
  '.substack.com', '.beehiiv.com', '.ghost.io'
]

function isSourceLink(text, url) {
  // Check if this looks like a source attribution link
  if (!text || !url) return false

  // Check common patterns
  const lowerText = text.toLowerCase()

  // If it's a very short text at end of paragraph, likely a source
  if (text.length < 50) {
    // Check if URL is external
    if (url.startsWith('http')) {
      return true
    }
  }

  return false
}

async function fixPosts() {
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, content')
    .eq('status', 'published')

  if (error) {
    console.error('Error fetching posts:', error)
    return
  }

  console.log(`Found ${posts.length} published posts\n`)

  let fixedCount = 0

  for (const post of posts) {
    const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    if (!content?.content) continue

    let modified = false

    // Process each node
    content.content.forEach((node) => {
      if (node.type === 'paragraph' && node.content && node.content.length >= 2) {
        // Check if last item is a link
        const lastItem = node.content[node.content.length - 1]
        const secondLastItem = node.content[node.content.length - 2]

        if (lastItem.marks?.some(m => m.type === 'link')) {
          const linkUrl = lastItem.marks.find(m => m.type === 'link')?.attrs?.href

          // Check if there's already an arrow before the link
          const prevText = secondLastItem?.text || ''
          if (!prevText.endsWith('→ ') && !prevText.endsWith('→') && isSourceLink(lastItem.text, linkUrl)) {
            // Add arrow before the link
            if (secondLastItem && secondLastItem.text) {
              // Add space and arrow to previous text
              secondLastItem.text = secondLastItem.text.trimEnd() + ' → '
              modified = true
            } else {
              // Insert a new text node with arrow
              node.content.splice(node.content.length - 1, 0, {
                type: 'text',
                text: '→ '
              })
              modified = true
            }
          }
        }
      }
    })

    if (modified) {
      // Update the post
      const { error: updateError } = await supabase
        .from('generated_posts')
        .update({ content })
        .eq('id', post.id)

      if (updateError) {
        console.error(`Error updating ${post.title}:`, updateError)
      } else {
        console.log(`✓ Fixed: ${post.title.slice(0, 50)}`)
        fixedCount++
      }
    }
  }

  console.log(`\nFixed ${fixedCount} posts`)
}

fixPosts()
