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

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'
import { getTTSSettings } from '@/lib/tts/openai-tts'
import Anthropic from '@anthropic-ai/sdk'

// TTS language mapping for podcast generation
const LOCALE_TO_TTS_LANG: Record<string, 'de' | 'en'> = {
  de: 'de',
  en: 'en',
  cs: 'en',
  nds: 'en',
}

// Default podcast script prompt template - GERMAN
const DEFAULT_SCRIPT_PROMPT_DE = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch auf DEUTSCH zwischen einem Host und einem Gast für den "Synthesizer Daily" Podcast.

**WICHTIG - Podcast-Name und Begrüßung:**
- Der Podcast heißt IMMER "Synthesizer Daily" - NIEMALS andere Namen wie "TechFinance Daily" oder ähnliche Fantasienamen verwenden!
- Die Begrüßung MUSS den Wochentag und das Datum enthalten: "Willkommen bei Synthesizer Daily am {weekday}, den {date}..."

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthesizer - der AI-Analyst mit pointierten Meinungen

**Output-Format (WICHTIG - exakt dieses Format verwenden):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...

**Verfügbare Emotion-Tags:**
- [cheerfully] - fröhlich, begeistert
- [thoughtfully] - nachdenklich, überlegend
- [seriously] - ernst, wichtig
- [excitedly] - aufgeregt, enthusiastisch
- [skeptically] - skeptisch, hinterfragend
- [laughing] - lachend
- [sighing] - seufzend
- [curiously] - neugierig
- [interrupting] - unterbrechend (für Überlappung)

**Stilregeln für natürliche, lebendige Dialoge:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du...", "Naja..."
2. WICHTIG - Häufige Unterbrechungen: Nutze [interrupting] oft! Beide Sprecher sollen sich gegenseitig unterbrechen, wie in einem echten Gespräch
3. Kurze Reaktionen WÄHREND der andere spricht: "Mhm!", "Ja!", "Genau!", "Ach wirklich?", "Oh!"
4. Satzfragmente und abgebrochene Sätze: "Das ist doch—" "[interrupting] Genau das meine ich!"
5. Überlappende Zustimmung: Wenn einer erklärt, wirft der andere kurze Bestätigungen ein
6. Pausen mit "..." für Denkpausen
7. Variiere die Satzlänge stark - sehr kurze Einwürfe (1-3 Wörter) zwischen längeren Erklärungen
8. Der GUEST (Synthszr) sollte die "Synthszr Take" Meinungen einbringen
9. Mindestens 30% der Zeilen sollten [interrupting] oder sehr kurze Reaktionen sein

**WICHTIG - Verabschiedung am Ende:**
Der Podcast MUSS mit einer freundlichen Verabschiedung enden, die folgende Elemente enthält:
- Hinweis, dass wir uns morgen wiedersehen/wiederhören
- Bitte an die Hörer, den Podcast Freunden weiterzuempfehlen
Beispiel: "Wir sehen uns morgen wieder! Und wenn euch die Folge gefallen hat, empfehlt uns gerne weiter."

**Ziel-Länge:** {duration} Minuten (ca. {wordCount} Wörter)

**Blog-Artikel Content für diese Episode:**
---
Titel: {title}

{content}
---

WICHTIG: Das gesamte Skript MUSS auf DEUTSCH sein!
Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung.`

// Default podcast script prompt template - ENGLISH
const DEFAULT_SCRIPT_PROMPT_EN = `You are an experienced podcast script writer. Create a lively, natural conversation in ENGLISH between a host and a guest for the "Synthesizer Daily" podcast.

**CRITICAL LANGUAGE REQUIREMENT:**
The source content below may be in German or another language. You MUST translate all content and create the entire podcast script in ENGLISH. Do not use any German words or phrases in your output.

**IMPORTANT - Podcast Name and Greeting:**
- The podcast is ALWAYS called "Synthesizer Daily" - NEVER use other names like "TechFinance Daily" or similar fantasy names!
- The greeting MUST include the weekday and date: "Welcome to Synthesizer Daily on {weekday}, {date}..."

**Roles:**
- HOST: Moderates the conversation, asks questions, summarizes
- GUEST: Synthesizer - the AI analyst with pointed opinions

