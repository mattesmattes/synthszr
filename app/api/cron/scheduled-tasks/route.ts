import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runSynthesisPipeline } from '@/lib/synthesis/pipeline'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max

// Supabase client for cron jobs (no cookies needed)
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

interface ScheduleConfig {
  newsletterFetch: {
    enabled: boolean
    hour: number
    minute: number
    // Legacy support
    hours?: number[]
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
  newsletterFetch: {
    enabled: true,
    hour: 6,
    minute: 0,
  },
  dailyAnalysis: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  postGeneration: {
    enabled: false,
    hour: 9,
    minute: 0,
  },
  newsletterSend: {
    enabled: false,
    hour: 9,
    minute: 30,
  },
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
async function hasRunRecently(supabase: ReturnType<typeof getSupabase>, taskKey: string, withinMinutes: number): Promise<boolean> {
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

async function markTaskRun(supabase: ReturnType<typeof getSupabase>, taskKey: string) {
  await supabase
    .from('settings')
    .upsert({
      key: `last_run_${taskKey}`,
      value: { timestamp: new Date().toISOString() },
    }, { onConflict: 'key' })
}

export async function GET(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in development or if no secret is set
    if (process.env.NODE_ENV === 'production' && process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = getSupabase()
  const now = new Date()
  const currentHour = now.getUTCHours()
  const currentMinute = now.getUTCMinutes()

  console.log(`[Scheduler] Running at ${currentHour}:${currentMinute} UTC`)

  // Get schedule config
  const { data: configData } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'schedule_config')
    .single()

  const config: ScheduleConfig = configData?.value || DEFAULT_SCHEDULE

  const results: Record<string, string> = {}

  // Check Newsletter Fetch
  if (config.newsletterFetch.enabled) {
    // Support both new format (hour/minute) and legacy format (hours array)
    const fetchHour = config.newsletterFetch.hour ?? config.newsletterFetch.hours?.[0] ?? 6
    const fetchMinute = config.newsletterFetch.minute ?? 0
    const shouldRun = isTimeMatch(fetchHour, fetchMinute, currentHour, currentMinute)

    if (shouldRun && !(await hasRunRecently(supabase, 'newsletter_fetch', 60))) {
      console.log('[Scheduler] Triggering newsletter fetch...')
      try {
        // Call the existing cron endpoint internally
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000'

        await fetch(`${baseUrl}/api/cron/fetch-newsletters`, {
          headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
        })
        await markTaskRun(supabase, 'newsletter_fetch')
        results.newsletterFetch = 'triggered'
      } catch (error) {
        console.error('[Scheduler] Newsletter fetch error:', error)
        results.newsletterFetch = 'error'
      }
    } else {
      results.newsletterFetch = 'skipped'
    }
  }

  // Check Daily Analysis (News & Synthese Erstellung)
  if (config.dailyAnalysis.enabled) {
    if (isTimeMatch(config.dailyAnalysis.hour, config.dailyAnalysis.minute, currentHour, currentMinute)) {
      if (!(await hasRunRecently(supabase, 'daily_analysis', 60))) {
        console.log('[Scheduler] Triggering daily analysis and synthesis...')
        try {
          const digestResult = await runDailyAnalysisAndSynthesis(supabase)
          await markTaskRun(supabase, 'daily_analysis')
          results.dailyAnalysis = digestResult.success ? 'completed' : 'error'
          if (digestResult.digestId) {
            results.digestId = digestResult.digestId
          }
          if (digestResult.synthesesCreated !== undefined) {
            results.synthesesCreated = digestResult.synthesesCreated.toString()
          }
        } catch (error) {
          console.error('[Scheduler] Daily analysis error:', error)
          results.dailyAnalysis = 'error'
        }
      } else {
        results.dailyAnalysis = 'already_ran'
      }
    } else {
      results.dailyAnalysis = 'not_scheduled'
    }
  }

  // Check Post Generation
  if (config.postGeneration.enabled) {
    if (isTimeMatch(config.postGeneration.hour, config.postGeneration.minute, currentHour, currentMinute)) {
      if (!(await hasRunRecently(supabase, 'post_generation', 60))) {
        console.log('[Scheduler] Triggering post generation...')
        try {
          await generateDailyPost(supabase)
          await markTaskRun(supabase, 'post_generation')
          results.postGeneration = 'triggered'
        } catch (error) {
          console.error('[Scheduler] Post generation error:', error)
          results.postGeneration = 'error'
        }
      } else {
        results.postGeneration = 'already_ran'
      }
    } else {
      results.postGeneration = 'not_scheduled'
    }
  }

  // Check Newsletter Send
  if (config.newsletterSend?.enabled) {
    if (isTimeMatch(config.newsletterSend.hour, config.newsletterSend.minute, currentHour, currentMinute)) {
      if (!(await hasRunRecently(supabase, 'newsletter_send', 60))) {
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
            await fetch(`${baseUrl}/api/admin/newsletter-send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              },
              body: JSON.stringify({ postId: latestPost.id }),
            })
            await markTaskRun(supabase, 'newsletter_send')
            results.newsletterSend = 'triggered'
          } else {
            results.newsletterSend = 'no_post'
          }
        } catch (error) {
          console.error('[Scheduler] Newsletter send error:', error)
          results.newsletterSend = 'error'
        }
      } else {
        results.newsletterSend = 'already_ran'
      }
    } else {
      results.newsletterSend = 'not_scheduled'
    }
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    currentTime: `${currentHour}:${currentMinute} UTC`,
    results,
  })
}

// Generate a blog post from the latest digest
async function generateDailyPost(supabase: ReturnType<typeof getSupabase>) {
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

  const response = await fetch(`${baseUrl}/api/ghostwriter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({
      digestContent: digest.analysis_content,
      customPrompt: promptData?.prompt_text,
      vocabularyIntensity: 50,
    }),
  })

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

    const sectionsToProcess = sections.slice(0, 3) // Reduced from 5 to save AI Gateway costs (~$0.20/image)

    if (sectionsToProcess.length > 0) {
      console.log(`[PostGen] Triggering image generation for ${sectionsToProcess.length} sections`)

      fetch(`${baseUrl}/api/generate-image`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          postId: newPost.id,
          newsItems: sectionsToProcess.map(s => ({
            text: `${s.title}\n\n${s.content.slice(0, 2000)}`,
          })),
        }),
      }).catch(err => console.error('[PostGen] Image generation error:', err))
    }
  }

  console.log('[PostGen] Post generation complete')
}

// Run daily analysis, save digest, and trigger synthesis
async function runDailyAnalysisAndSynthesis(supabase: ReturnType<typeof getSupabase>): Promise<{
  success: boolean
  digestId?: string
  synthesesCreated?: number
  error?: string
}> {
  // Use yesterday's date for analysis
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().split('T')[0]

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
      const synthResult = await runSynthesisPipeline(existingDigest.id)
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
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ date: dateStr }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[DailyAnalysis] Analyze API failed:', errorText)
    return { success: false, error: `Analyze API failed: ${response.status}` }
  }

  // Read the SSE stream and collect content
  const reader = response.body?.getReader()
  if (!reader) {
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
    reader.releaseLock()
  }

  if (!analysisContent || analysisContent.length < 100) {
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

  // Step 3: Run synthesis pipeline
  console.log('[DailyAnalysis] Starting synthesis pipeline...')
  try {
    const synthResult = await runSynthesisPipeline(newDigest.id)
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
