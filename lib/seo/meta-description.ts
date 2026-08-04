/**
 * Kürzt einen Text auf SERP-Länge.
 *
 * GEMESSEN, nicht angenommen (2026-08-04): /en/glossary/cuda lieferte eine
 * Meta-Description von 280 Zeichen, weil das volle summary durchgereicht wurde.
 * Google zeigt rund 155 Zeichen und schneidet selbst ab — die Zeile endete also
 * mitten im Satz, und wo sie endet, entschied Google statt wir.
 *
 * Zwei Abbruchregeln, in dieser Reihenfolge:
 *   1. Liegt ein SATZENDE im Fenster, wird dort abgebrochen. Ein vollständiger
 *      Satz liest sich besser als ein Fragment und braucht kein Auslassungszeichen.
 *   2. Sonst an der letzten Wortgrenze plus „…". Mitten im Wort abzubrechen
 *      liest sich wie ein Fehler.
 */
const MAX_META_LENGTH = 155

/** Ein Satzende gilt erst ab dieser Position als brauchbar. Sonst würde aus
 *  „CUDA ist ein Standard. Er stammt von Nvidia…" nur „CUDA ist ein Standard."
 *  — technisch ein Satz, aber als SERP-Zeile zu dünn. */
const MIN_SENTENCE_LENGTH = 40

export function shortenForMeta(text: string, max: number = MAX_META_LENGTH): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean

  const window = clean.slice(0, max)

  // 1. Satzende im Fenster? Punkt, Frage- oder Ausrufezeichen gefolgt von einem
  //    Leerzeichen — der Punkt in „z.B." oder „3.5" fällt damit nicht darunter.
  const sentenceEnd = window.search(/[.!?](?=\s)(?![^]*[.!?](?=\s))/)
  if (sentenceEnd >= MIN_SENTENCE_LENGTH) return window.slice(0, sentenceEnd + 1)

  // 2. Sonst an der letzten Wortgrenze.
  const lastSpace = window.lastIndexOf(' ')
  return `${window.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`
}
