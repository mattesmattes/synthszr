import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('generated_posts')
      .select(`
        *,
        digest:daily_digests(id, digest_date, analysis_content, word_count),
        prompt:ghostwriter_prompts(name)
      `)
      .order('created_at', { ascending: false })

    // For each post with a digest, fetch the source items from daily_repo
    if (data) {
      for (const post of data) {
        if (post.digest?.id) {
          const { data: sources } = await supabase
            .from('daily_repo')
            .select('id, title, source_url, source_email, source_type, collected_at')
            .eq('newsletter_date', post.digest.digest_date)
            .order('collected_at', { ascending: true })

          if (sources) {
            post.digest.sources = sources
          }
        }
      }
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, title, slug, excerpt, category, content, status } = body

    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 })
    }

    const supabase = await createClient()

    const updateData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title
    if (slug !== undefined) updateData.slug = slug
    if (excerpt !== undefined) updateData.excerpt = excerpt
    if (category !== undefined) updateData.category = category
    if (content !== undefined) {
      // Stringify content for TEXT column (not JSONB)
      updateData.content = typeof content === 'string' ? content : JSON.stringify(content)
      // Extract text from TipTap JSON to count words
      const extractText = (node: Record<string, unknown>): string => {
        if (node.text) return node.text as string
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join(' ')
        }
        return ''
      }
      const contentObj = typeof content === 'string' ? JSON.parse(content) : content
      const text = extractText(contentObj)
      updateData.word_count = text.split(/\s+/).filter(Boolean).length
    }
    if (status !== undefined) updateData.status = status

    const { data, error } = await supabase
      .from('generated_posts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 })
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('generated_posts')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}
