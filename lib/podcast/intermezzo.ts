/**
 * Post-generation guarantee for the [INTERMEZZO] marker AND its
 * surrounding self-reflection block.
 *
 * The audio mixer fades background music in at the [INTERMEZZO] line.
 * For that to feel intentional, the model has to deliver a short
 * reflective dialog under the music — HOST and GUEST talking about
 * themselves, the format, the meta-layer. Without that dialog, the
 * music swells under a hard cut between news items, which is what
 * Mattes saw on the May 22 run.
 *
 * Pipeline now does both jobs:
 *
 *   1. Strip any [INTERMEZZO] line the main model put down on its
 *      own — placement is unreliable.
 *   2. Find [ARTICLE 5] (or the middle article if fewer than 5).
 *   3. Generate a fresh self-reflection block with Haiku, using the
 *      lines immediately before [ARTICLE 5] as context so the
 *      reflection grows out of what was just discussed.
 *   4. Splice in: [INTERMEZZO]\n<reflection lines>\n directly before
 *      [ARTICLE 5]. The marker triggers the music; the reflection
 *      lines sit under it; then the next article fades the music out.
 *
 * Fail-soft at every step: if the LLM call fails or returns nothing
 * usable, we still write the [INTERMEZZO] marker on its own so the
 * mixer doesn't skip the music entirely.
 */

import Anthropic from '@anthropic-ai/sdk'

/** TTS language of the podcast (LOCALE_TO_TTS_LANG collapses to 'de' | 'en'). */
export type IntermezzoLanguage = 'de' | 'en'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const ARTICLE_LINE_REGEX = /^\[\s*ARTICLE\s+(\d+)\s*\]\s*$/gim
// How many lines before [ARTICLE 5] to feed Haiku as context.
const CONTEXT_LINES_BEFORE = 16

export async function ensureIntermezzoMarker(
  script: string,
  language: IntermezzoLanguage = 'de',
): Promise<string> {
  if (!script.trim()) return script

  // Strip any [INTERMEZZO] line the model placed on its own — its
  // judgement is not trustworthy, we'll re-anchor deterministically.
  const cleaned = script.replace(/^\[\s*INTERMEZZO\s*\]\s*\n?/gim, '')

  // Collect every [ARTICLE N] marker so we can pick either the explicit
  // #5 anchor or — when the podcast is shorter — the middle article.
  const articles: Array<{ n: number; index: number }> = []
  ARTICLE_LINE_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_LINE_REGEX.exec(cleaned))) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n)) {
      articles.push({ n, index: m.index })
    }
  }

  if (articles.length === 0) {
    console.warn('[Intermezzo] No [ARTICLE N] markers in script — leaving without marker (mixer will skip)')
    return cleaned
  }

  // Anchor: [ARTICLE 5] when present, otherwise the middle article.
  let anchor = articles.find((a) => a.n === 5)
  let anchorReason = 'directly before [ARTICLE 5]'
  if (!anchor) {
    const midIdx = Math.floor((articles.length - 1) / 2)
    anchor = articles[midIdx]
    anchorReason = `no [ARTICLE 5] found, using middle article [ARTICLE ${anchor.n}] (${articles.length} articles total)`
  }

  // Build the self-reflection block. The model uses the news block just
  // before [ARTICLE 5] as context so the reflection grows out of what
  // was actually discussed (Y-Combinator / platform capitalism in the
  // typical Daily layout), rather than feeling like a non-sequitur.
  const beforeArticle5 = cleaned.slice(0, anchor.index)
  const afterArticle5 = cleaned.slice(anchor.index)
  const reflectionBlock = await generateReflectionBlock(beforeArticle5, afterArticle5, language)

  const insertion = reflectionBlock
    ? `[INTERMEZZO]\n${reflectionBlock}\n`
    : '[INTERMEZZO]\n'

  const result = beforeArticle5 + insertion + afterArticle5
  console.log(
    `[Intermezzo] Inserted marker ${anchorReason}` +
      (reflectionBlock ? ` + ${reflectionBlock.split('\n').length}-line reflection block` : ' (no reflection block — Haiku unavailable)')
  )
  return result
}

/**
 * Generate a short HOST/GUEST self-reflection dialog that sits between
 * article 4 and article 5 (or whichever block precedes the anchor),
 * under the intermezzo music. Returns the raw dialog lines (no
 * leading or trailing newlines). Returns null when the LLM call
 * fails — caller still writes the marker on its own.
 */
