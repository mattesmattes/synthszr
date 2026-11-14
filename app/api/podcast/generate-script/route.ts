/**
 * POST /api/podcast/generate-script
 * Generate a podcast script from blog post content using AI
 *
 * Request body:
 * {
 *   postId: string           // Post ID to generate script for
 *   locale?: string          // Language locale (de, en, cs, nds)
 *   durationMinutes?: number // Target duration (default: from settings)
 *   customPrompt?: string    // Optional custom prompt override
 * }
 *
 * Response:
 * {
 *   success: boolean
 *   script?: string          // Generated script in HOST:/GUEST: format
 *   estimatedDuration?: number
 *   error?: string
 * }
 */

export const maxDuration = 300 // Allow up to 5 minutes for AI script generation

import { NextRequest, NextResponse } from 'next/server'
import { pickOpener, pickCloser } from '@/lib/podcast/openers'
import { getRecentEdges, recentEdgesSection } from '@/lib/podcast/recent-openings'
import { loadModes } from '@/lib/podcast/mode-generator'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import { getPersonalityState, buildPersonalityBrief, stripMomentsSection } from '@/lib/podcast/personality'
import { isWeekWrapup, wrapupPromptSection } from '@/lib/podcast/wrapup-mode'
import { retrieveMemory, buildMemoryBrief, shouldAnnounceMemoryAwakening } from '@/lib/podcast/memory'
import { ensureIntermezzoMarker } from '@/lib/podcast/intermezzo'
import { resolveDialogueRules } from '@/lib/podcast/dialogue-style'
import { DEFAULT_SCRIPT_PROMPT_DE, DEFAULT_SCRIPT_PROMPT_EN } from '@/lib/podcast/script-templates'
import { EPISODE_SHAPE_DE, EPISODE_SHAPE_EN, VOICE_STYLE_DE, VOICE_STYLE_EN } from '@/lib/podcast/voice-style'
import { episodeGreetingSuffix, milestoneOf, milestonePromptSection } from '@/lib/podcast/episode-number'
import { synthszrIssueNumber } from '@/lib/i18n/config'
import Anthropic from '@anthropic-ai/sdk'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { withUsageLogging } from '@/lib/ai/usage-log'
import { describeEmptyScript, extractScriptText, fallbackModelFor, scriptRequestBudget, shouldRetryWithFallback } from '@/lib/podcast/script-diagnostics'

// TTS language mapping for podcast generation
const LOCALE_TO_TTS_LANG: Record<string, 'de' | 'en'> = {
  de: 'de',
  en: 'en',
  cs: 'en',
  nds: 'en',
}

const DEFAULT_SCRIPT_PROMPT = DEFAULT_SCRIPT_PROMPT_DE

