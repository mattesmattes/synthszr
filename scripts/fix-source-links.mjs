import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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
    const collectedLinks = []

    // Process each node - collect links and remove from paragraphs
    content.content.forEach((node) => {
      if (node.type === 'paragraph' && node.content && node.content.length >= 1) {
        // Find link items at the end of paragraph
        const newContent = []

        for (let i = 0; i < node.content.length; i++) {
          const item = node.content[i]
          const isLink = item.marks?.some(m => m.type === 'link')

          if (isLink) {
            const linkMark = item.marks.find(m => m.type === 'link')
            const url = linkMark?.attrs?.href
            const text = item.text

            // Collect the link
            if (url && text && !text.includes('Synthszr Take') && !text.includes('Mattes')) {
              collectedLinks.push({ text, url })
              modified = true

              // Remove trailing " → " from previous text item
              if (newContent.length > 0) {
                const lastItem = newContent[newContent.length - 1]
                if (lastItem.text && lastItem.text.endsWith(' → ')) {
                  lastItem.text = lastItem.text.slice(0, -3).trimEnd()
                }
              }
              continue // Skip adding this link
            }
          }

          newContent.push(item)
        }

        node.content = newContent
      }
    })

    // Add links section at the end if we collected any
    if (collectedLinks.length > 0) {
      // Remove duplicates
      const uniqueLinks = []
      const seen = new Set()
      for (const link of collectedLinks) {
        const key = link.url
        if (!seen.has(key)) {
          seen.add(key)
          uniqueLinks.push(link)
        }
      }

      // Add a divider heading
      content.content.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Quellen' }]
      })

      // Add each link as a paragraph
      for (const link of uniqueLinks) {
        content.content.push({
          type: 'paragraph',
          content: [
            { type: 'text', text: '→ ' },
            {
              type: 'text',
              text: link.text,
              marks: [{
                type: 'link',
                attrs: {
                  href: link.url,
                  target: '_blank',
                  rel: 'noopener noreferrer nofollow',
                  class: null
                }
              }]
            }
          ]
        })
      }
    }

    if (modified) {
      // Update the post
      const { error: updateError } = await supabase
        .from('generated_posts')
        .update({ content })
        .eq('id', post.id)

      if (updateError) {
        console.error(`Error updating ${post.title}:`, updateError)
      } else {
        console.log(`✓ Fixed: ${post.title.slice(0, 50)} (${collectedLinks.length} links moved)`)
        fixedCount++
      }
    }
  }

  console.log(`\nFixed ${fixedCount} posts`)
}

fixPosts()