async function generateReflectionBlock(
  beforeAnchor: string,
  afterAnchor: string,
  language: IntermezzoLanguage,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[Intermezzo] No ANTHROPIC_API_KEY — skipping reflection block')
    return null
  }

  // Grab the trailing dialog of the previous article as context so the
  // reflection sounds like it's growing out of the conversation.
  const trailingLines = beforeAnchor
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-CONTEXT_LINES_BEFORE)
    .join('\n')

  // First HOST/GUEST line of the next article so the reflection can
  // taper organically toward it without overlapping topics.
  const leadingLines = afterAnchor
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 6)
    .join('\n')

  try {
    const anthropic = new Anthropic({ apiKey })
    const prompt = buildReflectionPrompt(trailingLines, leadingLines, language)
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!raw) return null

    // Keep only valid HOST/GUEST lines. Drops any stray prose or
    // markers Haiku might invent.
    const cleanLines = raw
      .split('\n')
      .map((l) => l.replace(/^\s+/, ''))
      .filter((l) => /^(HOST|GUEST)\s*(?:\(overlapping\))?\s*:/i.test(l) || /^\[(beat|short pause|longer pause|paper rustle|sip)\]/i.test(l))

    if (cleanLines.length < 3) {
      console.warn('[Intermezzo] Haiku reflection block too short, falling back to bare marker', {
        rawPreview: raw.slice(0, 160),
        clean: cleanLines.length,
      })
      return null
    }

    return cleanLines.join('\n')
  } catch (err) {
    console.warn('[Intermezzo] Reflection generation failed (non-fatal):', err)
    return null
  }
}

/** Maps the podcast's TTS language to the language the reflection dialog must
 *  be spoken in. Kept binary because LOCALE_TO_TTS_LANG collapses everything to
 *  'de' | 'en' (cs/nds ride the English template). */
function dialogLanguageName(language: IntermezzoLanguage): string {
  return language === 'de' ? 'German' : 'English'
}

/**
 * The instruction container is written in English on purpose: a German prompt
 * with a German few-shot example dragged the reflection block into German even
 * when the podcast was English (observed 2026-07-11). English meta-instructions
 * are drift-resistant, and the target language is stated explicitly + mirrored
 * from the context so it always matches the surrounding podcast.
 */
export function buildReflectionPrompt(
  trailingLines: string,
  leadingLines: string,
  language: IntermezzoLanguage = 'de',
): string {
  const lang = dialogLanguageName(language)
  return `You are writing a short self-reflection dialog for a tech podcast with two AI voices (HOST and GUEST). It sits under an intermezzo (background music fades in, runs under the dialog, fades out to the next topic).

LANGUAGE — CRITICAL: Write every spoken word of the dialog in ${lang}. The rest of this podcast is in ${lang} and the intermezzo MUST match it exactly — never switch languages mid-episode. Mirror the language of the CONTEXT lines below (they are in ${lang}). The ONLY English elements allowed are the speech-direction tags inside square brackets (e.g. [reflective, slower delivery]); every actual word HOST and GUEST say is ${lang}.

CONTENT: HOST and GUEST talk about themselves — their role as AI voices, the meta-layer of the conversation, a human studio moment, or a brief reflection on what they just discussed. The transition should grow organically out of the last block (do NOT abruptly change topic) and taper gently toward the next topic.

LENGTH: 6-10 lines, alternating HOST and GUEST. Tone calm, intimate, sometimes dryly humorous. One open question, one honest observation, one concrete moment.

FORMAT (mandatory):
- Each line starts with "HOST:" or "GUEST:" followed by an emotion tag in square brackets, then the spoken text in ${lang}.
- The bracketed direction tag stays English; the spoken text is ${lang}. Example shape (write yours in ${lang}): HOST: [reflective, slower delivery] <one reflective sentence in ${lang}>
- Directions like [short pause], [beat], [paper rustle], [sip] are allowed as their own line.
- No markdown, no preamble, no explanation. ONLY the dialog lines.

CONTEXT FROM THE PREVIOUS BLOCK (build on this — same language as your output):
${trailingLines}

CONTEXT FROM THE NEXT BLOCK (taper gently toward this — do NOT overlap):
${leadingLines}

Write the dialog now, entirely in ${lang}. Only the lines, nothing else.`
}
