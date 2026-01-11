import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/translations/queue
 * Adds translation jobs to the queue for a given content item
 *
 * Body:
 * - content_type: 'generated_post' | 'static_page'
 * - content_id: UUID of the content
 * - priority?: number (default: 0, higher = more important)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { content_type, content_id, priority = 0 } = body

    if (!content_type || !content_id) {
      return NextResponse.json(
        { error: 'Missing required fields: content_type, content_id' },
        { status: 400 }
      )
    }

    if (!['generated_post', 'static_page'].includes(content_type)) {
      return NextResponse.json(
        { error: 'Invalid content_type' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Get all active languages (except default)
    const { data: languages, error: langError } = await supabase
      .from('languages')
      .select('code')
      .eq('is_active', true)
      .eq('is_default', false)

    if (langError) {
      console.error('[Queue] Error fetching languages:', langError)
      return NextResponse.json(
        { error: 'Failed to fetch active languages' },
        { status: 500 }
      )
    }

    if (!languages || languages.length === 0) {
      return NextResponse.json({
        message: 'No active non-default languages configured',
        queued: 0,
      })
    }

    // Check which languages already have manually edited translations
    const { data: existingTranslations } = await supabase
      .from('content_translations')
      .select('language_code, is_manually_edited')
      .eq(content_type === 'generated_post' ? 'generated_post_id' : 'static_page_id', content_id)

    const manuallyEditedLanguages = new Set(
      existingTranslations
        ?.filter(t => t.is_manually_edited)
        .map(t => t.language_code) || []
    )

    // Filter out languages with manually edited translations
    const languagesToQueue = languages.filter(
      lang => !manuallyEditedLanguages.has(lang.code)
    )

    if (languagesToQueue.length === 0) {
      return NextResponse.json({
        message: 'All translations are manually edited, none queued',
        queued: 0,
        skipped: languages.length,
      })
    }

    // Cancel any existing pending/processing items for this content
    await supabase
      .from('translation_queue')
      .update({ status: 'cancelled' })
      .eq('content_type', content_type)
      .eq('content_id', content_id)
      .in('status', ['pending', 'processing'])

    // Create queue entries for each language
    const queueEntries = languagesToQueue.map(lang => ({
      content_type,
      content_id,
      target_language: lang.code,
      priority,
      status: 'pending',
    }))

    const { error: insertError } = await supabase
      .from('translation_queue')
      .insert(queueEntries)

    if (insertError) {
      console.error('[Queue] Error inserting queue items:', insertError)
      return NextResponse.json(
        { error: 'Failed to add items to queue' },
        { status: 500 }
      )
    }

    console.log(`[Queue] Added ${queueEntries.length} translation jobs for ${content_type} ${content_id}`)

    return NextResponse.json({
      message: `Added ${queueEntries.length} translation jobs to queue`,
      queued: queueEntries.length,
      skipped: manuallyEditedLanguages.size,
      languages: languagesToQueue.map(l => l.code),
    })
  } catch (error) {
    console.error('[Queue] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/translations/queue
 * Clears pending queue items (for maintenance)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const contentId = searchParams.get('content_id')
    const status = searchParams.get('status') || 'pending'

    const supabase = await createClient()

    let query = supabase
      .from('translation_queue')
      .delete()
      .eq('status', status)

    if (contentId) {
      query = query.eq('content_id', contentId)
    }

    const { error } = await query

    if (error) {
      return NextResponse.json({ error: 'Failed to delete queue items' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Queue items deleted' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
