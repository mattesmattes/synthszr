/**
 * GET/POST /api/podcast/[postId]
 * Get or generate podcast audio for a specific post
 *
 * GET: Check if podcast exists, return status and URL
 * POST: Generate podcast (script + audio) for the post
 *
 * Query params:
 * - locale: string (default: 'de')
 * - generate: 'true' to trigger generation on GET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { put } from '@vercel/blob'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import {
  generatePodcastDialogue,
  parseScriptText,
  type ElevenLabsModel,
} from '@/lib/tts/elevenlabs-tts'
import { concatenateWithCrossfade, type AudioSegment } from '@/lib/audio/crossfade'
import Anthropic from '@anthropic-ai/sdk'

// TTS language mapping
const LOCALE_TO_TTS_LANG: Record<string, 'de' | 'en'> = {
  de: 'de',
  en: 'en',
  cs: 'en',
  nds: 'en',
}

// Script generation prompt
const SCRIPT_PROMPT = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthszr - der AI-Analyst mit pointierten Meinungen

**Output-Format (WICHTIG - exakt dieses Format verwenden):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...

**Verfügbare Emotion-Tags:**
[cheerfully], [thoughtfully], [seriously], [excitedly], [skeptically], [laughing], [curiously]

**Stilregeln:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du..."
2. Reaktionen: "Genau!", "Interessant!", "Warte mal..."
3. Pausen mit "..." für Denkpausen
4. Der GUEST bringt die "Synthszr Take" Meinungen ein

**Ziel-Länge:** {duration} Minuten (ca. {wordCount} Wörter)
**Sprache:** {language}

**Blog-Artikel:**
Titel: {title}

{content}

Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung.`

interface RouteParams {
  params: Promise<{ postId: string }>
}

/**
 * Extract plain text from TipTap JSON content recursively
 */
function extractTextFromTiptap(content: unknown): string {
  if (!content) return ''

  // Handle string content (might be JSON string)
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      return extractTextFromTiptap(parsed)
    } catch {
      return content
    }
  }

  if (typeof content !== 'object') return ''

  const node = content as { type?: string; content?: unknown[]; text?: string }

  if (node.type === 'text' && node.text) {
    return node.text
  }

  if (Array.isArray(node.content)) {
    const texts: string[] = []
    for (const child of node.content) {
      const text = extractTextFromTiptap(child)
      if (text.trim()) {
        texts.push(text)
      }
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      return texts.join('') + '\n\n'
    }
    if (node.type === 'listItem') {
      return '• ' + texts.join('') + '\n'
    }
    return texts.join('')
  }

  return ''
}

/**
 * GET - Check podcast status
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params
  const { searchParams } = new URL(request.url)
  const locale = searchParams.get('locale') || 'de'
  const shouldGenerate = searchParams.get('generate') === 'true'
  const forceRegenerate = searchParams.get('force') === 'true'

  const supabase = await createClient()

  // Check if podcast exists
  const { data: existingPodcast } = await supabase
    .from('post_podcasts')
    .select('audio_url, status, duration_seconds, created_at')
    .eq('post_id', postId)
    .eq('locale', locale)
    .single()

  // Return existing podcast unless force regeneration requested
  if (existingPodcast?.status === 'completed' && existingPodcast.audio_url && !forceRegenerate) {
    return NextResponse.json({
      exists: true,
      audioUrl: existingPodcast.audio_url,
      duration: existingPodcast.duration_seconds,
      createdAt: existingPodcast.created_at,
    })
  }

  // Force regeneration: delete old entry first
  if (forceRegenerate && existingPodcast) {
    console.log(`[Podcast] Force regeneration requested for post ${postId}`)
    await supabase
      .from('post_podcasts')
      .delete()
      .eq('post_id', postId)
      .eq('locale', locale)
  }

  if (existingPodcast?.status === 'generating' && !forceRegenerate) {
    return NextResponse.json({
      exists: false,
      status: 'generating',
      message: 'Podcast wird gerade generiert...',
    })
  }

  // If generate flag is set, trigger generation
  if (shouldGenerate || forceRegenerate) {
    console.log(`[Podcast] Starting generation for post ${postId}, locale ${locale}`)
    // Start generation in background
    generatePodcastForPost(postId, locale).catch(console.error)

    return NextResponse.json({
      exists: false,
      status: 'generating',
      message: 'Podcast-Generierung gestartet...',
    })
  }

  return NextResponse.json({
    exists: false,
    status: 'not_found',
  })
}

/**
 * POST - Generate podcast
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params
  const body = await request.json().catch(() => ({}))
  const locale = (body.locale as string) || 'de'

  // Start generation
  const result = await generatePodcastForPost(postId, locale)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    audioUrl: result.audioUrl,
    duration: result.duration,
  })
}

/**
 * Generate podcast for a post (script + audio)
 */
