import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSynthesisPipelineWithProgress } from '@/lib/synthesis/pipeline'
import { processNewsletters } from '@/lib/newsletter/processor'
import { processWebcrawl } from '@/lib/webcrawl/processor'
import { expireOldItems as expireOldQueueItems, resetStuckSelectedItems, syncPublishedPostsQueueItems } from '@/lib/news-queue/service'
import { MAX_DIGEST_SECTIONS, MAX_CONTENT_PREVIEW_CHARS, MIN_ANALYSIS_LENGTH } from '@/lib/constants/thresholds'
import { verifyCronAuth } from '@/lib/security/cron-auth'

export const runtime = 'nodejs'
export const maxDuration = 800 // 13 minutes max (Vercel Pro limit)

interface ScheduleConfig {
  newsletterFetch: {
    enabled: boolean
    hour: number
    minute: number
    // Legacy support
    hours?: number[]
  }
  webcrawlFetch: {
    enabled: boolean
    hour: number
    minute: number
  }
  dailyAnalysis: {
    enabled: boolean
    hour: number
    minute: number
  }
  postGeneration: {
    enabled: boolean
    hour: number
    minute: number
  }
  newsletterSend?: {
    enabled: boolean
    hour: number
    minute: number
  }
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  newsletterFetch: { enabled: true, hour: 3, minute: 0 },   // 04:00 MEZ
  webcrawlFetch:   { enabled: true, hour: 3, minute: 30 },  // 04:30 MEZ
  dailyAnalysis:   { enabled: true, hour: 4, minute: 0 },   // 05:00 MEZ
  postGeneration:  { enabled: false, hour: 9, minute: 0 },
  newsletterSend:  { enabled: false, hour: 9, minute: 30 },
}

// Helper to check if current time matches a schedule (within 10 min window)
function isTimeMatch(hour: number, minute: number, currentHour: number, currentMinute: number): boolean {
  // Check if we're within the 10-minute window starting at the scheduled time
  if (hour === currentHour) {
    return currentMinute >= minute && currentMinute < minute + 10
  }
  return false
}

// Helper to check if we already ran this task today/this hour
async function hasRunRecently(supabase: ReturnType<typeof createAdminClient>, taskKey: string, withinMinutes: number): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', `last_run_${taskKey}`)
    .single()

  if (!data?.value?.timestamp) return false

  const lastRun = new Date(data.value.timestamp)
  const now = new Date()
  const diffMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60)

  return diffMinutes < withinMinutes
}

async function markTaskRun(supabase: ReturnType<typeof createAdminClient>, taskKey: string) {
  await supabase
    .from('settings')
    .upsert({
      key: `last_run_${taskKey}`,
      value: { timestamp: new Date().toISOString() },
    }, { onConflict: 'key' })
}

