/**
 * Post-generation guarantee that every podcast script has exactly one
 * [INTERMEZZO] marker.
 *
 * History:
 *   - Rule #15 in the script generator asked the LLM to set the marker
 *     at the self-reflection beat. The model ignored it across all
 *     three observed scripts (Money Makes the World, 22.05.).
 *   - Rule was upgraded to mandatory with a FATAL framing, a concrete
 *     pseudo-script example, and a self-check checkbox. Still ignored
 *     in the next generation.
 *
 * This module exists because we can't prompt-engineer the marker into
 * being. It runs after the script comes back from the main model and
 * does two things:
 *
 *   1. If the script already contains [INTERMEZZO] — leave it alone.
 *   2. Otherwise call Claude Haiku with the script + a focused
 *      instruction: identify the strongest self-reflection moment,
 *      return the verbatim HOST:/GUEST: line that block opens with.
 *      We then splice [INTERMEZZO] in directly before that line.
 *
 * Fail-soft: any error returns the script unchanged so the podcast
 * pipeline never breaks because of a missing marker.
 */

import Anthropic from '@anthropic-ai/sdk'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const INTERMEZZO_REGEX = /^\[\s*INTERMEZZO\s*\]\s*$/im

export async function ensureIntermezzoMarker(script: string): Promise<string> {
  if (!script.trim()) return script
  if (INTERMEZZO_REGEX.test(script)) {
    console.log('[Intermezzo] Marker already present, skipping insertion pass')
    return script
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[Intermezzo] ANTHROPIC_API_KEY missing, cannot guarantee marker')
    return script
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const prompt = buildInsertionPrompt(script)
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    const target = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      // Strip wrapping quotes if the model decides to add them
      .replace(/^["“„'`]+|["”"'`]+$/g, '')
      .trim()

    if (!target) {
      console.warn('[Intermezzo] Haiku returned empty target line')
      return script
    }

    // Locate the target line exactly. The model occasionally trims
    // trailing whitespace or paraphrases tags — handle the common
    // discrepancies before giving up.
    const idx = locateLine(script, target)
    if (idx < 0) {
      console.warn('[Intermezzo] Target line not found verbatim, skipping insertion', {
        targetPreview: target.slice(0, 120),
      })
      return script
    }

    const inserted = script.slice(0, idx) + '[INTERMEZZO]\n' + script.slice(idx)
    console.log(`[Intermezzo] Inserted marker before line: "${target.slice(0, 80)}…"`)
    return inserted
  } catch (err) {
    console.warn('[Intermezzo] Marker insertion pass failed (non-fatal):', err)
    return script
  }
}

function buildInsertionPrompt(script: string): string {
  return `Du bekommst ein deutsches oder englisches Podcast-Skript mit zwei Stimmen (HOST und GUEST). Im Skript fehlt der \`[INTERMEZZO]\`-Marker, den der Audio-Mixer braucht, um Hintergrundmusik einzublenden.

Deine Aufgabe: Finde den STÄRKSTEN Selbstreflexions-Moment im Skript — die Stelle, wo HOST und GUEST anfangen, über sich selbst zu reden (ihre KI-Natur, das Format selbst, die Meta-Ebene des Gesprächs, einen menschlichen Studio-Moment). Der Marker wird DIREKT VOR diesen Moment gesetzt, sodass die Musik exakt mit Beginn der Reflexion einsetzt.

Bevorzugt befindet sich diese Stelle ungefähr in der Mitte des Podcasts (zwischen News #4 und News #6). Falls die mittlere Sektion keine geeignete Selbstreflexion enthält, wähle die nächstbeste Stelle.

ANTWORT-FORMAT (verbindlich):
- Antworte AUSSCHLIESSLICH mit EINER Zeile aus dem Skript — die exakte HOST:/GUEST:-Zeile, DIREKT VOR der der \`[INTERMEZZO]\`-Marker eingefügt werden soll.
- Die Zeile muss WORTGENAU aus dem Skript stammen (mit Emotion-Tags, Klammern, Zeichensetzung — alles 1:1).
- Keine Anführungszeichen, kein Vorwort, keine Erklärung. Nur die Zeile.

SKRIPT:

${script}`
}

/**
 * Find the byte offset of a target line in the script. First try a
 * verbatim substring match; if that fails, try matching just the line
 * after speaker prefix (sometimes Haiku trims the emotion tag).
 */
function locateLine(script: string, target: string): number {
  const direct = script.indexOf(target)
  if (direct >= 0) return direct

  // Fallback 1: find a line that starts with the same speaker+text up
  // to the first 40 chars after the colon. Useful when Haiku slightly
  // paraphrases the emotion tag.
  const trimmed = target.replace(/\s+/g, ' ').trim()
  const lines = script.split('\n')
  let cursor = 0
  for (const line of lines) {
    const norm = line.replace(/\s+/g, ' ').trim()
    if (norm.length > 20 && trimmed.startsWith(norm.slice(0, 30))) {
      return cursor
    }
    if (norm.length > 20 && norm.startsWith(trimmed.slice(0, 30))) {
      return cursor
    }
    cursor += line.length + 1 // +1 for the newline
  }
  return -1
}
