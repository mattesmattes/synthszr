/**
 * Post-generation guarantee that every podcast script has exactly one
 * [INTERMEZZO] marker, placed directly before [ARTICLE 5].
 *
 * History:
 *   - Rule #15 in the script generator asked the LLM to set the marker
 *     at the self-reflection beat. The model ignored it across all
 *     three observed scripts.
 *   - Upgrade to FATAL framing + self-check checkbox: still ignored.
 *   - Haiku post-pass that "finds the strongest self-reflection
 *     moment": ran, but placed the marker after [ARTICLE 10] because
 *     that's where the most intense meta moment actually sat.
 *
 * Mattes wants the marker at a fixed structural position (before
 * news #5), not where the model judges meta to be strongest. So this
 * module now does it deterministically: locate the [ARTICLE 5] line
 * and splice [INTERMEZZO] directly above it. No LLM call needed for
 * the normal case.
 *
 * Fallbacks:
 *   - Script has fewer than 5 articles → pick the middle article.
 *   - Script has no [ARTICLE N] markers at all → leave it without
 *     marker (the mixer skips the intermezzo on its own, which is
 *     preferable to inserting it at a random spot).
 *
 * Any [INTERMEZZO] line the main model produced on its own gets
 * stripped first — its placement is not trustworthy.
 */

const ARTICLE_LINE_REGEX = /^\[\s*ARTICLE\s+(\d+)\s*\]\s*$/gim

export async function ensureIntermezzoMarker(script: string): Promise<string> {
  if (!script.trim()) return script

  // Strip any [INTERMEZZO] markers the model itself might have placed
  // — they're at the wrong position often enough that it's safer to
  // re-anchor deterministically than to trust the model's judgement.
  // Whole-line removal incl. its trailing newline so we don't leave
  // a blank line behind.
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

  const inserted =
    cleaned.slice(0, anchor.index) +
    '[INTERMEZZO]\n' +
    cleaned.slice(anchor.index)
  console.log(`[Intermezzo] Inserted marker ${anchorReason}`)
  return inserted
}