export async function GET(request: NextRequest) {
  // Verify cron authentication (secure - no dev bypass by default)
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()

  const { searchParams } = new URL(request.url)
  // mode=newsletter: only newsletter fetch (04:00 MEZ cron)
  // runAll=true: all tasks sequentially (manual trigger via admin UI, bypasses time checks)
  const runAll = searchParams.get('runAll') === 'true'
  const forceRun = searchParams.get('force') === 'true' // Bypass hasRunRecently checks

  // DB stores times in UTC (admin UI converts MEZ→UTC on save), compare with UTC
  const currentHour = now.getUTCHours()
  const currentMinute = now.getUTCMinutes()
  const berlinTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }))
  const berlinHour = berlinTime.getHours()
  const berlinMinute = berlinTime.getMinutes()

  console.log(`[Scheduler] Running at ${berlinHour}:${String(berlinMinute).padStart(2, '0')} MEZ (${currentHour}:${String(currentMinute).padStart(2, '0')} UTC)${runAll ? ' [runAll]' : ''}${forceRun ? ' [force]' : ''}`)

  // Get schedule config
  const { data: configData } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'schedule_config')
    .single()

  const savedConfig = configData?.value || {}
  const config: ScheduleConfig = {
    ...DEFAULT_SCHEDULE,
    ...savedConfig,
    // Ensure webcrawlFetch exists even if old DB config pre-dates this field
    webcrawlFetch: savedConfig.webcrawlFetch ?? DEFAULT_SCHEDULE.webcrawlFetch,
  }

  const results: Record<string, string> = {}

  // Newsletter Fetch
  if (config.newsletterFetch.enabled) {
    const fetchHour = config.newsletterFetch.hour ?? config.newsletterFetch.hours?.[0] ?? 3
    const fetchMinute = config.newsletterFetch.minute ?? 0
    const shouldRun = runAll || isTimeMatch(fetchHour, fetchMinute, currentHour, currentMinute)
    const recentlyRan = !forceRun && await hasRunRecently(supabase, 'newsletter_fetch', 60)
    if (shouldRun && !recentlyRan) {
      console.log('[Scheduler] Running newsletter fetch...')
      try {
        const fetchResult = await processNewsletters()
        console.log('[Scheduler] Newsletter fetch completed:', fetchResult.message)
        await markTaskRun(supabase, 'newsletter_fetch')
        results.newsletterFetch = fetchResult.success ? 'completed' : 'error'
        if (fetchResult.processed !== undefined) results.newslettersFetched = fetchResult.processed.toString()
        if (fetchResult.articles !== undefined) results.articlesExtracted = fetchResult.articles.toString()
      } catch (error) {
        console.error('[Scheduler] Newsletter fetch error:', error)
        results.newsletterFetch = 'error'
      }
    } else {
      results.newsletterFetch = recentlyRan ? 'already_ran' : 'not_scheduled'
    }
  }

  // WebCrawl Fetch
  if (config.webcrawlFetch.enabled) {
    const shouldRun = runAll || isTimeMatch(config.webcrawlFetch.hour, config.webcrawlFetch.minute, currentHour, currentMinute)
    const recentlyRan = !forceRun && await hasRunRecently(supabase, 'webcrawl_fetch', 60)
    if (shouldRun && !recentlyRan) {
      console.log('[Scheduler] Running webcrawl fetch...')
      try {
        const crawlResult = await processWebcrawl()
        console.log('[Scheduler] WebCrawl fetch completed:', crawlResult.message || `${crawlResult.articles} articles`)
        await markTaskRun(supabase, 'webcrawl_fetch')
        results.webcrawlFetch = crawlResult.success ? 'completed' : 'error'
        if (crawlResult.articles !== undefined) results.webcrawlArticles = crawlResult.articles.toString()
      } catch (error) {
        console.error('[Scheduler] WebCrawl fetch error:', error)
        results.webcrawlFetch = 'error'
      }
    } else {
      results.webcrawlFetch = recentlyRan ? 'already_ran' : 'not_scheduled'
    }
  }

  // Daily Analysis + News-Synthese
  if (config.dailyAnalysis.enabled) {
    const shouldRun = runAll || isTimeMatch(config.dailyAnalysis.hour, config.dailyAnalysis.minute, currentHour, currentMinute)
    const recentlyRan = !forceRun && await hasRunRecently(supabase, 'daily_analysis', 60)
    if (shouldRun && !recentlyRan) {
      console.log('[Scheduler] Triggering daily analysis and synthesis...')
      try {
        const digestResult = await runDailyAnalysisAndSynthesis(supabase)
        await markTaskRun(supabase, 'daily_analysis')
        results.dailyAnalysis = digestResult.success ? 'completed' : 'error'
        if (digestResult.digestId) results.digestId = digestResult.digestId
        if (digestResult.synthesesCreated !== undefined) results.synthesesCreated = digestResult.synthesesCreated.toString()
      } catch (error) {
        console.error('[Scheduler] Daily analysis error:', error)
        results.dailyAnalysis = 'error'
      }
    } else {
      results.dailyAnalysis = recentlyRan ? 'already_ran' : 'not_scheduled'
    }
  }

  // Post Generation (requires daily analysis)
  if (config.postGeneration.enabled) {
    const shouldRun = runAll || isTimeMatch(config.postGeneration.hour, config.postGeneration.minute, currentHour, currentMinute)
    const recentlyRan = !forceRun && await hasRunRecently(supabase, 'post_generation', 60)
    const analysisOk = ['completed', 'already_ran'].includes(results.dailyAnalysis || '')
    if (shouldRun && !recentlyRan) {
      if (!analysisOk && config.dailyAnalysis.enabled) {
        console.log('[Scheduler] Skipping post generation - daily analysis not completed')
        results.postGeneration = 'skipped_dependency_failed'
      } else {
        console.log('[Scheduler] Triggering post generation...')
        try {
          await generateDailyPost(supabase)
          await markTaskRun(supabase, 'post_generation')
          results.postGeneration = 'completed'
        } catch (error) {
          console.error('[Scheduler] Post generation error:', error)
          results.postGeneration = 'error'
        }
      }
    } else {
      results.postGeneration = recentlyRan ? 'already_ran' : 'not_scheduled'
    }
  }

  // Newsletter Send
  if (config.newsletterSend?.enabled) {
    const shouldRunSend = runAll || isTimeMatch(config.newsletterSend.hour, config.newsletterSend.minute, currentHour, currentMinute)
    const sendRecentlyRan = !forceRun && await hasRunRecently(supabase, 'newsletter_send', 60)

    if (shouldRunSend && !sendRecentlyRan) {
      console.log('[Scheduler] Triggering newsletter send...')
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000'

        // Get latest published post
        const { data: latestPost } = await supabase
          .from('generated_posts')
          .select('id')
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (latestPost) {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 60000) // 60s timeout
          try {
            await fetch(`${baseUrl}/api/admin/newsletter-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              },
              body: JSON.stringify({ postId: latestPost.id }),
              signal: controller.signal,
            })
            clearTimeout(timeoutId)
          } catch (error) {
            clearTimeout(timeoutId)
            if (error instanceof Error && error.name === 'AbortError') {
              console.error('[Scheduler] Newsletter send timeout after 60s')
            }
            throw error
          }
          await markTaskRun(supabase, 'newsletter_send')
          results.newsletterSend = 'completed'
        } else {
          results.newsletterSend = 'no_post'
        }
      } catch (error) {
        console.error('[Scheduler] Newsletter send error:', error)
        results.newsletterSend = 'error'
      }
    } else if (sendRecentlyRan) {
      results.newsletterSend = 'already_ran'
    } else {
      results.newsletterSend = 'not_scheduled'
    }
  }

  // Queue Maintenance: Expire old items + reset stuck items (runs every time cron is called)
  try {
    const expiredCount = await expireOldQueueItems()
    if (expiredCount > 0) {
      console.log(`[Scheduler] Expired ${expiredCount} old queue items`)
    }

    // Reset items stuck in "selected" status for >24 hours (abandoned drafts)
    const resetCount = await resetStuckSelectedItems(24)

    // Sync any published posts that still have pending_queue_item_ids (one-time cleanup)
    const syncResult = await syncPublishedPostsQueueItems()

    const maintenanceActions: string[] = []
    if (expiredCount > 0) maintenanceActions.push(`expired:${expiredCount}`)
    if (resetCount > 0) maintenanceActions.push(`reset:${resetCount}`)
    if (syncResult.itemsMarked > 0) maintenanceActions.push(`synced:${syncResult.itemsMarked}`)

    results.queueMaintenance = maintenanceActions.length > 0 ? maintenanceActions.join(',') : 'ok'
  } catch (error) {
    console.error('[Scheduler] Queue maintenance error:', error)
    results.queueMaintenance = 'error'
  }

  // Translation Queue Processing: Process pending translations (runs every time cron is called)
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

    // Process up to 3 batches (15 translations total) per cron run
    let totalProcessed = 0
    let totalSuccess = 0
    let totalFailed = 0

    for (let batch = 0; batch < 3; batch++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout
      try {
        const response = await fetch(`${baseUrl}/api/admin/translations/process-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (response.ok) {
          const data = await response.json()
          totalProcessed += data.processed || 0
          totalSuccess += data.success || 0
          totalFailed += data.failed || 0

          // Stop if no more pending items
          if (!data.processed || data.processed === 0) break
        } else {
          console.error('[Scheduler] Translation queue processing failed:', response.status)
          break
        }
      } catch (error) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('[Scheduler] Translation queue processing timeout after 30s')
        } else {
          console.error('[Scheduler] Translation queue processing error:', error)
        }
        break
      }
    }

    if (totalProcessed > 0) {
      console.log(`[Scheduler] Processed ${totalProcessed} translations (${totalSuccess} success, ${totalFailed} failed)`)
      results.translationQueue = `processed_${totalProcessed}_success_${totalSuccess}`
    } else {
      results.translationQueue = 'empty'
    }
  } catch (error) {
    console.error('[Scheduler] Translation queue error:', error)
    results.translationQueue = 'error'
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    currentTime: `${currentHour}:${String(currentMinute).padStart(2, '0')} MEZ`,
    results,
  })
}

