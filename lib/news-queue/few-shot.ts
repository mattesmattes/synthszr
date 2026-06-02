import type { RankingCandidate, LabelExample } from './ranking-types'

/**
 * Build the listwise reranker prompt. Candidates are presented with their
 * raw stage-1 signals (InsertRank trick). Positive/negative examples teach
 * Mattes' taste few-shot. The caller is expected to SHUFFLE `candidates`
 * before calling to mitigate positional bias.
 */
export function buildRerankerPrompt(
  candidates: RankingCandidate[],
  positives: LabelExample[],
  negatives: LabelExample[],
  targetCount: number
): string {
  const parts: string[] = []

  parts.push(
    `Du bist Mattes' redaktioneller Co-Pilot für einen Tech-/Business-Newsletter.`,
    `Wähle aus den KANDIDATEN die ${targetCount} relevantesten Artikel nach Mattes' Geschmack aus und ordne sie.`,
    `Bevorzuge substanzielle, originelle Tech-/Business-Themen; meide Werbung, Rätsel, Listicles, Geraune.`,
    ``
  )

  if (positives.length > 0 || negatives.length > 0) {
    parts.push(`## FRÜHER AUSGEWÄHLT (positiv — solche Themen will Mattes):`)
    for (const ex of positives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``, `## FRÜHER IGNORIERT (negativ — solche Themen will Mattes NICHT):`)
    for (const ex of negatives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``)
  }

  parts.push(`## KANDIDATEN:`)
  for (const c of candidates) {
    const preview = (c.excerpt || '').slice(0, 200)
    parts.push(
      `- id=${c.queueItemId} | score=${c.totalScore.toFixed(1)} sim=${c.winnerSimilarity.toFixed(2)}` +
        ` | ${c.title}${c.source ? ` [${c.source}]` : ''}${preview ? `\n    ${preview}` : ''}`
    )
  }

  parts.push(
    ``,
    `Antworte AUSSCHLIESSLICH mit einem JSON-Array von genau den ${targetCount} besten,`,
    `Form: [{"queueItemId":"<id>","rank":1,"reason":"<kurze Begründung>","confidence":0.0-1.0}, ...].`,
    `Nur ids aus der Kandidatenliste. Keine Erklärung außerhalb des JSON, kein Markdown.`
  )

  return parts.join('\n')
}
