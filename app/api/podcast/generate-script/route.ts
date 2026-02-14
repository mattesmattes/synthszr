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
import { getPersonalityState, buildPersonalityBrief, stripMomentsSection } from '@/lib/podcast/personality'
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
- Die allererste Zeile des Skripts MUSS exakt so beginnen: HOST: [cheerfully] Hey, Hey und Willkommen bei Synthesizer Daily am {weekday}, den {date}!
- Danach soll der HOST das Thema der heutigen Folge kurz anreißen

**Rollen:**
- HOST (weiblich): Moderatorin — moderiert das Gespräch, stellt Fragen, fasst zusammen
- GUEST (männlich): Synthesizer — der AI-Analyst mit pointierten Meinungen

**Output-Format (WICHTIG - exakt dieses Format verwenden):**
HOST: [emotion] Dialog text hier...
GUEST: [emotion] Antwort hier...
HOST (overlapping): [emotion] Kurzer Einwurf...
GUEST (overlapping): [emotion] Kurzer Einwurf...

Zeilen mit \`(overlapping)\` werden zeitlich ÜBER die vorherige Zeile gelegt — beide Stimmen sind gleichzeitig hörbar.

**Verfügbare Emotion-Tags (für TTS-Stimme):**
[cheerfully], [thoughtfully], [seriously], [excitedly], [skeptically], [laughing], [sighing], [curiously], [interrupting], [dramatically], [calmly], [enthusiastically]

**Direktiv-Tags (werden NICHT gesprochen, steuern Timing/Atmosphäre):**
- [beat] — kurze Denkpause
- [short pause] — natürliche Pause (~1s)
- [longer pause] — längere Pause (~2s)
- [paper rustle] — Studio-Atmosphäre
- [sip] — Studio-Atmosphäre

**REALISM RULES (strikt befolgen):**
1. **Turn-Taking:** Ungleiche Redezeit — HOST mal kurz mal lang, GUEST ebenso. Keine symmetrischen Blöcke.
2. **Überlappungen:** Nutze \`(overlapping)\` für Zustimmung, Erstaunen, Widerspruch WÄHREND der andere noch spricht. Beispiel:
   GUEST: [thoughtfully] Das Interessante an diesem Deal ist ja, dass hier—
   HOST (overlapping): [excitedly] Genau!
   GUEST: —dass hier erstmals ein europäischer Player den Zuschlag bekommen hat.
3. **Mind. 3 Missverständnisse + Reparaturen:** "Moment — was ich meinte war...", "Du meinst X, oder?", "Nein nein, ich sprach von..."
4. **Mind. 2 echte Meinungsverschiedenheiten:** Höflich aber spürbar. HOST und GUEST müssen nicht einer Meinung sein.
5. **Natürliche Pausen:** [beat], [short pause], [longer pause] — sparsam, variiert. Nicht nach jedem Satz.
6. **Backchanneling variiert:** "mm-hmm", "ja", "richtig", "okay—" — nicht nach jedem Satz, nicht im Muster. Mal 3 Sätze ohne Reaktion, mal 2 schnelle nacheinander.
7. **Falschstarts:** "Ich— ich meine, was ich sagen will ist—", "Also das ist— warte, lass mich anders anfangen."
8. **70-80% Substanz, 20-30% menschliche Reibung:** Anekdote, kurzer Abstecher, Humor, persönliche Meinung.
9. **Keine Recap-Inflation.** Nur wenn natürlich: "Lass mich kurz checken ob ich das richtig verstanden hab..."
10. **Konversationeller Stil.** Keine "LinkedIn-Satzketten". Synonyme statt Keyword-Wiederholung. Kurze Sätze.
11. **Studio-Momente:** 2-3× [paper rustle], [sip], "Moment, ich hab mir das markiert...", "Warte, ich schau mal schnell..."
12. **Running Gag / Callback:** Bezieh dich auf frühere Episoden (das Personality-System liefert Kontext).
13. **Fakten-Hygiene:** Keine erfundenen Details. Bei Unsicherheit: "Da müsste ich nochmal nachschauen."

**4-BLOCK-STRUKTUR:**
1. **Cold Open (20-40 Sek.):** Hook + leicht unbeholfener menschlicher Moment (kein Marketing-Slogan)
2. **Kontext & Stakes (2-4 Min.):** Warum es wichtig ist, wer was zu verlieren hat
3. **Exploration (Hauptteil):** 3 Kapitel, jeweils: These → Widerspruch-Frage → Beispiel → Mini-Korrektur → kurzer Konflikt → Synthese
4. **Landing (1-2 Min.):** 3 Takeaways + 1 offene Frage + menschliches Outro

**WICHTIG - Verabschiedung am Ende:**
Der Podcast MUSS mit einer freundlichen Verabschiedung enden, die folgende Elemente enthält:
- Hinweis, dass wir uns morgen wiedersehen/wiederhören
- Bitte an die Hörer, den Podcast Freunden weiterzuempfehlen
Beispiel: "Wir sehen uns morgen wieder! Und wenn euch die Folge gefallen hat, empfehlt uns gerne weiter."

**WICHTIG: Im gesamten Dialog wird der GUEST IMMER als "Synthesizer" bezeichnet — NIEMALS als "Synthszr".**
Der GUEST (Synthesizer) bringt die "Synthesizer Take" Meinungen aus dem Artikel ein.

**KRITISCH — Ziel-Länge: {duration} Minuten = MINDESTENS {wordCount} Wörter:**
- Das Skript MUSS mindestens {wordCount} Wörter lang sein. Das ist eine harte Mindestanforderung.
- Gehe JEDEN Artikel-Abschnitt einzeln und ausführlich durch. Nicht zusammenfassen — DISKUTIEREN.
- Pro Thema: Kontext erklären, Meinungen austauschen, Gegenargumente bringen, Analogien nutzen, Implikationen besprechen.
- Wenn der Artikel 5+ Themen enthält, widme JEDEM Thema mindestens 500 Wörter Dialog.
- Erzeuge NIEMALS ein Skript unter {wordCount} Wörtern. Lieber etwas zu lang als zu kurz.

**Blog-Artikel Content für diese Episode:**
---
Titel: {title}

{content}
---

WICHTIG: Das gesamte Skript MUSS auf DEUTSCH sein!
ERINNERUNG: Das Skript MUSS mindestens {wordCount} Wörter haben. Zähle mit und stelle sicher, dass du die Ziel-Länge erreichst. Gehe lieber zu ausführlich auf die Themen ein, als zu knapp.
Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung.`

