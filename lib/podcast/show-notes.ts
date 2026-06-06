import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'

/**
 * Deterministic fallback: keep whole sentences until ~50% of the word count
 * is reached, append an ellipsis. Used when the LLM summary is unavailable.
 */
export function truncateToHalf(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S+$/g) ?? [trimmed]
  if (sentences.length <= 1) return trimmed
  const totalWords = trimmed.split(/\s+/).length
  const target = Math.max(1, Math.round(totalWords / 2))
  let out = ''
  let words = 0
  for (const s of sentences) {
    const sentenceWords = s.trim().split(/\s+/).length
    if (words > 0 && words + sentenceWords > target) break
    out += s
    words += sentenceWords
  }
  out = out.trim()
  if (!out) out = sentences[0].trim()
  return out.replace(/[.!?]+$/, '') + '…'
}

/**
 * Summarize podcast show notes to ~50% of their length via Haiku.
 * Fail-soft: on any error returns truncateToHalf(text).
 */
export async function summarizeShowNotes(text: string, locale: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return truncateToHalf(trimmed)

  const langName = locale === 'de' ? 'German' : 'the same language as the input'
  try {
    const anthropic = new Anthropic({ apiKey })
    const targetWords = Math.max(15, Math.round(trimmed.split(/\s+/).length / 2))
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Shorten these podcast show notes to about ${targetWords} words (roughly half). `
          + `Keep the most compelling hook and concrete facts/numbers. Write in ${langName}, `
          + `coherent prose (no bullet points), no preamble — return only the shortened text.\n\n${trimmed}`,
      }],
    })
    const out = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('').trim()
    return out || truncateToHalf(trimmed)
  } catch (err) {
    console.warn('[ShowNotes] summarize failed, using truncate fallback', err)
    return truncateToHalf(trimmed)
  }
}