// Generate a blog post from the latest digest
async function generateDailyPost(supabase: ReturnType<typeof createAdminClient>) {
  // Get the latest digest that doesn't have a generated post yet
  const { data: digest } = await supabase
    .from('daily_digests')
    .select('id, digest_date, analysis_content')
    .order('digest_date', { ascending: false })
    .limit(1)
    .single()

  if (!digest) {
    console.log('[PostGen] No digest found')
    return
  }

  // Check if post already exists for this digest
  const { data: existingPost } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('digest_id', digest.id)
    .single()

  if (existingPost) {
    console.log('[PostGen] Post already exists for digest:', digest.id)
    return
  }

  console.log('[PostGen] Generating post for digest:', digest.digest_date)

  // Get active ghostwriter prompt
  const { data: promptData } = await supabase
    .from('ghostwriter_prompts')
    .select('prompt_text')
    .eq('is_active', true)
    .single()

  // Get vocabulary
  const { data: vocabulary } = await supabase
    .from('vocabulary')
    .select('word, replacement')
    .eq('enabled', true)

  const vocabMap = new Map(vocabulary?.map(v => [v.word.toLowerCase(), v.replacement]) || [])

  // Call ghostwriter API
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const ghostwriterController = new AbortController()
  const ghostwriterTimeoutId = setTimeout(() => ghostwriterController.abort(), 120000) // 120s timeout

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/ghostwriter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        digestContent: digest.analysis_content,
        customPrompt: promptData?.prompt_text,
        vocabularyIntensity: 10,
      }),
      signal: ghostwriterController.signal,
    })
    clearTimeout(ghostwriterTimeoutId)
  } catch (error) {
    clearTimeout(ghostwriterTimeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('[PostGen] Ghostwriter API timeout after 120s')
    }
    throw error
  }

  if (!response.ok) {
    throw new Error(`Ghostwriter API failed: ${response.status}`)
  }

  // Read the streamed response
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No reader')

  const decoder = new TextDecoder()
  let blogContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n\n')

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          if (data.text) blogContent += data.text
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  if (!blogContent) {
    throw new Error('No blog content generated')
  }

  // Apply vocabulary replacements
  let processedContent = blogContent
  for (const [word, replacement] of vocabMap) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    processedContent = processedContent.replace(regex, replacement)
  }

  // Extract title from content
  const titleMatch = processedContent.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] || `Artikel vom ${new Date(digest.digest_date).toLocaleDateString('de-DE')}`

  // Convert markdown to TipTap format
  const { markdownToTiptap } = await import('@/lib/utils/markdown-to-tiptap')
  const tiptapContent = markdownToTiptap(processedContent)

  // Create the post
  const { data: newPost, error } = await supabase
    .from('generated_posts')
    .insert({
      digest_id: digest.id,
      title,
      content: JSON.stringify(tiptapContent),
      word_count: processedContent.split(/\s+/).length,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create post: ${error.message}`)
  }

  console.log('[PostGen] Created post:', newPost.id)

  // Trigger image generation
  if (newPost && processedContent) {
    // Split blog content into sections by headings
    const sections: Array<{ title: string; content: string }> = []
    const headingRegex = /^(#{1,2})\s+(.+)$/gm
    const matches = [...processedContent.matchAll(headingRegex)]

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const sectionTitle = match[2].trim()
      const startIndex = match.index! + match[0].length
      const endIndex = matches[i + 1]?.index ?? processedContent.length
      const content = processedContent.slice(startIndex, endIndex).trim()

      if (content.length > 50) {
        sections.push({ title: sectionTitle, content })
      }
    }

    const sectionsToProcess = sections.slice(0, MAX_DIGEST_SECTIONS)

    if (sectionsToProcess.length > 0) {
      console.log(`[PostGen] Triggering image generation for ${sectionsToProcess.length} sections`)

      const imageController = new AbortController()
      const imageTimeoutId = setTimeout(() => imageController.abort(), 30000) // 30s timeout

      try {
        await fetch(`${baseUrl}/api/generate-image`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({
            postId: newPost.id,
            newsItems: sectionsToProcess.map(s => ({
              text: `${s.title}\n\n${s.content.slice(0, MAX_CONTENT_PREVIEW_CHARS)}`,
            })),
          }),
          signal: imageController.signal,
        })
        clearTimeout(imageTimeoutId)
      } catch (err) {
        clearTimeout(imageTimeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          console.error('[PostGen] Image generation timeout after 30s')
        } else {
          console.error('[PostGen] Image generation error:', err)
        }
      }
    }
  }

  console.log('[PostGen] Post generation complete')
}

// Run daily analysis, save digest, and trigger synthesis
async function runDailyAnalysisAndSynthesis(supabase: ReturnType<typeof createAdminClient>): Promise<{
  success: boolean
  digestId?: string
  synthesesCreated?: number
  error?: string
}> {
  // Use today's date for analysis (we analyze newsletters collected earlier today)
  const today = new Date()
  const dateStr = today.toISOString().split('T')[0]

  console.log(`[DailyAnalysis] Starting analysis for ${dateStr}`)

  // Check if we already have a digest for this date
  const { data: existingDigest } = await supabase
    .from('daily_digests')
    .select('id')
    .eq('digest_date', dateStr)
    .single()

  if (existingDigest) {
    console.log(`[DailyAnalysis] Digest already exists for ${dateStr}, skipping analysis`)
    // Still run synthesis if no syntheses exist
    const { count } = await supabase
      .from('developed_syntheses')
      .select('id', { count: 'exact', head: true })
      .eq('digest_id', existingDigest.id)

    if (!count || count === 0) {
      console.log(`[DailyAnalysis] Running synthesis for existing digest ${existingDigest.id}`)
      const synthResult = await runSynthesisPipelineWithProgress(
        existingDigest.id, {}, (event) => {
          if (event.type === 'partial' || event.type === 'error') {
            console.log(`[DailyAnalysis] Synthesis progress: ${event.message || event.error}`)
          }
        }
      )
      return {
        success: true,
        digestId: existingDigest.id,
        synthesesCreated: synthResult.synthesesDeveloped,
      }
    }
    return { success: true, digestId: existingDigest.id }
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  // Step 1: Stream analysis and collect content
  console.log('[DailyAnalysis] Calling analyze API...')
  const analyzeController = new AbortController()
  // Timeout covers entire operation including body/stream reading (not just headers)
  const analyzeTimeoutId = setTimeout(() => analyzeController.abort(), 270000) // 4.5 min timeout
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ date: dateStr }),
      signal: analyzeController.signal,
    })
  } catch (err) {
    clearTimeout(analyzeTimeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[DailyAnalysis] Analyze API timeout after 4.5 minutes')
      return { success: false, error: 'Analyze API timeout' }
    }
    throw err
  }

  if (!response.ok) {
    clearTimeout(analyzeTimeoutId)
    const errorText = await response.text()
    console.error('[DailyAnalysis] Analyze API failed:', errorText)
    return { success: false, error: `Analyze API failed: ${response.status}` }
  }

  // Read the SSE stream and collect content
  const reader = response.body?.getReader()
  if (!reader) {
    clearTimeout(analyzeTimeoutId)
    return { success: false, error: 'No response reader' }
  }

  const decoder = new TextDecoder()
  let analysisContent = ''
  let analyzedItemIds: string[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'sources' && data.itemIds) {
              analyzedItemIds = data.itemIds
            } else if (data.text) {
              analysisContent += data.text
            } else if (data.done) {
              console.log('[DailyAnalysis] Analysis stream complete')
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    clearTimeout(analyzeTimeoutId) // Cancel timeout only after full stream is read
    reader.releaseLock()
  }

  if (!analysisContent || analysisContent.length < MIN_ANALYSIS_LENGTH) {
    console.error('[DailyAnalysis] Analysis content too short or empty')
    return { success: false, error: 'Analysis content empty or too short' }
  }

  console.log(`[DailyAnalysis] Collected ${analysisContent.length} chars, ${analyzedItemIds.length} source items`)

  // Step 2: Save digest to database
  const { data: newDigest, error: insertError } = await supabase
    .from('daily_digests')
    .insert({
      digest_date: dateStr,
      analysis_content: analysisContent,
      word_count: analysisContent.split(/\s+/).length,
      sources_used: analyzedItemIds.length > 0 ? analyzedItemIds : null,
    })
    .select('id')
    .single()

  if (insertError || !newDigest) {
    console.error('[DailyAnalysis] Failed to save digest:', insertError)
    return { success: false, error: `Failed to save digest: ${insertError?.message}` }
  }

  console.log(`[DailyAnalysis] Saved digest ${newDigest.id}`)

  // Step 3: Run synthesis pipeline (with timeout protection)
  console.log('[DailyAnalysis] Starting synthesis pipeline...')
  try {
    const synthResult = await runSynthesisPipelineWithProgress(
      newDigest.id, {}, (event) => {
        if (event.type === 'partial' || event.type === 'error') {
          console.log(`[DailyAnalysis] Synthesis progress: ${event.message || event.error}`)
        }
      }
    )
    console.log(`[DailyAnalysis] Synthesis complete: ${synthResult.synthesesDeveloped} syntheses created`)

    return {
      success: true,
      digestId: newDigest.id,
      synthesesCreated: synthResult.synthesesDeveloped,
    }
  } catch (synthError) {
    console.error('[DailyAnalysis] Synthesis failed:', synthError)
    // Still return success for digest creation
    return {
      success: true,
      digestId: newDigest.id,
      synthesesCreated: 0,
      error: `Synthesis failed: ${synthError instanceof Error ? synthError.message : 'Unknown'}`,
    }
  }
}
