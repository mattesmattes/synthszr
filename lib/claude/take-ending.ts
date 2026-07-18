// Durchsetzung des "Wer …"-Schlussverbots für Synthszr Takes.
//
// Der SECTION_SYSTEM_PROMPT verbietet die Konditional-Belehrung ("Wer jetzt
// noch X, verliert Y") als letzten oder vorletzten Take-Satz hart — aber
// Prompt-Regeln sind weich: Im Vorher/Nachher-Test (2026-07-13) endeten
// trotz FATAL-Verbot noch 2 von 4 Takes mit der Figur (Basisrate davor:
// 21 von 40). Dieses Modul erkennt sie deterministisch und lässt den
// injizierten LLM-Callback nur den Take umformen. Die Logik hier ist rein
// und dependency-frei, damit sie ohne API-Zugriff testbar ist; der
// eigentliche Modell-Aufruf wird in ghostwriter-pipeline.ts gebunden.

export const TAKE_MARKER_RE = /\*{0,2}Synthszr Take:\*{0,2}/

const WER_SENTENCE_RE = /^[^\p{L}]*Wer\b/u

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Beginnt der letzte oder vorletzte Satz dieses Take-Texts mit "Wer"? */
function werEndingInTake(take: string): boolean {
  const sentences = splitSentences(take)
  return sentences.slice(-2).some((s) => WER_SENTENCE_RE.test(s))
}

/** Zerlegt eine Section am (letzten) Take-Marker; null ohne Marker. */
export function splitAtTake(section: string): { prefix: string; take: string } | null {
  const match = section.match(TAKE_MARKER_RE)
  if (!match || match.index === undefined) return null
  const markerEnd = match.index + match[0].length
  return { prefix: section.slice(0, markerEnd), take: section.slice(markerEnd) }
}

/** Endet der Synthszr Take dieser Section mit der "Wer …"-Figur? */
export function hasWerEnding(section: string): boolean {
  const parts = splitAtTake(section)
  return parts !== null && werEndingInTake(parts.take)
}

/**
 * Formt einen Take mit "Wer …"-Schlussfigur über den injizierten Callback um.
 * Non-fatal und defensiv: Bei Fehler, leerem Ergebnis oder wenn die Figur den
 * Rewrite überlebt, bleibt das Original erhalten.
 */
export async function enforceTakeEnding(
  section: string,
  rewrite: (take: string) => Promise<string>,
): Promise<string> {
  const parts = splitAtTake(section)
  if (!parts || !werEndingInTake(parts.take)) return section

  let rewritten: string
  try {
    rewritten = (await rewrite(parts.take.trim())).trim()
  } catch {
    return section // LLM-Fehler: Original behalten
  }

  if (!rewritten || werEndingInTake(rewritten)) return section
  return `${parts.prefix} ${rewritten}`
}
