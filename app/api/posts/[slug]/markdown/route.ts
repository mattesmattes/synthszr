import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePostMarkdown } from '@/lib/utils/tiptap-to-markdown'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * GET /api/posts/[slug]/markdown
 * Returns the post content as Markdown with YAML frontmatter
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const supabase = await createClient()

  // Try generated_posts first (most common)
  let { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, slug, excerpt, content, category, created_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  // Try manual posts if not found
  if (!post) {
    const { data: manualPost } = await supabase
      .from('posts')
      .select('id, title, slug, excerpt, content, category, created_at')
      .eq('slug', slug)
      .eq('published', true)
      .single()

    if (manualPost) {
      post = manualPost
    }
  }

  if (!post) {
    return NextResponse.json(
      { error: 'Post not found' },
      { status: 404 }
    )
  }

  const markdown = generatePostMarkdown({
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    category: post.category,
    created_at: post.created_at,
    content: post.content,
  })

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${post.slug}.md"`,
    },
  })
}
