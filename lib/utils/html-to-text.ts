/**
 * Roh-HTML aus der Artikel-Ablage in lesbaren Fließtext.
 *
 * BETREIBER-BEFUND 2026-08-13: Die Vorschau einer Newsquelle im Admin zeigte
 * `<div id="readability-page-1" class="page"><section>…` als Text — der Inhalt
 * kommt bei gecrawlten Artikeln als HTML-Fragment aus Readability, bei
 * Newslettern dagegen als Klartext. Die Vorschau gab beides unverändert aus.
 *
 * Bewusst simpel und ohne Parser-Abhängigkeit: Diese Funktion dient der ANZEIGE
 * in einem Admin-Werkzeug, nicht der Wiederverwendung des Markups. Sie muss
 * lesbar machen, nicht strukturtreu übersetzen.
 *
 * KEIN Ersatz für Sanitizing: Das Ergebnis ist reiner Text und wird als
 * Textknoten gerendert — es darf niemals über dangerouslySetInnerHTML zurück
 * ins DOM.
 */

/** Blockelemente, deren Ende einen Absatzumbruch verdient. */
const BLOCK_END = /<\/(p|div|section|article|h[1-6]|li|tr|blockquote|figcaption)>/gi

/** Was gar keinen Textbeitrag leistet — Inhalt mitsamt Tag entfernen. */
const DROP_WHOLE = /<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&hellip;': '…', '&mdash;': '—', '&ndash;': '–',
  '&laquo;': '«', '&raquo;': '»', '&bdquo;': '„', '&ldquo;': '"', '&rdquo;': '"',
  '&euro;': '€', '&shy;': '',
}

/** Sieht der Text nach Markup aus? Newsletter-Inhalte sind oft schon Klartext
 *  und sollen dann unangetastet bleiben (auch ein „<" im Fließtext genügt nicht). */
export function looksLikeHtml(raw: string): boolean {
  return /<(p|div|section|article|br|span|img|a|h[1-6]|table|ul|ol|li)\b[^>]*>/i.test(raw)
}

export function htmlToPlainText(raw: string): string {
  if (!raw) return ''
  if (!looksLikeHtml(raw)) return raw.trim()

  let s = raw
    .replace(DROP_WHOLE, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n\n')
    .replace(/<[^>]+>/g, ' ')

  for (const [entity, char] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(char)
  }
  // Numerische Entities (&#8217; und &#x2019;)
  s = s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))

  return s
    // Leerraum je Zeile zusammenziehen, Absätze aber erhalten.
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
