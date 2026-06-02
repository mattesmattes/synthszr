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
  targetCount: number,
  recentlyCovered: string[] = []
): string {
  const parts: string[] = []

  parts.push(
    `Du bist Mattes' redaktioneller Co-Pilot für einen TÄGLICHEN Tech-/Business-NEWS-Newsletter.`,
    `Wähle aus den KANDIDATEN die ${targetCount} wichtigsten NACHRICHTEN des Tages nach Mattes' Geschmack und ordne sie.`,
    `Bevorzuge konkrete Ereignisse: Produktlaunches, Firmen-/Strategie-Moves, Forschungsdurchbrüche, Sicherheitsvorfälle, Marktbewegungen, bemerkenswerte Aussagen relevanter Personen.`,
    `MEIDE strikt: Tutorials, How-Tos, "Roadmaps", "Guides", Cost-Optimization-Listicles, Meinungsstücke ohne Neuigkeit, Werbung, Newsletter-Sektions-Header, Rätsel.`,
    ``
  )

  if (positives.length > 0) {
    parts.push(`## ARTIKEL, DIE MATTES ZULETZT GEWÄHLT HAT (Vorbild für Typ & Geschmack):`)
    for (const ex of positives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``)
  }

  if (negatives.length > 0) {
    parts.push(`## ARTIKEL, DIE MATTES VERWORFEN HAT (solche Art NICHT vorschlagen):`)
    for (const ex of negatives) parts.push(`- ${ex.title}${ex.source ? ` (${ex.source})` : ''}`)
    parts.push(``)
  }

  if (recentlyCovered.length > 0) {
    parts.push(`## BEREITS IN DEN LETZTEN NEWSLETTERN BEHANDELT — Doppelungen vermeiden, diese Themen NICHT erneut vorschlagen:`)
    for (const t of recentlyCovered) parts.push(`- ${t}`)
    parts.push(``)
  }

  parts.push(`## KANDIDATEN (heute):`)
  for (const c of candidates) {
    const preview = (c.excerpt || '').slice(0, 200)
    parts.push(
      `- id=${c.queueItemId} | ${c.title}${c.source ? ` [${c.source}]` : ''}${preview ? `\n    ${preview}` : ''}`
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
