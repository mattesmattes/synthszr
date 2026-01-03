import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max

interface ScheduleConfig {
  newsletterFetch: {
    enabled: boolean
    hours: number[]
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
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  newsletterFetch: {
    enabled: true,
    hours: [0, 6, 12, 18],
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
async function hasRunRecently(supabase: Awaited<ReturnType<typeof createClient>>, taskKey: string, withinMinutes: number): Promise<boolean> {
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

async function markTaskRun(supabase: Awaited<ReturnType<typeof createClient>>, taskKey: string) {
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

  const supabase = await createClient()
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
    const shouldRun = config.newsletterFetch.hours.some(hour =>
      isTimeMatch(hour, 0, currentHour, currentMinute)
    )

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

  // Check Daily Analysis
  if (config.dailyAnalysis.enabled) {
    if (isTimeMatch(config.dailyAnalysis.hour, config.dailyAnalysis.minute, currentHour, currentMinute)) {
      if (!(await hasRunRecently(supabase, 'daily_analysis', 60))) {
        console.log('[Scheduler] Triggering daily analysis...')
        try {
          // Trigger analysis for yesterday's date
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          const dateStr = yesterday.toISOString().split('T')[0]

          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000'

          await fetch(`${baseUrl}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateStr }),
          })
          await markTaskRun(supabase, 'daily_analysis')
          results.dailyAnalysis = 'triggered'
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

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    currentTime: `${currentHour}:${currentMinute} UTC`,
    results,
  })
}

// Generate a blog post from the latest digest
async function generateDailyPost(supabase: Awaited<ReturnType<typeof createClient>>) {
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
    headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