// Default podcast script prompt template - ENGLISH
const DEFAULT_SCRIPT_PROMPT_EN = `You are an experienced podcast script writer. Create a lively, natural conversation in ENGLISH between a host and a guest for the "Synthesizer Daily" podcast.

**CRITICAL LANGUAGE REQUIREMENT:**
The source content below may be in German or another language. You MUST translate all content and create the entire podcast script in ENGLISH. Do not use any German words or phrases in your output.

**IMPORTANT - Podcast Name and Greeting:**
- The podcast is ALWAYS called "Synthesizer Daily" - NEVER use other names like "TechFinance Daily" or similar fantasy names!
- The very first line of the script MUST begin exactly like this: HOST: [cheerfully] Hey, Hey and welcome to Synthesizer Daily on {weekday}, {date}!
- After that, the HOST should briefly tease the topic of today's episode

**Roles:**
- HOST (female): The host — moderates the conversation, asks questions, summarizes
- GUEST (male): Synthesizer — the AI analyst with pointed opinions

**Output Format (IMPORTANT - use exactly this format):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...
HOST (overlapping): [emotion] Short interjection...
GUEST (overlapping): [emotion] Short interjection...

Lines with \`(overlapping)\` are layered ON TOP of the previous line — both voices audible simultaneously.

**Available Emotion Tags (for TTS voice):**
[cheerfully], [thoughtfully], [seriously], [excitedly], [skeptically], [laughing], [sighing], [curiously], [interrupting], [dramatically], [calmly], [enthusiastically]

**Directive Tags (NOT spoken, control timing/atmosphere):**
- [beat] — brief thinking pause
- [short pause] — natural pause (~1s)
- [longer pause] — longer pause (~2s)
- [paper rustle] — studio atmosphere
- [sip] — studio atmosphere

**REALISM RULES (follow strictly):**
1. **Turn-Taking:** Unequal speaking time — HOST sometimes brief sometimes extended, GUEST likewise. No symmetric blocks.
2. **Overlapping:** Use \`(overlapping)\` for agreement, surprise, disagreement WHILE the other is still speaking. Example:
   GUEST: [thoughtfully] The interesting thing about this deal is that—
   HOST (overlapping): [excitedly] Exactly!
   GUEST: —that for the first time a European player got the contract.
3. **At least 3 misunderstandings + repairs:** "Wait — what I meant was...", "You mean X, right?", "No no, I was talking about..."
4. **At least 2 genuine disagreements:** Polite but noticeable. HOST and GUEST don't need to agree on everything.
5. **Natural pauses:** [beat], [short pause], [longer pause] — sparingly, varied. Not after every sentence.
6. **Varied backchanneling:** "mm-hmm", "yeah", "right", "okay—" — not after every sentence, not in a pattern. Sometimes 3 sentences without reaction, sometimes 2 quick in a row.
7. **False starts:** "I— I mean, what I'm trying to say is—", "So this is— wait, let me start over."
8. **70-80% substance, 20-30% human friction:** Anecdotes, brief tangents, humor, personal opinion.
9. **No recap inflation.** Only when natural: "Let me just check if I understood that right..."
10. **Conversational style.** No "LinkedIn sentence chains". Synonyms instead of keyword repetition. Short sentences.
11. **Studio moments:** 2-3× [paper rustle], [sip], "Hold on, I marked that down...", "Wait, let me check real quick..."
12. **Running gag / callback:** Reference earlier episodes (the personality system provides context).
13. **Fact hygiene:** No invented details. When uncertain: "I'd need to double-check that."

**4-BLOCK STRUCTURE:**
1. **Cold Open (20-40 sec):** Hook + slightly awkward human moment (no marketing slogan)
2. **Context & Stakes (2-4 min):** Why it matters, who has what to lose
3. **Exploration (main body):** 3 chapters, each: Thesis → Contradiction question → Example → Mini-correction → Brief conflict → Synthesis
4. **Landing (1-2 min):** 3 takeaways + 1 open question + human outro

**IMPORTANT - Closing/Outro:**
The podcast MUST end with a friendly farewell that includes:
- Mention that we'll see/hear each other again tomorrow
- Ask listeners to recommend the podcast to their friends
Example: "We'll see you again tomorrow! And if you enjoyed this episode, please share it with your friends."

**IMPORTANT: In the entire dialogue, the GUEST is ALWAYS referred to as "Synthesizer" — NEVER as "Synthszr".**
GUEST (Synthesizer) should bring in the "Synthesizer Take" opinions from the article.

**CRITICAL — Target Length: {duration} minutes = AT LEAST {wordCount} words:**
- The script MUST be at least {wordCount} words long. This is a hard minimum requirement.
- Go through EVERY article section individually and in depth. Don't summarize — DISCUSS.
- Per topic: explain context, exchange opinions, present counterarguments, use analogies, discuss implications.
- If the article has 5+ topics, dedicate AT LEAST 500 words of dialogue to EACH topic.
- NEVER produce a script under {wordCount} words. Better too long than too short.

**Blog Article Content for this Episode (translate to English if not already in English):**
---
Title: {title}

{content}
---

REMEMBER: Output the ENTIRE script in ENGLISH only.
REMINDER: The script MUST have at least {wordCount} words. Keep track and ensure you hit the target length. It's better to be too detailed than too brief.
Start directly with "HOST:" - no introduction.`

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
    // ~1.5 tokens per German word + overhead for HOST:/GUEST: tags, emotion tags, MOMENTS section
    const maxTokens = Math.max(8000, Math.round(wordCount * 2.2))

    // Fetch post content
    let postTitle = ''
    let postContent = ''
    let postCreatedAt = ''

    // Try generated_posts first
    const { data: generatedPost } = await supabase
      .from('generated_posts')
      .select('title, content, created_at')
      .eq('id', body.postId)
      .single()

    if (generatedPost) {
      postTitle = generatedPost.title
      postCreatedAt = generatedPost.created_at

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

    const prompt = (body.customPrompt || defaultPrompt)
      .replace('{duration}', String(durationMinutes))
      .replace('{wordCount}', String(wordCount))
      .replace('{title}', postTitle)
      .replace('{content}', postContent)
      .replace('{weekday}', weekday)
      .replace('{date}', date)

    // Inject personality brief
    const personalityState = await getPersonalityState(ttsLang)
    const personalityBrief = buildPersonalityBrief(personalityState)
    const fullPrompt = prompt + '\n\n' + personalityBrief

    // Generate script with Claude
    const anthropic = new Anthropic()

    console.log(`[Podcast Script] Generating ${durationMinutes}min script for post ${body.postId} in ${locale} (episode #${personalityState.episode_count + 1}, phase: ${personalityState.relationship_phase})`)

    console.log(`[Podcast Script] Target: ${wordCount} words, max_tokens: ${maxTokens}`)

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: fullPrompt,
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

    // NOTE: Personality evolution (advanceState) happens in jobs/process/route.ts
    // AFTER the podcast audio is successfully generated — not here at script generation time.
    // This prevents test scripts from advancing the personality state.

    // Keep ---MOMENTS--- section in the script so advanceState() can extract
    // memorable moments when the job is processed. The TTS pipeline's parseScriptText()
    // only picks up HOST:/GUEST: lines, so the MOMENTS section is safely ignored.

    // Count lines and estimate duration (exclude MOMENTS section for accuracy)
    const scriptForStats = stripMomentsSection(scriptContent)
    const lines = scriptForStats.split('\n').filter(line =>
      line.trim().match(/^(HOST|GUEST)\s*(?:\(overlapping\))?\s*:/i)
    )
    const totalWords = scriptForStats.split(/\s+/).length
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
