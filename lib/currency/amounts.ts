// lib/currency/amounts.ts
// Erkennt den Betrag, der VOR einer Währungsnennung steht.
//
// Zweck: „123 Millionen Yuan" soll als GANZES ins Lexikon verlinkt sein, nicht
// nur das Wort „Yuan" — und der Umrechner dort soll den Betrag schon stehen
// haben. Ohne die Zahl ist der Sprung ins Lexikon eine Erklärung; mit ihr ist
// er eine Antwort.

/** Größenordnungswörter und ihr Faktor. Reihenfolge egal, gematcht wird über
 *  die Alternative unten — aber die längeren Formen müssen dort ZUERST stehen,
 *  sonst gewinnt „Mio" gegen „Mio." und der Punkt bliebe im Text zurück. */
const GROESSENORDNUNGEN: Array<[string, number]> = [
  ['milliarden', 1e9],
  ['millionen', 1e6],
  ['billionen', 1e12],
  ['tausend', 1e3],
  ['mrd.', 1e9],
  ['mrd', 1e9],
  ['mio.', 1e6],
  ['mio', 1e6],
  ['bio.', 1e12],
  ['bio', 1e12],
]

const WORT_MUSTER = GROESSENORDNUNGEN
  .map(([w]) => w.replace('.', '\\.'))
  .join('|')

/**
 * Am Textende verankert: Zahl, optionaler Zwischenraum, optionales
 * Größenordnungswort, optionaler Zwischenraum. Angewandt wird es auf den Text
 * VOR der Fundstelle, das Ende des Ausschnitts ist also der Beginn des
 * Währungsnamens.
 *
 * Die Zahl im deutschen Format: Punkte gruppieren Tausender, das Komma trennt
 * die Nachkommastellen.
 */
const BETRAG_MUSTER = new RegExp(
  `(\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?|\\d+(?:,\\d+)?)\\s*(${WORT_MUSTER})?\\s*$`,
  'i',
)

export interface BetragFund {
  /** Neuer Startindex — der Beginn der Zahl, damit die Verlinkung sie umfasst. */
  start: number
  /** Der ausgerechnete Betrag in Einheiten der Währung. */
  betrag: number
}

/**
 * Sucht rückwärts von `start` nach einem Betrag. Gibt null zurück, wenn dort
 * keiner steht — dann wird wie bisher nur der Währungsname verlinkt.
 *
 * WARUM EINE OBERGRENZE FÜR DIE ZAHLENLÄNGE: ohne sie träfe das Muster auch
 * Jahreszahlen und Aktenzeichen, die zufällig vor der Währung stehen. Vier
 * zusammenhängende Ziffern ohne Gruppierung und ohne Größenordnungswort sind
 * fast immer eine Jahreszahl („seit 2024 Yuan-Anleihen"), kein Betrag —
 * deshalb fallen sie heraus, sobald kein Größenordnungswort dabeisteht.
 */
export function betragVorFundstelle(text: string, start: number): BetragFund | null {
  const davor = text.slice(0, start)
  const treffer = BETRAG_MUSTER.exec(davor)
  if (!treffer) return null

  const [ganzes, zahlText, wort] = treffer
  const zahl = Number(zahlText.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(zahl) || zahl <= 0) return null

  // Blanke vierstellige Zahl ohne Gruppierung und ohne Größenordnung: eher
  // Jahreszahl als Betrag.
  if (!wort && /^\d{4}$/.test(zahlText)) return null

  const faktor = wort
    ? GROESSENORDNUNGEN.find(([w]) => w === wort.toLowerCase())?.[1] ?? 1
    : 1

  return {
    start: treffer.index,
    betrag: zahl * faktor,
  }
}

/**
 * Für den Link-Parameter. Keine Exponentialschreibweise — `String(1e9)` ergibt
 * „1000000000", aber `String(1.23e21)` ergibt „1.23e+21", und das käme im
 * Rechner als NaN an. Beträge dieser Größe gibt es hier zwar nicht, aber die
 * Absicherung kostet nichts.
 */
export function betragFuerUrl(betrag: number): string {
  return betrag.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 4,
  })
}
