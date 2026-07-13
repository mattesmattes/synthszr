// Längen-Nachschärfung für Abschnitts-Überschriften.
//
// Der SECTION_SYSTEM_PROMPT weist Opus an, Überschriften auf ~90 Zeichen zu
// halten, aber das ist eine weiche Prompt-Regel ohne Durchsetzung — gelegentlich
// rutscht eine 95–100-Zeichen-Überschrift durch. Diese Modul kürzt solche
// Überschriften deterministisch angestoßen (nur wenn zu lang) über einen
// injizierten LLM-Callback nach. Die Logik hier ist rein und dependency-frei,
// damit sie ohne API-Zugriff testbar ist; der eigentliche Opus-Aufruf wird in
// ghostwriter-pipeline.ts gebunden.

const HEADING_RE = /^##\s+(.+?)\s*$/

/**
 * Säubert einen vom Modell zurückgegebenen Überschrift-String: entfernt führende
 * Markdown-Hashes, umschließende Anführungszeichen und nimmt nur die erste
 * nicht-leere Zeile.
 */
export function sanitizeHeading(raw: string): string {
  const firstLine = (raw.split('\n').find((l) => l.trim().length > 0) ?? '').trim()
  return firstLine
    .replace(/^#+\s*/, '') // führende ## / ### entfernen
    .replace(/^["'«»„“]+|["'«»„“]+$/g, '') // umschließende Quotes entfernen
    .trim()
}

/**
 * Kürzt die erste ##-Überschrift einer Section, falls sie länger als maxLen ist.
 * `shorten` erhält den reinen Überschrift-Text und liefert eine kürzere Variante.
 * Non-fatal und defensiv: bei Fehler, leerem oder nicht-kürzerem Ergebnis bleibt
 * das Original erhalten.
 */
export async function enforceHeadingLength(
  section: string,
  shorten: (heading: string) => Promise<string>,
  maxLen = 90,
): Promise<string> {
  const lines = section.split('\n')
  const idx = lines.findIndex((l) => HEADING_RE.test(l))
  if (idx === -1) return section

  const heading = lines[idx].match(HEADING_RE)![1].trim()
  if (heading.length <= maxLen) return section

  let short: string
  try {
    short = sanitizeHeading(await shorten(heading))
  } catch {
    return section // LLM-Fehler: Original behalten
  }

  // Nur übernehmen, wenn nicht leer und tatsächlich kürzer als das Original.
  if (!short || short.length >= heading.length) return section

  lines[idx] = `## ${short}`
  return lines.join('\n')
}
