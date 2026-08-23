/**
 * GET/POST /api/podcast/[postId]
 * Get or generate podcast audio for a specific post
 *
 * GET: strictly read-only. Returns status/URL for published posts only;
 *      never triggers generation (SEC-013).
 * POST: admin-only (getSession()). Sole generation path (script + audio).
 *
 * GET query params:
 * - locale: 'de' | 'en' | 'cs' | 'nds' (default: 'de')
 *
 * POST body:
 * - locale: 'de' | 'en' | 'cs' | 'nds' (default: 'de')
 * - force: boolean (default: false) — delete existing entry before regenerating
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { put } from '@vercel/blob'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import {
  generatePodcastDialogue,
  parseScriptText,
} from '@/lib/tts/elevenlabs-tts'
import { concatenateWithCrossfade, mixingSettingsToCrossfadeOptions, type AudioSegment } from '@/lib/audio/crossfade'
import { getPersonalityState, buildPersonalityBrief, advanceState } from '@/lib/podcast/personality'
import { retrieveMemory, buildMemoryBrief, shouldAnnounceMemoryAwakening } from '@/lib/podcast/memory'
import { ensureIntermezzoMarker } from '@/lib/podcast/intermezzo'
import Anthropic from '@anthropic-ai/sdk'

// TTS language mapping
const LOCALE_TO_TTS_LANG: Record<string, 'de' | 'en'> = {
  de: 'de',
  en: 'en',
  cs: 'en',
  nds: 'en',
}

// Supported podcast locales (SEC-013)
const PODCAST_LOCALES = ['de', 'en', 'cs', 'nds'] as const
const postIdSchema = z.string().uuid()
const localeSchema = z.enum(PODCAST_LOCALES)
const postBodySchema = z
  .object({
    locale: localeSchema.default('de'),
    force: z.boolean().default(false),
  })
  .strict()

// Script generation prompt
const SCRIPT_PROMPT = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthesizer - der AI-Analyst mit pointierten Meinungen

**Output-Format (WICHTIG - exakt dieses Format verwenden):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...

**Verfügbare Emotion-Tags:**
[cheerfully], [thoughtfully], [seriously], [excitedly], [skeptically], [laughing], [curiously]

**Stilregeln:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du..."
2. Reaktionen: "Genau!", "Interessant!", "Warte mal..."
3. Pausen mit "..." für Denkpausen
4. Der GUEST bringt die pointierten Meinungen aus dem Artikel ein — sagt dabei aber NIE "Synthesizer Take"/"Synthszr Take", sondern natürliche Wendungen ("Meine Sicht ist...", "Wie siehst du das?", "Mein Standpunkt:")
5. WICHTIG: Der GUEST wird im Dialog IMMER als "Synthesizer" bezeichnet, NIE als "Synthszr"

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
 * GET - Check podcast status (strictly read-only, public reader)
 *
 * No upsert/delete/blob/LLM/TTS ever happens on GET. Generation lives
 * exclusively in POST, gated by getSession() (SEC-013).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params
  const { searchParams } = new URL(request.url)

  const postIdResult = postIdSchema.safeParse(postId)
  if (!postIdResult.success) {
    return NextResponse.json({ error: 'Invalid postId' }, { status: 400 })
  }

  // GET no longer supports triggering generation. Reject any attempt so a
  // stale client (or an attacker) gets an explicit error instead of a
  // silently-ignored no-op.
  if (searchParams.has('generate') || searchParams.has('force')) {
    return NextResponse.json(
      { error: 'GET is read-only; use POST to generate a podcast' },
      { status: 400 }
    )
  }

  const localeResult = localeSchema.safeParse(searchParams.get('locale') || 'de')
  if (!localeResult.success) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }
  const locale = localeResult.data

  const supabase = createAdminClient()

  // Only published posts are visible to the anonymous reader. Verified via
  // repo-wide grep that no admin page reads this GET for draft preview —
  // the admin audio UI (app/admin/audio/page.tsx) uses a separate
  // jobs/generate-script pipeline, not this route.
  const { data: post } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('id', postId)
    .eq('status', 'published')
    .maybeSingle()

  if (!post) {
    return NextResponse.json({ exists: false }, { status: 404 })
  }

  // Check if podcast exists
  const { data: existingPodcast } = await supabase
    .from('post_podcasts')
    .select('audio_url, status, duration_seconds, created_at')
    .eq('post_id', postId)
    .eq('locale', locale)
    .single()

  if (existingPodcast?.status === 'completed' && existingPodcast.audio_url) {
    return NextResponse.json(
      {
        exists: true,
        audioUrl: existingPodcast.audio_url,
        duration: existingPodcast.duration_seconds,
        createdAt: existingPodcast.created_at,
      },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
    )
  }

  if (existingPodcast?.status === 'generating') {
    return NextResponse.json({
      exists: false,
      status: 'generating',
      message: 'Podcast wird gerade generiert...',
    })
  }

  return NextResponse.json({
    exists: false,
    status: 'not_found',
  })
}

/**
 * POST - Generate podcast (sole generation path, admin-only)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  // Auth-Gate: Podcast-Generierung ist teuer (LLM + TTS) und darf nicht
  // öffentlich triggerbar sein (Kosten-DoS). Wird nur intern/Admin genutzt.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { postId } = await params
  const postIdResult = postIdSchema.safeParse(postId)
  if (!postIdResult.success) {
    return NextResponse.json({ error: 'Invalid postId' }, { status: 400 })
  }

  const rawBody = await request.json().catch(() => ({}))
  const bodyResult = postBodySchema.safeParse(rawBody)
  if (!bodyResult.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const { locale, force } = bodyResult.data

  if (force) {
    // Force regeneration: delete old entry first so a stale completed/failed
    // row doesn't linger once the fresh upsert (inside generatePodcastForPost) runs.
    const supabase = createAdminClient()
    await supabase.from('post_podcasts').delete().eq('post_id', postId).eq('locale', locale)
  }

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
  const supabase = createAdminClient()
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

    // Inject personality brief + episode memory.
    // Memory + personality go into the SYSTEM prompt — that's where the
    // model weights character behavior most. User prompt = today's news.
    const personalityState = await getPersonalityState(ttsLang)
    const personalityBrief = buildPersonalityBrief(personalityState)
    let memoryBrief = ''
    try {
      const [{ recent, similar }, announceAwakening] = await Promise.all([
        retrieveMemory({
          locale: ttsLang,
          query: `${postTitle}\n\n${postContent.slice(0, 4000)}`,
          recencyCount: 3,
          semanticCount: 5,
        }),
        shouldAnnounceMemoryAwakening(ttsLang),
      ])
      memoryBrief = buildMemoryBrief(recent, similar, { announceAwakening, locale })
    } catch (memErr) {
      console.warn('[Podcast] Memory retrieval failed (continuing without):', memErr)
    }
    const systemPrompt = memoryBrief
      ? `${personalityBrief}\n\n${memoryBrief}`
      : personalityBrief

    console.log(`[Podcast] Generating script for post ${postId} in ${locale} (episode #${personalityState.episode_count + 1}, phase: ${personalityState.relationship_phase})`)

    const anthropic = new Anthropic()
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawScript = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')

    if (!rawScript.trim()) {
      throw new Error('AI generated empty script')
    }

    // Post-generation Haiku pass that guarantees an [INTERMEZZO] marker
    // at the strongest self-reflection beat — the main model ignores
    // the prompt rule consistently. Fail-soft: returns rawScript when
    // the pass can't find a suitable line.
    const script = await ensureIntermezzoMarker(rawScript, ttsLang)

    // Evolve personality state after successful generation
    await advanceState(personalityState, script)
    // Memory EXTRACTION happens only on the jobs/process pipeline,
    // which is the one that produces a podcast_jobs row that the
    // memory table can foreign-key against. Single-shot generations
    // through this route still BENEFIT from the memory brief above
    // (read-only), but don't write back.

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
      openaiModel: 'gpt-4o-mini-tts',
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
          overlapping: meta?.overlapping,
          articleIndex: meta?.articleIndex,
        })
      }
    }

    console.log(`[Podcast] Processing ${segments.length} segments with crossfade + intro/outro...`)

    // Use crossfade module with mixing settings from DB
    const crossfadeOptions = mixingSettingsToCrossfadeOptions(settings.mixing_settings)
    const combinedAudio = await concatenateWithCrossfade(segments, crossfadeOptions)

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
