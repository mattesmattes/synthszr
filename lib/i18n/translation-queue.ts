/**
 * Translation Queue Processor
 *
 * Core logic for processing pending translations.
 * Called directly from the cron scheduler (no HTTP subrequest needed)
 * and from the admin API route handler.
 */

import { translateContent, type TranslationModel } from '@/lib/i18n/translation-service'
import type { LanguageCode, TranslationQueueItem } from '@/lib/types'
import { parseTipTapContent } from '@/lib/utils/safe-json'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_ATTEMPTS = 3
const STUCK_TIMEOUT_MS = 6 * 60 * 1000

interface QueueResult {
  totalProcessed: number
  totalSuccess: number
  totalFailed: number
}

/**
 * Process pending translation queue items.
 * Can be called directly (no HTTP/auth needed).
 */
export async function processTranslationQueue(
  supabase: ReturnType<typeof createAdminClient>,
  options: { maxBatches?: number; batchSize?: number } = {}
): Promise<QueueResult> {
  const { maxBatches = 3, batchSize = 1 } = options

  let totalProcessed = 0
  let totalSuccess = 0
  let totalFailed = 0

  // Recover stuck items
  const stuckCutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString()
  const { data: stuckItems } = await supabase
    .from('translation_queue')
    .update({ status: 'pending', started_at: null })
    .eq('status', 'processing')
    .lt('started_at', stuckCutoff)
    .select('id')

  if (stuckItems && stuckItems.length > 0) {
    console.log(`[TranslationQueue] Recovered ${stuckItems.length} stuck items`)
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data: queueItems } = await supabase
      .from('translation_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', MAX_ATTEMPTS)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (!queueItems || queueItems.length === 0) break

    for (const item of queueItems as TranslationQueueItem[]) {
      totalProcessed++

      await supabase
        .from('translation_queue')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          attempts: item.attempts + 1,
        })
        .eq('id', item.id)

      try {
        const result = await processQueueItem(supabase, item)
        if (result.success) {
          totalSuccess++
        } else {
          totalFailed++
        }
      } catch (error) {
        totalFailed++
        const errorMsg = error instanceof Error ? error.message : String(error)
        await supabase
          .from('translation_queue')
          .update({
            status: item.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
            last_error: errorMsg,
          })
          .eq('id', item.id)
      }
    }
  }

  return { totalProcessed, totalSuccess, totalFailed }
}

interface ProcessResult {
  success: boolean
  skipped?: boolean
  error?: string
}

async function processQueueItem(
  supabase: ReturnType<typeof createAdminClient>,
  item: TranslationQueueItem
): Promise<ProcessResult> {
  const { data: language } = await supabase
    .from('languages')
    .select('llm_model')
    .eq('code', item.target_language)
    .single()

  const model = (language?.llm_model as TranslationModel) || 'gemini-2.0-flash'

  if (item.content_type === 'generated_post' && item.content_id) {
    return processGeneratedPost(supabase, item, model)
  } else if (item.content_type === 'static_page' && item.content_id) {
    return processStaticPage(supabase, item, model)
  }

  return { success: false, error: 'Invalid queue item' }
}

async function processGeneratedPost(
  supabase: ReturnType<typeof createAdminClient>,
  item: TranslationQueueItem,
  model: TranslationModel
): Promise<ProcessResult> {
  const { data: existing } = await supabase
    .from('content_translations')
    .select('id, is_manually_edited')
    .eq('generated_post_id', item.content_id)
    .eq('language_code', item.target_language)
    .single()

  if (existing?.is_manually_edited) {
    await supabase.from('translation_queue').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', item.id)
    return { success: true, skipped: true }
  }

  const { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, excerpt, content, updated_at')
    .eq('id', item.content_id)
    .single()

  if (!post) {
    await updateFailed(supabase, item.id, 'Source post not found')
    return { success: false, error: 'Source post not found' }
  }

  console.log(`[TranslationQueue] Translating post "${post.title}" → ${item.target_language} (${model})`)

  const result = await translateContent(
    { title: post.title, excerpt: post.excerpt, content: parseTipTapContent(post.content) },
    item.target_language as LanguageCode,
    model
  )

  if (!result.success) {
    await updateFailed(supabase, item.id, result.error || 'Translation failed')
    return { success: false, error: result.error }
  }

  const data = {
    generated_post_id: item.content_id,
    language_code: item.target_language,
    title: result.title,
    slug: result.slug,
    excerpt: result.excerpt,
    content: result.content,
    translation_status: 'completed',
    source_updated_at: post.updated_at,
    translated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    await supabase.from('content_translations').update(data).eq('id', existing.id)
  } else {
    await supabase.from('content_translations').insert(data)
  }

  await supabase.from('translation_queue').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', item.id)
  return { success: true }
}

async function processStaticPage(
  supabase: ReturnType<typeof createAdminClient>,
  item: TranslationQueueItem,
  model: TranslationModel
): Promise<ProcessResult> {
  const { data: existing } = await supabase
    .from('content_translations')
    .select('id, is_manually_edited')
    .eq('static_page_id', item.content_id)
    .eq('language_code', item.target_language)
    .single()

  if (existing?.is_manually_edited) {
    await supabase.from('translation_queue').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', item.id)
    return { success: true, skipped: true }
  }

  const { data: page } = await supabase
    .from('static_pages')
    .select('id, title, content, updated_at')
    .eq('id', item.content_id)
    .single()

  if (!page) {
    await updateFailed(supabase, item.id, 'Source page not found')
    return { success: false, error: 'Source page not found' }
  }

  console.log(`[TranslationQueue] Translating page "${page.title}" → ${item.target_language} (${model})`)

  const result = await translateContent(
    { title: page.title, content: parseTipTapContent(page.content) },
    item.target_language as LanguageCode,
    model
  )

  if (!result.success) {
    await updateFailed(supabase, item.id, result.error || 'Translation failed')
    return { success: false, error: result.error }
  }

  const data = {
    static_page_id: item.content_id,
    language_code: item.target_language,
    title: result.title,
    slug: result.slug,
    content: result.content,
    translation_status: 'completed',
    source_updated_at: page.updated_at,
    translated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    await supabase.from('content_translations').update(data).eq('id', existing.id)
  } else {
    await supabase.from('content_translations').insert(data)
  }

  await supabase.from('translation_queue').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', item.id)
  return { success: true }
}

async function updateFailed(supabase: ReturnType<typeof createAdminClient>, itemId: string, error: string) {
  await supabase.from('translation_queue').update({ status: 'failed', last_error: error }).eq('id', itemId)
}
