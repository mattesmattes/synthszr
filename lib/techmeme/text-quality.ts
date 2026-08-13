/**
 * Ist das ein Artikel — oder hat uns die Seite nur abgewehrt?
 *
 * BEFUND AUS DEM ERSTEN PRODUKTIONSLAUF (2026-08-13): Von 69 Einträgen waren
 * drei keine Artikel, sondern Abwehrseiten — Bloombergs „Are you a robot?" und
 * Cloudflares „Sorry, you have been blocked". Sie kamen durch, weil die einzige
 * Prüfung eine Längenuntergrenze war: Mit über 1.000 Zeichen sind sie länger
 * als mancher echte Anriss.
 *
 * EINE LÄNGENPRÜFUNG ERKENNT KEINEN INHALT. Sie erkennt nur, dass Text da ist.
 */

/**
 * Titel, die es bei einem Artikel nicht gibt. Der Titel ist das verlässlichste
 * Merkmal: Abwehrseiten benennen sich selbst.
 */
const BLOCK_TITLES = [
  'are you a robot', 'attention required', 'access denied', 'just a moment',
  'security check', 'verify you are human', 'forbidden', 'bot verification',
  'one moment, please', 'pardon our interruption',
]

/** Formulierungen, die im KOPF einer Abwehrseite stehen. */
const BLOCK_PHRASES = [
  'you have been blocked', "we've detected unusual activity", 'detected unusual activity',
  'please enable cookies', 'enable javascript and cookies', 'unusual traffic from your',
  'to continue, please click', 'this website is using a security service',
  'you are unable to access', 'checking your browser before accessing',
]

/**
 * Bis hierhin wird nach Abwehr-Formulierungen gesucht — nicht im ganzen Text.
 *
 * Der gefährlichste Fehlalarm wäre sonst ein ARTIKEL ÜBER SPERREN: Wir
 * berichten über Technik, und ein Bericht darüber, dass Cloudflare KI-Crawler
 * aussperrt, enthält dieselben Wörter wie die Sperrseite selbst.
 */
const HEAD_LENGTH = 500

/**
 * Bis zu dieser Länge gilt ein Text mit Abwehr-Formulierung als Abwehrseite.
 * Darüber ist es Berichterstattung: Die gemessenen Sperrseiten lagen bei 1.022
 * bis 1.134 Zeichen, ein Artikel über dasselbe Thema ist ein Vielfaches länger.
 */
const BLOCK_MAX_LENGTH = 3000

export function looksBlocked(title: string | null, text: string): boolean {
  if (!text) return false

  const t = (title ?? '').toLowerCase()
  if (BLOCK_TITLES.some((m) => t.includes(m))) return true

  if (text.length > BLOCK_MAX_LENGTH) return false
  const kopf = text.slice(0, HEAD_LENGTH).toLowerCase()
  return BLOCK_PHRASES.some((m) => kopf.includes(m))
}

/**
 * Den Metadaten-Kopf entfernen, den markdown.new voranstellt.
 *
 * Der Dienst liefert `Title: …`, `URL Source: …`, `Markdown Content:` und einen
 * YAML-Block, bevor der Artikel beginnt. Ungefiltert stehen diese Zeilen als
 * Anfang des Artikeltextes in der Queue — und damit im Ghostwriter-Prompt.
 */
export function stripMarkdownPreamble(raw: string): string {
  let s = raw

  const marker = s.indexOf('Markdown Content:')
  if (marker >= 0 && marker < 600) {
    s = s.slice(marker + 'Markdown Content:'.length)
  } else {
    s = s.replace(/^Title:.*(\r?\n)+/i, '').replace(/^URL Source:.*(\r?\n)+/i, '')
  }

  // Der YAML-Block direkt danach gehört ebenfalls zum Kopf.
  s = s.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  return s.trim()
}

/**
 * Obergrenze für den gespeicherten Text.
 *
 * Ein Eintrag des ersten Laufs hatte 96.477 Zeichen: markdown.new liefert bei
 * manchen Seiten die komplette Seite samt Navigation. Das verzerrt die
 * Bewertung (content_length fließt in die Auswahl ein) und bläht den
 * Ghostwriter-Prompt, ohne mehr Substanz zu liefern.
 */
export const MAX_TEXT_LENGTH = 40_000

export function capText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  const gekappt = text.slice(0, MAX_TEXT_LENGTH)
  const letzteLuecke = gekappt.lastIndexOf(' ')
  return (letzteLuecke > MAX_TEXT_LENGTH * 0.9 ? gekappt.slice(0, letzteLuecke) : gekappt).trim()
}
