/**
 * Der Synthszr Take wird hart auf fünf Sätze gekürzt.
 *
 * BETREIBER-VORGABE 2026-08-14: „Cutte den Take hart auf 5 Sätze, keine 7."
 *
 * Die Prompt-Vorgabe allein reichte nicht. Im Bündel-Modus steht über dem Take
 * eine Zusammenfassung von bis zu 25 Sätzen, und daneben wirkt ein kurzer Take
 * unfertig — das Modell ließ ihn mitwachsen, trotz ausdrücklicher Anweisung.
 *
 * DIE FALLE IST DIE SATZGRENZE, nicht das Zählen. Ein Punkt beendet im
 * Deutschen nicht zuverlässig einen Satz: „z. B.", „u. a.", „Mio.", „Dr.",
 * „2,5 Mrd." und Ordnungszahlen („am 14. August") stehen mitten im Satz. Wer
 * naiv an „. " schneidet, kappt nach einem halben Satz — und das fällt
 * niemandem auf, weil das Ergebnis grammatisch aussieht.
 */

/** Wie viele Sätze ein Take höchstens hat. */
export const TAKE_MAX_SENTENCES = 5

/**
 * Abkürzungen, nach deren Punkt KEIN Satz endet.
 *
 * Bewusst knapp gehalten und auf das beschränkt, was in diesen Texten wirklich
 * vorkommt — eine lange Liste erzeugt mehr Fehlalarme, als sie verhindert.
 */
const ABBREVIATIONS = [
  'z', 'b', 'u', 'a', 'd', 'h', 'ca', 'bzw', 'evtl', 'ggf', 'inkl', 'exkl',
  'mio', 'mrd', 'tsd', 'nr', 'dr', 'prof', 'vgl', 'ebd', 'usw', 'etc',
  'jan', 'feb', 'mär', 'apr', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez',
]

/**
 * Text in Sätze zerlegen.
 *
 * Ein Satzende ist ein Punkt, Frage- oder Ausrufezeichen, dem Leerraum und ein
 * Großbuchstabe (oder das Textende) folgen — und der nicht zu einer Abkürzung
 * oder Zahl gehört.
 */
export function splitSentences(text: string): string[] {
  const t = text.trim()
  if (!t) return []

  const out: string[] = []
  let start = 0

  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue

    // Mehrere Satzzeichen am Stück („?!", „...") bilden EIN Ende.
    let ende = i
    while (ende + 1 < t.length && '.!?…'.includes(t[ende + 1])) ende++

    const rest = t.slice(ende + 1)
    const folgt = rest.match(/^\s+(\S)/)
    // Textende zählt als Satzende; sonst muss ein Großbuchstabe oder ein
    // Anführungszeichen folgen.
    if (!folgt && rest.trim().length > 0) { i = ende; continue }
    if (folgt && !/[A-ZÄÖÜ„"»(]/.test(folgt[1])) { i = ende; continue }

    if (c === '.') {
      const davor = t.slice(start, i)
      const letztesWort = davor.match(/([\p{L}]+)$/u)?.[1]?.toLowerCase()
      // Abkürzung → kein Satzende.
      if (letztesWort && ABBREVIATIONS.includes(letztesWort)) { i = ende; continue }
      // Ordnungszahl („am 14. August") → kein Satzende.
      if (/\d$/.test(davor)) { i = ende; continue }
    }

    const satz = t.slice(start, ende + 1).trim()
    if (satz) out.push(satz)
    start = ende + 1
    i = ende
  }

  const rest = t.slice(start).trim()
  if (rest) out.push(rest)
  return out
}

/** Erkennt die Take-Zeile — der Rest des Abschnitts bleibt unangetastet. */
const TAKE_MARKER = /(^|\n)(\*\*)?Synthszr Take:(\*\*)?\s*/i

/**
 * Kürzt den Take eines Abschnitts auf {@link TAKE_MAX_SENTENCES} Sätze.
 *
 * NUR den Take: Die Zusammenfassung darüber darf im Bündel bis zu 25 Sätze
 * haben und ist von der Grenze ausdrücklich nicht betroffen. Was nach dem Take
 * folgt (Company-Tags, Quellenzeile), bleibt ebenfalls stehen.
 */
export function capTake(section: string): string {
  const treffer = section.match(TAKE_MARKER)
  if (!treffer || treffer.index === undefined) return section

  const beginn = treffer.index + treffer[0].length
  // Der Take endet an der nächsten Leerzeile — danach stehen Tags und Quellen.
  const restlicher = section.slice(beginn)
  const ende = restlicher.search(/\n\s*\n/)
  const takeText = ende === -1 ? restlicher : restlicher.slice(0, ende)
  const danach = ende === -1 ? '' : restlicher.slice(ende)

  const saetze = splitSentences(takeText)
  if (saetze.length <= TAKE_MAX_SENTENCES) return section

  return section.slice(0, beginn) + saetze.slice(0, TAKE_MAX_SENTENCES).join(' ') + danach
}
