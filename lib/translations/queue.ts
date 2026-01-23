import { createClient } from '@/lib/supabase/server'

interface QueueTranslationsResult {
  queued: number
  skipped: number
  languages: string[]
  error?: string
}

/**
 * Queue translations for a content item (post or static page)
 *
 * This function directly inserts into the translation_queue table
 * instead of using fetch, making it more reliable.
 *
 * @param contentType - 'generated_post' or 'static_page'
 * @param contentId - UUID of the content
 * @param priority - Queue priority (default: 0, higher = more important)
 * @param force - If true, queue even if translations already exist (re-translate)
 */
export async function queueTranslations(
  contentType: 'generated_post' | 'static_page',
  contentId: string,
  priority: number = 0,
  force: boolean = false
): Promise<QueueTranslationsResult> {
  try {
    const supabase = await createClient()

    // Get all active languages (except default)
    const { data: languages, error: langError } = await supabase
      .from('languages')
      .select('code')
      .eq('is_active', true)
      .eq('is_default', false)

    if (langError) {
      console.error('[queueTranslations] Error fetching languages:', langError)
      return { queued: 0, skipped: 0, languages: [], error: 'Failed to fetch languages' }
    }

    if (!languages || languages.length === 0) {
      console.log('[queueTranslations] No active non-default languages')
      return { queued: 0, skipped: 0, languages: [] }
    }

    // Check which languages already have manually edited translations (skip these)
    const contentIdColumn = contentType === 'generated_post' ? 'generated_post_id' : 'static_page_id'
    const { data: existingTranslations } = await supabase
      .from('content_translations')
      .select('language_code, is_manually_edited')
      .eq(contentIdColumn, contentId)

    const manuallyEditedLanguages = new Set(
      existingTranslations
        ?.filter(t => t.is_manually_edited)
        .map(t => t.language_code) || []
    )

    // Filter out languages with manually edited translations (unless force=true)
    const languagesToQueue = force
      ? languages
      : languages.filter(lang => !manuallyEditedLanguages.has(lang.code))

    if (languagesToQueue.length === 0) {
      console.log('[queueTranslations] All translations are manually edited, none queued')
      return { queued: 0, skipped: languages.length, languages: [] }
    }

    // Cancel any existing pending/processing items for this content
    const { error: cancelError } = await supabase
      .from('translation_queue')
      .update({ status: 'cancelled' })
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .in('status', ['pending', 'processing'])

    if (cancelError) {
      console.warn('[queueTranslations] Warning: Failed to cancel existing items:', cancelError)
    }

    // Create queue entries for each language
    const queueEntries = languagesToQueue.map(lang => ({
      content_type: contentType,
      content_id: contentId,
      target_language: lang.code,
      priority,
      status: 'pending',
    }))

    const { error: insertError } = await supabase
      .from('translation_queue')
      .insert(queueEntries)

    if (insertError) {
      console.error('[queueTranslations] Error inserting queue items:', insertError)
      return { queued: 0, skipped: 0, languages: [], error: 'Failed to insert queue items' }
    }

    const queuedLanguages = languagesToQueue.map(l => l.code)
    console.log(`[queueTranslations] Queued ${queueEntries.length} translations for ${contentType} ${contentId}: ${queuedLanguages.join(', ')}`)

    return {
      queued: queueEntries.length,
      skipped: manuallyEditedLanguages.size,
      languages: queuedLanguages,
    }
  } catch (error) {
    console.error('[queueTranslations] Unexpected error:', error)
    return {
      queued: 0,
      skipped: 0,
      languages: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Check if a post has pending translations
 */
export async function hasPendingTranslations(contentId: string): Promise<boolean> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('translation_queue')
    .select('*', { count: 'exact', head: true })
    .eq('content_id', contentId)
    .in('status', ['pending', 'processing'])

  return (count || 0) > 0
}

/**
 * Get translation status for a post
 */
export async function getTranslationStatus(contentId: string): Promise<{
  pending: number
  completed: number
  failed: number
  languages: Array<{ code: string; status: string }>
}> {
  const supabase = await createClient()

  const { data: queueItems } = await supabase
    .from('translation_queue')
    .select('target_language, status')
    .eq('content_id', contentId)

  const result = {
    pending: 0,
    completed: 0,
    failed: 0,
    languages: [] as Array<{ code: string; status: string }>
  }

  queueItems?.forEach(item => {
    if (item.status === 'pending' || item.status === 'processing') result.pending++
    else if (item.status === 'completed') result.completed++
    else if (item.status === 'failed') result.failed++

    result.languages.push({ code: item.target_language, status: item.status })
  })

  return result
}
