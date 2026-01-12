import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { translateContent, type TranslationModel } from '@/lib/i18n/translation-service'
import type { LanguageCode, TranslationQueueItem } from '@/lib/types'

const BATCH_SIZE = 5
const MAX_ATTEMPTS = 3

/**
 * POST /api/admin/translations/process-queue
 * Processes pending translation queue items
 * Supports both session auth (admin UI) and cron auth (scheduled tasks)
 */
export async function POST(request: NextRequest) {
  // Check auth: either session or cron secret
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Use admin client for cron, regular client for session
    const supabase = cronSecretValid ? createAdminClient() : await createClient()

    // Get pending queue items (ordered by priority and age)
    const { data: queueItems, error: fetchError } = await supabase
      .from('translation_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', MAX_ATTEMPTS)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (fetchError) {
      console.error('[Queue] Fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch queue items' }, { status: 500 })
    }

    if (!queueItems || queueItems.length === 0) {
      return NextResponse.json({
        message: 'No pending items in queue',
        processed: 0,
        success: 0,
        failed: 0,
      })
    }

    console.log(`[Queue] Processing ${queueItems.length} items`)

    const results = {
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{ id: string; status: string; error?: string }>,
    }

    for (const item of queueItems as TranslationQueueItem[]) {
      results.processed++

      // Mark as processing
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

        if (result.skipped) {
          results.skipped++
          results.details.push({ id: item.id, status: 'skipped' })
        } else if (result.success) {
          results.success++
          results.details.push({ id: item.id, status: 'success' })
        } else {
          results.failed++
          results.details.push({ id: item.id, status: 'failed', error: result.error })
        }
      } catch (error) {
        results.failed++
        const errorMsg = error instanceof Error ? error.message : String(error)
        results.details.push({ id: item.id, status: 'failed', error: errorMsg })

        // Update queue item with error
        await supabase
          .from('translation_queue')
          .update({
            status: item.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
            last_error: errorMsg,
          })
          .eq('id', item.id)
      }
    }

    return NextResponse.json({
      message: `Processed ${results.processed} items`,
      ...results,
    })
  } catch (error) {
    console.error('[Queue] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

interface ProcessResult {
  success: boolean
  skipped?: boolean
  error?: string
}

async function processQueueItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: TranslationQueueItem
): Promise<ProcessResult> {
  // Get the target language's configured model
  const { data: language } = await supabase
    .from('languages')
    .select('llm_model')
    .eq('code', item.target_language)
    .single()

  const model = (language?.llm_model as TranslationModel) || 'gemini-2.0-flash'

  if (item.content_type === 'generated_post' && item.content_id) {
    return await processGeneratedPost(supabase, item, model)
  } else if (item.content_type === 'static_page' && item.content_id) {
    return await processStaticPage(supabase, item, model)
  } else if (item.content_type === 'ui' && item.ui_key) {
    // UI translations are handled separately
    return { success: false, error: 'UI translations not implemented in queue processor' }
  }

  return { success: false, error: 'Invalid queue item: missing content_id or ui_key' }
}

async function processGeneratedPost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: TranslationQueueItem,
  model: TranslationModel
): Promise<ProcessResult> {
  // Check if translation already exists and is manually edited
  const { data: existingTranslation } = await supabase
    .from('content_translations')
    .select('id, is_manually_edited')
    .eq('generated_post_id', item.content_id)
    .eq('language_code', item.target_language)
    .single()

  if (existingTranslation?.is_manually_edited) {
    // Skip manually edited translations
    await supabase
      .from('translation_queue')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', item.id)

    return { success: true, skipped: true }
  }

  // Get source post
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('id, title, excerpt, content, updated_at')
    .eq('id', item.content_id)
    .single()

  if (postError || !post) {
    await updateQueueFailed(supabase, item.id, 'Source post not found')
    return { success: false, error: 'Source post not found' }
  }

  // Translate content
  console.log(`[Queue] Translating post "${post.title}" to ${item.target_language} using ${model}`)

  const translationResult = await translateContent(
    {
      title: post.title,
      excerpt: post.excerpt,
      content: typeof post.content === 'string' ? JSON.parse(post.content) : post.content,
    },
    item.target_language as LanguageCode,
    model
  )

  if (!translationResult.success) {
    await updateQueueFailed(supabase, item.id, translationResult.error || 'Translation failed')
    return { success: false, error: translationResult.error }
  }

  // Save or update translation
  const translationData = {
    generated_post_id: item.content_id,
    language_code: item.target_language,
    title: translationResult.title,
    slug: translationResult.slug,
    excerpt: translationResult.excerpt,
    content: translationResult.content,
    translation_status: 'completed',
    source_updated_at: post.updated_at,
    translated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existingTranslation) {
    // Update existing
    await supabase
      .from('content_translations')
      .update(translationData)
      .eq('id', existingTranslation.id)
  } else {
    // Insert new
    await supabase
      .from('content_translations')
      .insert(translationData)
  }

  // Mark queue item as completed
  await supabase
    .from('translation_queue')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', item.id)

  return { success: true }
}

async function processStaticPage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: TranslationQueueItem,
  model: TranslationModel
): Promise<ProcessResult> {
  // Check if translation already exists and is manually edited
  const { data: existingTranslation } = await supabase
    .from('content_translations')
    .select('id, is_manually_edited')
    .eq('static_page_id', item.content_id)
    .eq('language_code', item.target_language)
    .single()

  if (existingTranslation?.is_manually_edited) {
    await supabase
      .from('translation_queue')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', item.id)

    return { success: true, skipped: true }
  }

  // Get source page
  const { data: page, error: pageError } = await supabase
    .from('static_pages')
    .select('id, title, content, updated_at')
    .eq('id', item.content_id)
    .single()

  if (pageError || !page) {
    await updateQueueFailed(supabase, item.id, 'Source page not found')
    return { success: false, error: 'Source page not found' }
  }

  // Translate content
  console.log(`[Queue] Translating page "${page.title}" to ${item.target_language} using ${model}`)

  const translationResult = await translateContent(
    {
      title: page.title,
      content: typeof page.content === 'string' ? JSON.parse(page.content) : page.content,
    },
    item.target_language as LanguageCode,
    model
  )

  if (!translationResult.success) {
    await updateQueueFailed(supabase, item.id, translationResult.error || 'Translation failed')
    return { success: false, error: translationResult.error }
  }

  // Save or update translation
  const translationData = {
    static_page_id: item.content_id,
    language_code: item.target_language,
    title: translationResult.title,
    slug: translationResult.slug,
    content: translationResult.content,
    translation_status: 'completed',
    source_updated_at: page.updated_at,
    translated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existingTranslation) {
    await supabase
      .from('content_translations')
      .update(translationData)
      .eq('id', existingTranslation.id)
  } else {
    await supabase
      .from('content_translations')
      .insert(translationData)
  }

  // Mark queue item as completed
  await supabase
    .from('translation_queue')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', item.id)

  return { success: true }
}

async function updateQueueFailed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
  error: string
) {
  await supabase
    .from('translation_queue')
    .update({ status: 'failed', last_error: error })
    .eq('id', itemId)
}

/**
 * GET /api/admin/translations/process-queue
 * Returns queue statistics
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: stats } = await supabase
      .from('translation_queue')
      .select('status')

    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    }

    stats?.forEach(item => {
      const status = item.status as keyof typeof counts
      if (status in counts) {
        counts[status]++
      }
    })

    return NextResponse.json({ stats: counts, total: stats?.length || 0 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
