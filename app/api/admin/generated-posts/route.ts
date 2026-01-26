import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { pregenerateStockSynthszr } from '@/lib/stock-synthszr/pregenerate'
import { syncPostCompanyMentions } from '@/lib/companies/sync'
import { queueTranslations } from '@/lib/translations/queue'
import { parseTipTapContent } from '@/lib/utils/safe-json'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
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
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
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
      const contentObj = parseTipTapContent(content)
      const text = extractText(contentObj)
      updateData.word_count = text.split(/\s+/).filter(Boolean).length
    }
    if (status !== undefined) updateData.status = status

    // Check if we're publishing (need to know previous status)
    let wasPublished = false
    if (status === 'published') {
      const { data: currentPost } = await supabase
        .from('generated_posts')
        .select('status, content')
        .eq('id', id)
        .single()
      wasPublished = currentPost?.status === 'published'
    }

    const { data, error } = await supabase
      .from('generated_posts')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Pre-generate Stock-Synthszr when publishing (async, don't block response)
    // This requires content - if not in request, use the content already in DB
    if (status === 'published' && !wasPublished) {
      // Get content for stock-synthszr: from request or from DB (fetched earlier for wasPublished check)
      const contentForProcessing = content || (await supabase
        .from('generated_posts')
        .select('content')
        .eq('id', id)
        .single()
        .then(r => r.data?.content))

      if (contentForProcessing) {
        const contentToProcess = typeof contentForProcessing === 'string' ? contentForProcessing : JSON.stringify(contentForProcessing)
        pregenerateStockSynthszr(contentToProcess)
          .then((result) => {
            console.log(`[stock-synthszr] Pre-generation complete: ${result.generated} generated, ${result.skipped} cached, ${result.errors} errors`)
          })
          .catch((err) => {
            console.error('[stock-synthszr] Pre-generation failed:', err)
          })
      }

      // Queue translations for all active languages (async, don't block response)
      // This does NOT require content - it just needs the post ID
      queueTranslations('generated_post', id, 10)
        .then((result) => {
          if (result.error) {
            console.error(`[translations] Failed to queue translations for post ${id}: ${result.error}`)
          } else {
            console.log(`[translations] Queued ${result.queued} translations for post ${id}: ${result.languages.join(', ')}`)
          }
        })
        .catch((err) => {
          console.error('[translations] Unexpected error queuing translations:', err)
        })
    }

    // Sync company mentions to post_company_mentions table (async, don't block response)
    if (content) {
      // Fetch queue item IDs for article-level tracking, then sync
      ;(async () => {
        try {
          const { data: postData } = await supabase
            .from('generated_posts')
            .select('pending_queue_item_ids')
            .eq('id', id)
            .single()
          const queueItemIds = postData?.pending_queue_item_ids as string[] | undefined
          const result = await syncPostCompanyMentions(id, content, queueItemIds)
          console.log(`[sync-companies] Synced ${result.companiesFound} companies in ${result.articlesWithCompanies} articles for post ${id}`)
        } catch (err) {
          console.error('[sync-companies] Sync failed:', err)
        }
      })()
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
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
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