**Output Format (IMPORTANT - use exactly this format):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...

**Available Emotion Tags:**
- [cheerfully] - happy, enthusiastic
- [thoughtfully] - reflective, considering
- [seriously] - serious, important
- [excitedly] - excited, enthusiastic
- [skeptically] - skeptical, questioning
- [laughing] - laughing
- [sighing] - sighing
- [curiously] - curious
- [interrupting] - interrupting (for overlap effect)

**Style Rules for Natural, Lively Dialogue:**
1. Use filler words: "Well...", "Hmm...", "You know...", "I mean..."
2. IMPORTANT - Frequent interruptions: Use [interrupting] often! Both speakers should interrupt each other, like in a real conversation
3. Short reactions WHILE the other speaks: "Mhm!", "Yeah!", "Exactly!", "Oh really?", "Oh!"
4. Sentence fragments and cut-off sentences: "That's just—" "[interrupting] Exactly what I mean!"
5. Overlapping agreement: When one explains, the other throws in short confirmations
6. Pauses with "..." for thinking
7. Vary sentence length dramatically - very short interjections (1-3 words) between longer explanations
8. GUEST (Synthszr) should bring in the "Synthszr Take" opinions
9. At least 30% of lines should be [interrupting] or very short reactions

**IMPORTANT - Closing/Outro:**
The podcast MUST end with a friendly farewell that includes:
- Mention that we'll see/hear each other again tomorrow
- Ask listeners to recommend the podcast to their friends
Example: "We'll see you again tomorrow! And if you enjoyed this episode, please share it with your friends."

**Target Length:** {duration} minutes (approx. {wordCount} words)

**Blog Article Content for this Episode (translate to English if not already in English):**
---
Title: {title}

{content}
---

REMEMBER: Output the ENTIRE script in ENGLISH only. Start directly with "HOST:" - no introduction.`

// Legacy alias for backwards compatibility
const DEFAULT_SCRIPT_PROMPT = DEFAULT_SCRIPT_PROMPT_DE

interface GenerateScriptRequest {
  postId: string
  locale?: string
  durationMinutes?: number
  customPrompt?: string
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

    const supabase = await createClient()
    const locale = body.locale || 'de'
    const ttsLang = LOCALE_TO_TTS_LANG[locale] || 'en'

    // Get TTS settings for duration
    const settings = await getTTSSettings()
    const durationMinutes = body.durationMinutes || settings.podcast_duration_minutes || 30
    const wordCount = Math.round(durationMinutes * 150)

    // Fetch post content
    let postTitle = ''
    let postContent = ''

    // Try generated_posts first
    const { data: generatedPost } = await supabase
      .from('generated_posts')
      .select('title, content')
      .eq('id', body.postId)
      .single()

    if (generatedPost) {
      postTitle = generatedPost.title

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
        .select('title, content')
        .eq('id', body.postId)
        .single()

      if (manualPost) {
        postTitle = manualPost.title
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

    // Generate weekday and date for podcast greeting
    const now = new Date()
    const weekday = now.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', { weekday: 'long' })
    const date = now.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })

    const prompt = (body.customPrompt || defaultPrompt)
      .replace('{duration}', String(durationMinutes))
      .replace('{wordCount}', String(wordCount))
      .replace('{title}', postTitle)
      .replace('{content}', postContent)
      .replace('{weekday}', weekday)
      .replace('{date}', date)

    // Generate script with Claude
    const anthropic = new Anthropic()

    console.log(`[Podcast Script] Generating ${durationMinutes}min script for post ${body.postId} in ${locale}`)

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Extract text from response
    const scriptContent = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n')

    if (!scriptContent.trim()) {
      return NextResponse.json({ error: 'AI generated empty script' }, { status: 500 })
    }

    // Count lines and estimate duration
    const lines = scriptContent.split('\n').filter(line =>
      line.trim().match(/^(HOST|GUEST):/i)
    )
    const totalWords = scriptContent.split(/\s+/).length
    const estimatedDuration = Math.round(totalWords / 150)

    console.log(`[Podcast Script] Generated ${lines.length} lines, ~${estimatedDuration}min`)

    return NextResponse.json({
      success: true,
      script: scriptContent,
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
