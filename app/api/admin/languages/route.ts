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
 * Triggers backfill translations for a language
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, from_date } = body

    if (!code) {
      return NextResponse.json({ error: 'Language code is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Get all published posts (optionally filtered by date)
    let query = supabase
      .from('generated_posts')
      .select('id')
      .eq('status', 'published')

    if (from_date) {
      query = query.gte('created_at', from_date)
    }

    const { data: posts, error: postsError } = await query

    if (postsError) {
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
    }

    if (!posts || posts.length === 0) {
      return NextResponse.json({
        message: 'No posts to backfill',
        queued: 0,
      })
    }

    // Get existing translations to skip manually edited ones
    const { data: existingTranslations } = await supabase
      .from('content_translations')
      .select('generated_post_id, is_manually_edited')
      .eq('language_code', code)

    const manuallyEditedIds = new Set(
      existingTranslations
        ?.filter(t => t.is_manually_edited)
        .map(t => t.generated_post_id) || []
    )

    // Filter out already manually edited
    const postsToTranslate = posts.filter(p => !manuallyEditedIds.has(p.id))

    if (postsToTranslate.length === 0) {
      return NextResponse.json({
        message: 'All posts already have manual translations',
        queued: 0,
        skipped: posts.length,
      })
    }

    // Create queue entries
    const queueEntries = postsToTranslate.map(post => ({
      content_type: 'generated_post',
      content_id: post.id,
      target_language: code,
      priority: 1, // Low priority for backfill
      status: 'pending',
    }))

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

    console.log(`[Backfill] Queued ${totalQueued} translations for language ${code}`)

    return NextResponse.json({
      message: `Queued ${totalQueued} posts for translation`,
      queued: totalQueued,
      skipped: manuallyEditedIds.size,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