async function generatePodcastForPost(
  postId: string,
  locale: string
): Promise<{ success: boolean; audioUrl?: string; duration?: number; error?: string }> {
  const supabase = await createClient()
  const ttsLang = LOCALE_TO_TTS_LANG[locale] || 'en'

  try {
    // Mark as generating
    await supabase
      .from('post_podcasts')
      .upsert({
        post_id: postId,
        locale,
        status: 'generating',
        audio_url: null,
      }, { onConflict: 'post_id,locale' })

    // Get settings
    const settings = await getTTSSettings()
    const durationMinutes = settings.podcast_duration_minutes || 30
    const wordCount = Math.round(durationMinutes * 150)

    // Fetch post content
    let postTitle = ''
    let postContent = ''

    const { data: post } = await supabase
      .from('generated_posts')
      .select('title, content')
      .eq('id', postId)
      .single()

    if (!post) {
      throw new Error('Post not found')
    }

    postTitle = post.title

    // Get translated content if not German
    if (locale !== 'de') {
      const { data: translation } = await supabase
        .from('content_translations')
        .select('title, content')
        .eq('generated_post_id', postId)
        .eq('language_code', locale)
        .eq('translation_status', 'completed')
        .single()

      if (translation) {
        postTitle = translation.title || postTitle
        postContent = extractTextFromTiptap(translation.content)
      } else {
        postContent = extractTextFromTiptap(post.content)
      }
    } else {
      postContent = extractTextFromTiptap(post.content)
    }

    if (!postContent.trim()) {
      throw new Error('Post has no content')
    }

    // Generate script with Claude
    const languageLabel = ttsLang === 'de' ? 'Deutsch' : 'English'
    const prompt = SCRIPT_PROMPT
      .replace('{duration}', String(durationMinutes))
      .replace('{wordCount}', String(wordCount))
      .replace('{language}', languageLabel)
      .replace('{title}', postTitle)
      .replace('{content}', postContent)

    console.log(`[Podcast] Generating script for post ${postId} in ${locale}`)

    const anthropic = new Anthropic()
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })

    const script = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')

    if (!script.trim()) {
      throw new Error('AI generated empty script')
    }

    // Parse script
    const lines = parseScriptText(script)
    if (lines.length === 0) {
      throw new Error('Failed to parse script')
    }

    console.log(`[Podcast] Generated ${lines.length} lines, generating audio...`)

    // Get voice IDs based on language
    const hostVoiceId = ttsLang === 'de'
      ? settings.podcast_host_voice_de
      : settings.podcast_host_voice_en
    const guestVoiceId = ttsLang === 'de'
      ? settings.podcast_guest_voice_de
      : settings.podcast_guest_voice_en

    // Generate audio segments
    const audioResult = await generatePodcastDialogue({
      lines,
      hostVoiceId,
      guestVoiceId,
      model: settings.elevenlabs_model as ElevenLabsModel,
    })

    if (!audioResult.success || !audioResult.segmentBuffers || audioResult.segmentBuffers.length === 0) {
      throw new Error(audioResult.error || 'Audio generation failed')
    }

    // Build AudioSegment array for crossfade processing
    const segments: AudioSegment[] = []
    const segmentMeta = audioResult.segmentMetadata || []

    for (let i = 0; i < audioResult.segmentBuffers.length; i++) {
      const buffer = audioResult.segmentBuffers[i]
      const meta = segmentMeta[i]

      if (buffer && buffer.length > 0) {
        segments.push({
          buffer,
          speaker: meta?.speaker || (i % 2 === 0 ? 'HOST' : 'GUEST'),
          text: meta?.text || '',
        })
      }
    }

    console.log(`[Podcast] Processing ${segments.length} segments with crossfade + intro/outro...`)

    // Use crossfade module with intro and outro
    const combinedAudio = await concatenateWithCrossfade(segments, {
      includeIntro: true,
      introCrossfadeSec: 4,
      includeOutro: true,
      outroCrossfadeSec: 4,
    })

    // Estimate duration (MP3 at 128kbps = 16KB per second)
    const durationSeconds = Math.round(combinedAudio.length / (128 * 1024 / 8))
    console.log(`[Podcast] Final audio with intro/outro: ${combinedAudio.length} bytes, ~${durationSeconds}s`)

    // Upload to Vercel Blob
    const fileName = `podcasts/${postId}/${locale}.mp3`
    const blob = await put(fileName, combinedAudio, {
      access: 'public',
      contentType: 'audio/mpeg',
      allowOverwrite: true,
    })

    // Update database
    await supabase
      .from('post_podcasts')
      .upsert({
        post_id: postId,
        locale,
        status: 'completed',
        audio_url: blob.url,
        duration_seconds: durationSeconds,
        script_content: script,
      }, { onConflict: 'post_id,locale' })

    console.log(`[Podcast] Completed for post ${postId}: ${blob.url}`)

    return {
      success: true,
      audioUrl: blob.url,
      duration: durationSeconds,
    }
  } catch (error) {
    console.error('[Podcast] Generation failed:', error)

    // Mark as failed
    await supabase
      .from('post_podcasts')
      .upsert({
        post_id: postId,
        locale,
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      }, { onConflict: 'post_id,locale' })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
