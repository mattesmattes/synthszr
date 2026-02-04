import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPostAudioUrl, generatePostAudio, TiptapDoc, getTTSSettings } from '@/lib/tts/openai-tts'

interface RouteParams {
  params: Promise<{ postId: string }>
}

/**
 * GET /api/tts/[postId]
 * Get audio URL for a post, optionally generating if not available
 * Query params:
 *   - locale: 'de' | 'en' (default: 'de')
 *   - generate: 'true' to generate if not available
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const { postId } = await params
  const searchParams = request.nextUrl.searchParams
  const locale = (searchParams.get('locale') || 'de') as 'de' | 'en'
  const shouldGenerate = searchParams.get('generate') === 'true'

  if (!postId) {
    return NextResponse.json(
      { error: 'postId is required' },
      { status: 400 }
    )
  }

  // Check TTS settings
  const settings = await getTTSSettings()
  if (!settings.tts_enabled) {
    return NextResponse.json(
      { error: 'TTS is disabled', enabled: false },
      { status: 503 }
    )
  }

  // Get existing audio
  const result = await getPostAudioUrl(postId, locale)

  if (result.audioUrl) {
    return NextResponse.json({
      audioUrl: result.audioUrl,
      status: result.status,
      duration: result.duration,
    })
  }

  // Audio not available - return status or generate
  if (!shouldGenerate) {
    return NextResponse.json({
      audioUrl: null,
      status: result.status,
      message: result.status === 'generating'
        ? 'Audio is being generated'
        : 'Audio not available. Use ?generate=true to generate.',
    })
  }

  // Generate audio on demand
  const supabase = await createClient()

  // Fetch post content
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('id, content')
    .eq('id', postId)
    .single()

  if (postError || !post) {
    return NextResponse.json(
      { error: 'Post nicht gefunden' },
      { status: 404 }
    )
  }

  // Always use English content for TTS (all locales read English text)
  // First try to get English translation, fall back to original content
  let contentToUse: TiptapDoc = post.content as TiptapDoc

  const { data: translation } = await supabase
    .from('content_translations')
    .select('content')
    .eq('generated_post_id', postId)
    .eq('language_code', 'en')
    .eq('translation_status', 'completed')
    .single()

  if (translation?.content) {
    contentToUse = translation.content as TiptapDoc
    console.log(`[TTS] Using English translation for post ${postId}`)
  } else {
    console.log(`[TTS] No English translation found, using original content for post ${postId}`)
  }

  // Generate audio
  const genResult = await generatePostAudio(postId, contentToUse, locale)

  if (!genResult.success) {
    return NextResponse.json(
      { error: genResult.error || 'Audio generation failed', status: 'failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    audioUrl: genResult.audioUrl,
    status: 'completed',
    duration: genResult.duration,
  })
}
