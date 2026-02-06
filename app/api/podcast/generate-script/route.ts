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
const DEFAULT_SCRIPT_PROMPT_DE = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch auf DEUTSCH zwischen einem Host und einem Gast für einen Finance/Tech-Podcast.

**Rollen:**
- HOST: Moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST: Synthszr - der AI-Analyst mit pointierten Meinungen

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

**Stilregeln für natürliche Dialoge:**
1. Nutze Füllwörter: "Also...", "Hmm...", "Weißt du...", "Naja..."
2. Unterbrechungen mit [interrupting]: GUEST kann HOST unterbrechen
3. Reaktionen: "Genau!", "Interessant!", "Warte mal..."
4. Pausen mit "..." für Denkpausen
5. Variiere die Satzlänge - kurze Einwürfe, längere Erklärungen
6. Der GUEST (Synthszr) sollte die "Synthszr Take" Meinungen einbringen

**Ziel-Länge:** {duration} Minuten (ca. {wordCount} Wörter)

**Blog-Artikel Content für diese Episode:**
---
Titel: {title}

{content}
---

WICHTIG: Das gesamte Skript MUSS auf DEUTSCH sein!
Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung.`

// Default podcast script prompt template - ENGLISH
const DEFAULT_SCRIPT_PROMPT_EN = `You are an experienced podcast script writer. Create a lively, natural conversation in ENGLISH between a host and a guest for a Finance/Tech podcast.

**CRITICAL LANGUAGE REQUIREMENT:**
The source content below may be in German or another language. You MUST translate all content and create the entire podcast script in ENGLISH. Do not use any German words or phrases in your output.

**Roles:**
- HOST: Moderates the conversation, asks questions, summarizes
- GUEST: Synthszr - the AI analyst with pointed opinions

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

**Style Rules for Natural Dialogue:**
1. Use filler words: "Well...", "Hmm...", "You know...", "I mean..."
2. Interruptions with [interrupting]: GUEST can interrupt HOST
3. Reactions: "Exactly!", "Interesting!", "Wait..."
4. Pauses with "..." for thinking
5. Vary sentence length - short interjections, longer explanations
6. GUEST (Synthszr) should bring in the "Synthszr Take" opinions

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
    const durationMinutes = body.durationMinutes || settings.podcast_duration_minutes || 15
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
        const { data: translation } = await supabase
          .from('content_translations')
          .select('title, content')
          .eq('generated_post_id', body.postId)
          .eq('language_code', locale)
          .eq('translation_status', 'completed')
          .single()

        if (translation) {
          postTitle = translation.title || postTitle
          postContent = extractTextFromTiptap(translation.content)
        } else {
          // Fall back to German content
          postContent = extractTextFromTiptap(generatedPost.content)
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
    const prompt = (body.customPrompt || defaultPrompt)
      .replace('{duration}', String(durationMinutes))
      .replace('{wordCount}', String(wordCount))
      .replace('{title}', postTitle)
      .replace('{content}', postContent)

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
