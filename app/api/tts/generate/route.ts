import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { generatePostAudio, TiptapDoc } from '@/lib/tts/openai-tts'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

export const maxDuration = 300 // Allow up to 5 minutes for audio generation

interface GenerateAudioRequest {
  postId: string
  locale?: 'de' | 'en'
}

/**
 * POST /api/tts/generate
 * Generate TTS audio for a blog post
 */
export async function POST(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // Rate limiting: 10 requests per minute for TTS generation
  const rateLimitResult = await checkRateLimit(
    `tts-generate:${getClientIP(request)}`,
    rateLimiters.standard() ?? undefined
  )
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  try {
    const body: GenerateAudioRequest = await request.json()
    const { postId, locale = 'de' } = body

    if (!postId) {
      return NextResponse.json(
        { error: 'postId is required' },
        { status: 400 }
      )
    }

    if (locale !== 'de' && locale !== 'en') {
      return NextResponse.json(
        { error: 'locale must be "de" or "en"' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Fetch the post content
    const { data: post, error: postError } = await supabase
      .from('generated_posts')
      .select('id, title, content')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json(
        { error: 'Post nicht gefunden' },
        { status: 404 }
      )
    }

    // For English locale, check if translation exists
    let contentToUse: TiptapDoc = post.content as TiptapDoc

    if (locale === 'en') {
      const { data: translation } = await supabase
        .from('post_translations')
        .select('content')
        .eq('post_id', postId)
        .eq('language', 'en')
        .single()

      if (translation?.content) {
        contentToUse = translation.content as TiptapDoc
      } else {
        // Fall back to German content if no English translation
        console.log(`[TTS] No English translation for post ${postId}, using German content`)
      }
    }

    // Generate audio
    const result = await generatePostAudio(postId, contentToUse, locale)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Audio generation failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      audioUrl: result.audioUrl,
      duration: result.duration,
    })
  } catch (error) {
    console.error('[TTS] Generate error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
