import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAvailableModels } from '@/lib/i18n/translation-service'

/**
 * GET /api/admin/languages
 * Returns all languages with their configuration
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: languages, error } = await supabase
      .from('languages')
      .select('*')
      .order('is_default', { ascending: false })
      .order('is_active', { ascending: false })
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch languages' }, { status: 500 })
    }

    // Get available models based on API keys
    const availableModels = getAvailableModels()

    return NextResponse.json({
      languages,
      availableModels,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/languages
 * Updates a language's configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, is_active, llm_model, backfill_from_date } = body

    if (!code) {
      return NextResponse.json({ error: 'Language code is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Build update object
    const updates: Record<string, unknown> = {}

    if (typeof is_active === 'boolean') {
      updates.is_active = is_active
    }

    if (llm_model !== undefined) {
      updates.llm_model = llm_model || null
    }

    if (backfill_from_date !== undefined) {
      updates.backfill_from_date = backfill_from_date || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('languages')
      .update(updates)
      .eq('code', code)
      .select()
      .single()

    if (error) {
      console.error('[Languages] Update error:', error)
      return NextResponse.json({ error: 'Failed to update language' }, { status: 500 })
    }

    return NextResponse.json({ language: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/languages/backfill
 * Triggers backfill translations for a language (posts + static pages)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, from_date } = body

    if (!code) {
      return NextResponse.json({ error: 'Language code is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const queueEntries: Array<{
      content_type: string
      content_id: string
      target_language: string
      priority: number
      status: string
    }> = []

    // ========== POSTS ==========
    let query = supabase
      .from('generated_posts')
      .select('id')
      .eq('status', 'published')

    if (from_date) {
      query = query.gte('created_at', from_date)
    }

    const { data: posts } = await query

    // Get existing post translations to skip completed and manually edited ones
    const { data: existingPostTranslations } = await supabase
      .from('content_translations')
      .select('generated_post_id, is_manually_edited, translation_status')
      .eq('language_code', code)
      .not('generated_post_id', 'is', null)

    // Skip posts that are already translated (completed) or manually edited
    const skipPostIds = new Set(
      existingPostTranslations
        ?.filter(t => t.is_manually_edited || t.translation_status === 'completed')
        .map(t => t.generated_post_id) || []
    )

    // Add posts to queue (only those not yet translated)
    const postsToTranslate = (posts || []).filter(p => !skipPostIds.has(p.id))
    for (const post of postsToTranslate) {
      queueEntries.push({
        content_type: 'generated_post',
        content_id: post.id,
        target_language: code,
        priority: 1,
        status: 'pending',
      })
    }

    // ========== STATIC PAGES ==========
    const { data: staticPages } = await supabase
      .from('static_pages')
      .select('id')

    // Get existing static page translations to skip completed and manually edited ones
    const { data: existingPageTranslations } = await supabase
      .from('content_translations')
      .select('static_page_id, is_manually_edited, translation_status')
      .eq('language_code', code)
      .not('static_page_id', 'is', null)

    // Skip pages that are already translated (completed) or manually edited
    const skipPageIds = new Set(
      existingPageTranslations
        ?.filter(t => t.is_manually_edited || t.translation_status === 'completed')
        .map(t => t.static_page_id) || []
    )

    // Add static pages to queue (only those not yet translated, higher priority)
    const pagesToTranslate = (staticPages || []).filter(p => !skipPageIds.has(p.id))
    for (const page of pagesToTranslate) {
      queueEntries.push({
        content_type: 'static_page',
        content_id: page.id,
        target_language: code,
        priority: 5, // Higher priority for static pages
        status: 'pending',
      })
    }

    if (queueEntries.length === 0) {
      return NextResponse.json({
        message: 'Nothing to backfill',
        queued: 0,
        skippedPosts: skipPostIds.size,
        skippedPages: skipPageIds.size,
      })
    }

    // Insert in batches of 100
    const batchSize = 100
    let totalQueued = 0

    for (let i = 0; i < queueEntries.length; i += batchSize) {
      const batch = queueEntries.slice(i, i + batchSize)
      const { error: insertError } = await supabase
        .from('translation_queue')
        .insert(batch)

      if (!insertError) {
        totalQueued += batch.length
      }
    }

    console.log(`[Backfill] Queued ${totalQueued} translations for language ${code} (${postsToTranslate.length} posts, ${pagesToTranslate.length} pages)`)

    return NextResponse.json({
      message: `Queued ${postsToTranslate.length} posts and ${pagesToTranslate.length} static pages for translation`,
      queued: totalQueued,
      posts: postsToTranslate.length,
      pages: pagesToTranslate.length,
      skippedPosts: skipPostIds.size,
      skippedPages: skipPageIds.size,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
