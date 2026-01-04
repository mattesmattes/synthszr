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

    // Remove any "Quellen" section that was added previously
    const quellenIndex = content.content.findIndex(node =>
      node.type === 'heading' &&
      node.content?.[0]?.text === 'Quellen'
    )
    if (quellenIndex > -1) {
      // Remove Quellen heading and all following paragraphs with → links
      let removeCount = 1
      for (let i = quellenIndex + 1; i < content.content.length; i++) {
        const node = content.content[i]
        if (node.type === 'paragraph' && node.content?.[0]?.text === '→ ') {
          removeCount++
        } else {
          break
        }
      }
      content.content.splice(quellenIndex, removeCount)
      modified = true
      console.log(`  Removed Quellen section from: ${post.title.slice(0, 40)}`)
    }

    // Now ensure each paragraph with a link has the → prefix
    content.content.forEach((node) => {
      if (node.type === 'paragraph' && node.content && node.content.length >= 2) {
        const lastItem = node.content[node.content.length - 1]
        const secondLastItem = node.content[node.content.length - 2]

        // Check if last item is a link
        if (lastItem.marks?.some(m => m.type === 'link')) {
          const prevText = secondLastItem?.text || ''

          // Add → if not already there
          if (!prevText.endsWith('→ ') && !prevText.endsWith('→')) {
            if (secondLastItem && secondLastItem.text) {
              secondLastItem.text = secondLastItem.text.trimEnd() + ' → '
              modified = true
            }
          }
        }
      }
    })

    if (modified) {
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