interface GenerateScriptRequest {
  /** Folgennummer — steuert, welcher Einstiegs- und Schluss-Modus dran ist
   *  (s. lib/podcast/openers.ts). Fehlt sie, greift die Tages-Nummer im Jahr. */
  episodeNumber?: number
  postId: string
  locale?: string
  durationMinutes?: number
  customPrompt?: string
  smalltalkTopic?: string
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
      return content // Return as-is if not JSON
    }
  }

  if (typeof content !== 'object') return ''

  const node = content as { type?: string; content?: unknown[]; text?: string }

  // Text node - return the text
  if (node.type === 'text' && node.text) {
    return node.text
  }

  // Has content array - recurse
  if (Array.isArray(node.content)) {
    const texts: string[] = []
    for (const child of node.content) {
      const text = extractTextFromTiptap(child)
      if (text.trim()) {
        texts.push(text)
      }
    }
    // Join with appropriate separator based on node type
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

export async function POST(request: NextRequest) {
  // Auth check - only admin can generate scripts
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const body: GenerateScriptRequest = await request.json()

    if (!body.postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const locale = body.locale || 'de'
    const ttsLang = LOCALE_TO_TTS_LANG[locale] || 'en'

    // Get TTS settings for duration
    const settings = await getTTSSettings()
    const durationMinutes = body.durationMinutes || settings.podcast_duration_minutes || 30
    const wordCount = Math.round(durationMinutes * 150)
    const maxWordCount = Math.round(wordCount * 1.25) // hard ceiling: 25% over target
    const perTopicWords = Math.max(80, Math.round(wordCount / 7)) // proportional per-topic budget
    // tokens: proportional to target — podcast scripts with emotion tags,
    // stage directions, and formatting need ~3x tokens per word
    const maxTokens = Math.max(12000, Math.round(maxWordCount * 3.0))

    // Fetch post content
    let postTitle = ''
    let postContent = ''
    let postCreatedAt = ''
    let isWrapup = false

    // Try generated_posts first
    const { data: generatedPost } = await supabase
      .from('generated_posts')
      .select('title, slug, content, created_at')
      .eq('id', body.postId)
      .single()

    if (generatedPost) {
      postTitle = generatedPost.title
      postCreatedAt = generatedPost.created_at
      // Wochenrückblick-Erkennung mit dem DEUTSCHEN Titel und dem Slug, BEVOR
      // eine Übersetzung postTitle überschreibt: der englische Titel enthält
      // das deutsche Muster nicht, die Erkennung liefe sonst bei jedem
      // fremdsprachigen Podcast ins Leere.
      isWrapup = isWeekWrapup(generatedPost.slug, generatedPost.title)

      // If not German, try to get translation
      if (locale !== 'de') {
        const { data: translation, error: translationError } = await supabase
          .from('content_translations')
          .select('title, content')
          .eq('generated_post_id', body.postId)
          .eq('language_code', locale)
          .eq('translation_status', 'completed')
          .single()

        console.log(`[Podcast Script] Translation query for postId=${body.postId}, locale=${locale}:`,
          translation ? `found (title: ${translation.title?.substring(0, 50)}...)` : `not found (error: ${translationError?.message})`)

        if (translation) {
          postTitle = translation.title || postTitle
          postContent = extractTextFromTiptap(translation.content)
          console.log(`[Podcast Script] Using ${locale} translation, content length: ${postContent.length}`)
        } else {
          // Fall back to German content
          postContent = extractTextFromTiptap(generatedPost.content)
          console.log(`[Podcast Script] Falling back to German content, length: ${postContent.length}`)
        }
      } else {
        postContent = extractTextFromTiptap(generatedPost.content)
      }
    } else {
      // Try manual posts table
      const { data: manualPost } = await supabase
        .from('posts')
        .select('title, content, created_at')
        .eq('id', body.postId)
        .single()

      if (manualPost) {
        postTitle = manualPost.title
        postCreatedAt = manualPost.created_at
        postContent = extractTextFromTiptap(manualPost.content)
      } else {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 })
      }
    }

    if (!postContent.trim()) {
      return NextResponse.json({ error: 'Post has no content' }, { status: 400 })
    }

    // Build the prompt - use language-appropriate template
    const defaultPrompt = ttsLang === 'de' ? DEFAULT_SCRIPT_PROMPT_DE : DEFAULT_SCRIPT_PROMPT_EN

    // Use the blog post's created_at date for the podcast greeting (not current date)
    const postDate = postCreatedAt ? new Date(postCreatedAt) : new Date()
    const weekday = postDate.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', { weekday: 'long' })
    const date = locale === 'de'
      ? postDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : postDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    // Folgennummer für die Begrüßung (Betreiber 2026-11-06): dieselbe
    // Ausgabenummer, die die Website über dem Artikel zeigt („synthszr #311“).
    // Ohne Datum des Posts keine Nummer, die Begrüßung bleibt dann wie bisher.
    const publicEpisode = postCreatedAt ? synthszrIssueNumber(postDate) : null
    const episodeSuffix = episodeGreetingSuffix(publicEpisode, ttsLang)

    let prompt = (body.customPrompt || defaultPrompt)
      .replaceAll('{duration}', String(durationMinutes))
      .replaceAll('{wordCount}', String(wordCount))
      .replaceAll('{maxWordCount}', String(maxWordCount))
      .replaceAll('{perTopicWords}', String(perTopicWords))
      .replaceAll('{title}', postTitle)
      .replaceAll('{content}', postContent)
      .replaceAll('{weekday}', weekday)
      .replaceAll('{date}', date)
      .replaceAll('{episodeSuffix}', episodeSuffix)
      // Dialogregeln zur Laufzeit: Admin-Override (nur EN) oder Code-Default.
      // Funktions-Ersetzung, damit „$" im Regeltext nicht als Muster gilt.
      .replaceAll('{dialogueRules}', () => resolveDialogueRules(ttsLang, settings.podcast_dialogue_rules_en))
      // Tonalität v2 der beiden Stimmen und Folgenaufbau (lib/podcast/voice-style.ts).
      .replaceAll('{voiceStyle}', () => (ttsLang === 'de' ? VOICE_STYLE_DE : VOICE_STYLE_EN))
      .replaceAll('{episodeShape}', () => (ttsLang === 'de' ? EPISODE_SHAPE_DE : EPISODE_SHAPE_EN))

    // EINSTIEG UND SCHLUSS DIESER FOLGE (Betreiber-Vorgabe 2026-08-15).
    //
    // Angehängt statt in die Vorlage geschrieben — dieselbe Technik wie beim
    // Smalltalk darunter: Das Grundgerüst gilt unverändert, die Modi kommen
    // dazu. So bleibt auch ein eigener customPrompt des Betreibers wirksam und
    // bekommt die Abwechslung trotzdem.
    //
    // Die Modi rotieren über die Episodennummer (s. lib/podcast/openers.ts).
    // Fehlt sie, greift die Tages-Nummer im Jahr: Sie wächst ebenso monoton und
    // vermeidet, dass ohne Nummer jeden Tag derselbe Modus gezogen wird.
    const episodeNo = Number.isFinite(Number(body.episodeNumber))
      ? Number(body.episodeNumber)
      : Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000)
    // Die Modi der laufenden Woche (lib/podcast/mode-generator.ts). Ohne
    // erzeugten Satz greifen die eingebauten — der Podcast entsteht in jedem
    // Fall.
    const { set: modeSet, fallback: modesFallback } = await loadModes(createAdminClient(), ttsLang)
    const opener = pickOpener(episodeNo, modeSet.openers)
    const closer = pickCloser(episodeNo, modeSet.closers)
    prompt = prompt + (ttsLang === 'de'
      ? `\n\n**EINSTIEG DIESER FOLGE (verbindlich):**\n${opener.instruction}\nDer Wiedererkennungssatz ("Hey, Hey und Willkommen bei Synthesizer Daily am ${weekday}, den ${date}${episodeSuffix}!") folgt DANACH — spätestens nach etwa 30 Sekunden.\n\n**SCHLUSS DIESER FOLGE (verbindlich):**\n${closer.instruction}\nDie beiden Pflicht-Elemente (morgen wieder, Weiterempfehlung) gehören hinein, aber NEU formuliert — keine der oben genannten verbrauchten Wendungen.`
      : `\n\n**OPENING OF THIS EPISODE (mandatory):**\n${opener.instruction}\nThe recognisable greeting follows AFTER that — within roughly 30 seconds.\n\n**CLOSING OF THIS EPISODE (mandatory):**\n${closer.instruction}\nBoth mandatory elements (see you tomorrow, please recommend us) must be there, but freshly worded.`)
    // Runde Folgen (350, 400, 450 …) werden gefeiert. Angehängt wie Einstieg
    // und Smalltalk, damit auch ein eigener customPrompt es bekommt.
    prompt = prompt + milestonePromptSection(publicEpisode, ttsLang)
    if (publicEpisode) {
      console.log(`[Podcast Script] Folgennummer ${publicEpisode}${milestoneOf(publicEpisode) !== 'none' ? ' — Jubiläumsfolge' : ''}`)
    }
    console.log(`[Podcast Script] Folge ${episodeNo}: Einstieg "${opener.key}", Schluss "${closer.key}" (Satz: ${modesFallback ? 'eingebaut' : modeSet.week})`)

    // Was zuletzt lief, im Wortlaut — damit sich innerhalb eines Modus nicht
    // dieselbe Formulierung einschleift. Acht Einstiege sind sonst nach ein
    // paar Wochen selbst acht Schablonen.
    const edges = await getRecentEdges(ttsLang)
    prompt = prompt + recentEdgesSection(edges, ttsLang)
    if (edges.openings.length) {
      console.log(`[Podcast Script] ${edges.openings.length} vorige Anfaenge/Schluesse zum Abgleich`)
    }

    // Wochenrückblick: Haltung der beiden Stimmen anpassen. Angehängt statt in
    // die Vorlage geschrieben, weil das Grundgerüst (Länge, Format,
    // Sprecherwechsel, Personality) unverändert gelten soll — nur die Haltung
    // kommt dazu. Dasselbe Muster wie beim Smalltalk-Abschnitt darunter.
    if (isWrapup) {
      prompt = prompt + wrapupPromptSection(ttsLang)
      console.log(`[Podcast Script] Wochenrückblick erkannt — reflektierender Modus (${ttsLang})`)
    }

    // Inject optional smalltalk section
    if (body.smalltalkTopic?.trim()) {
      const smalltalkSection = ttsLang === 'de'
        ? `\n\n**SMALLTALK AM ANFANG (PFLICHT):**\nNach der Begrüßung und dem kurzen Themen-Teaser sprechen HOST und GUEST kurz (~1-2 Minuten) locker über folgendes Thema, BEVOR es ins Hauptthema geht:\n"${body.smalltalkTopic}"\nDieser Smalltalk soll natürlich und persönlich wirken. Danach leitet der HOST nahtlos zum Hauptthema über.`
        : `\n\n**SMALLTALK AT THE START (MANDATORY):**\nAfter the greeting and the brief topic tease, HOST and GUEST briefly (~1-2 minutes) chat casually about the following topic BEFORE getting into the main content:\n"${body.smalltalkTopic}"\nThis smalltalk should feel natural and personal. Afterwards, HOST transitions smoothly into the main topic.`
      prompt = prompt + smalltalkSection
    }

    // Build personality brief as system prompt (not appended to user message)
    // System prompt gets highest attention from the model — critical for longing/connection moments
    const personalityState = await getPersonalityState(ttsLang)
    const personalityBrief = buildPersonalityBrief(personalityState)

    // Episode memory: the last three episodes + up to five semantically
    // similar earlier episodes for callbacks and position consistency.
    // Memory belongs in the SYSTEM prompt next to personality — the user
    // prompt gets diluted by news content and the model deprioritizes it.
    // Fail-soft: missing memory just means a less self-aware episode.
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
      if (memoryBrief) {
        console.log(`[Podcast Script] Memory brief built (${recent.length} recent + ${similar.length} similar episodes, awakening=${announceAwakening})`)
      }
    } catch (memErr) {
      console.warn('[Podcast Script] Memory retrieval failed (continuing without):', memErr)
    }

    // Generate script with Claude
    const anthropic = withUsageLogging(new Anthropic(), 'podcast_script')
    const podcastModel = await getModelForUseCase('podcast_script')

    console.log(`[Podcast Script] Generating ${durationMinutes}min script for post ${body.postId} in ${locale} (episode #${personalityState.episode_count + 1}, phase: ${personalityState.relationship_phase}, flirt: ${personalityState.flirtation_tendency.toFixed(2)}, comfort: ${personalityState.mutual_comfort.toFixed(2)})`)

    console.log(`[Podcast Script] Target: ${wordCount} words, max_tokens: ${maxTokens}, model: ${podcastModel}`)

    const systemPrompt = memoryBrief
      ? `${personalityBrief}\n\n${memoryBrief}`
      : personalityBrief

    const callModel = async (model: string) => {
      const stream = anthropic.messages.stream({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        // Denken aus, wo das Modell es erlaubt; sonst Budget-Spielraum (s. script-diagnostics.ts).
        ...scriptRequestBudget(model, maxTokens),
      })
      return stream.finalMessage()
    }

    let message = await callModel(podcastModel)

    // Befund 2026-10-29: Opus 5.5 bricht bei dieser Aufgabe immer wieder mit
    // stop_reason refusal ab (Klassifizierer greift während des Denkens) oder
    // verbraucht das Budget mit Denken. Ein Versuch mit Opus 5 und
    // abgeschaltetem Denken liefert das Skript; das Hauptmodell bleibt wählbar.
    if (!extractScriptText(message).trim() && shouldRetryWithFallback(message)) {
      const fallback = fallbackModelFor(podcastModel)
      if (fallback) {
        console.warn(`[Podcast Script] ${podcastModel}: ${describeEmptyScript(message, maxTokens)} — zweiter Versuch mit ${fallback}`)
        message = await callModel(fallback)
      }
    }

    // Extract text from response
    const scriptContent = extractScriptText(message)

    if (message.stop_reason === 'max_tokens') {
      console.warn(`[Podcast Script] WARNING: Script truncated at max_tokens (${maxTokens}). Output used ${message.usage?.output_tokens} tokens.`)
    }

    if (!scriptContent.trim()) {
      // Befund 2026-10-29: ohne stop_reason und Blocktypen ist eine leere
      // Antwort nicht von einer Verweigerung oder einem verbrauchten
      // Denkbudget zu unterscheiden.
      const reason = describeEmptyScript(message, maxTokens)
      console.error(`[Podcast Script] ${reason}`)
      return NextResponse.json({ error: reason }, { status: 500 })
    }

    // Post-generation guarantee: the main model ignores rule #15
    // (set an [INTERMEZZO] marker at the self-reflection beat) almost
    // every time. A second pass with Haiku locates the strongest
    // self-reflection line and splices the marker in. Fail-soft.
    const scriptWithMarker = await ensureIntermezzoMarker(scriptContent, ttsLang)

    // NOTE: Personality evolution (advanceState) happens in jobs/process/route.ts
    // AFTER the podcast audio is successfully generated — not here at script generation time.
    // This prevents test scripts from advancing the personality state.

    // Keep ---MOMENTS--- section in the script so advanceState() can extract
    // memorable moments when the job is processed. The TTS pipeline's parseScriptText()
    // only picks up HOST:/GUEST: lines, so the MOMENTS section is safely ignored.

    // Count lines and estimate duration (exclude MOMENTS section for accuracy)
    const scriptForStats = stripMomentsSection(scriptWithMarker)
    const lines = scriptForStats.split('\n').filter(line =>
      line.trim().match(/^(HOST|GUEST)\s*(?:\(overlapping\))?\s*:/i)
    )
    const totalWords = scriptForStats.split(/\s+/).length
    const estimatedDuration = Math.round(totalWords / 150)

    console.log(`[Podcast Script] Generated ${lines.length} lines, ~${estimatedDuration}min`)

    return NextResponse.json({
      success: true,
      script: scriptWithMarker,
      lineCount: lines.length,
      wordCount: totalWords,
      estimatedDuration,
      locale,
      ttsLang,
    })
  } catch (error) {
    console.error('[Podcast Script] Generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/podcast/generate-script
 * Get the default prompt template
 */
export async function GET() {
  const settings = await getTTSSettings()

  return NextResponse.json({
    defaultPrompt: DEFAULT_SCRIPT_PROMPT,
    defaultDuration: settings.podcast_duration_minutes,
    locales: Object.keys(LOCALE_TO_TTS_LANG),
    ttsMapping: LOCALE_TO_TTS_LANG,
  })
}
