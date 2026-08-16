// lib/claude/headline-variants.ts
// Drei Überschriften-Vorschläge je Abschnitt.
//
// WARUM EIN EIGENER CALL NACH `writeSection` UND NICHT IM SELBEN:
// Das Ausgabeformat von writeSection schreibt die Überschrift als Punkt 1 —
// VOR Zusammenfassung und Take. Eine Überschrift, die die Pointe des Takes
// aufgreifen soll, müsste dort formuliert werden, bevor der Take existiert.
// Genau daran sind die kryptischen Headlines von 07/2026 gescheitert
// (Commits bb8bfea → b9f07d0 → 2e4878b, drei Kalibrierungen in eine Richtung
// und zurück). Dieser Call sieht den fertigen Abschnitt.
//
// BETREIBER-ENTSCHEIDUNG 2026-08-15: alle drei Varianten werden frisch erzeugt,
// auch die journalistische. Sie ersetzt die Überschrift aus writeSection —
// aber NUR, wenn der Call sauber antwortet. Schlägt er fehl, bleibt die
// bestehende stehen. Der Artikel darf an diesem Zusatz nicht scheitern.

import type { AIModel } from '@/lib/claude/ghostwriter'
import { sanitizeHeading } from '@/lib/claude/heading-length'

/** Marker auf der Überschriftenzeile, gleiche Bauart wie data-bundle-type.
 *  Base64, weil die Überschriften Anführungszeichen, Doppelpunkte und Bindestriche
 *  enthalten — als Klartext-JSON im HTML-Kommentar wäre ein `--` darin
 *  ausreichend, um den Kommentar vorzeitig zu schließen. */
const MARKER_RE = /\s*<!--\s*hl-alts:([A-Za-z0-9+/=]+)\s*-->/

export const HEADLINE_VARIANT_COUNT = 3

export const HEADLINE_VARIANTS_SYSTEM = `Du schreibst deutsche Überschriften für einen KI-Nachrichten-Newsletter. Du bekommst einen fertigen Abschnitt (Überschrift, nüchterne Zusammenfassung, meinungsstarker "Synthszr Take") und lieferst GENAU DREI Überschriften dazu.

DIE DREI SORTEN — in dieser Reihenfolge:

1. JOURNALISTISCH. Benennt ZUERST die Kernaussage: wer tut was, oder was ist passiert. Der Leser versteht das Thema aus der Überschrift allein, ohne den Text. Namen, Zahlen, das eigentliche Ereignis. Eine dezente Zuspitzung am Ende ist erlaubt, nie auf Kosten der Klarheit.

2. POINTE AUS DEM TAKE. Nimmt die Haltung des Synthszr Take vorweg — die Wertung, die der Take vertritt, wird zur Überschrift. Der Gegenstand muss trotzdem drinstehen: man muss erkennen, WORUM es geht, nicht nur, dass jemand eine Meinung hat.

3. INSIGHT AUS DEM WIDERSPRUCH. Sucht die Spannung in der Meldung: einen Selbstwiderspruch, eine verkehrte Reihenfolge, das Ungesagte. Hier darfst du am weitesten gehen — aber auch hier muss das Thema aus der Überschrift hervorgehen.

FÜR ALLE DREI VERBINDLICH:
- Deutsch. Eine englische Überschrift ist ein FATALER FEHLER.
- HÖCHSTENS 90 ZEICHEN, inklusive Leerzeichen. Das ist eine harte Grenze, keine Empfehlung — zähle nach, bevor du antwortest. Wird sie gerissen, muss die Überschrift nachträglich maschinell gekürzt werden, und dabei geht die Pointe verloren, an der du gerade gearbeitet hast. Lieber ein Detail weglassen als über die Grenze gehen.
- Das Thema muss erkennbar sein, AUCH bei Nummer 3. Wer die Überschrift liest, ohne den Text zu kennen, muss sagen können, worum es geht.
- Verboten: kryptische Metaphern, bei denen man den Artikel lesen muss, um das Thema zu erkennen.
- Verboten: "Produktname: Erklärung"-Etikett (z.B. "Gemini 3.5: Google macht X") — den Produktnamen in den Satz einbauen.
- Verboten: leere Nacherzählung ohne Substanz ("X launcht Y").
- Verboten: Negations-Reframe ("nicht X, sondern Y") und das reflexhafte "Wenn X, aber Y"-Schema.
- Verboten: generische oder tote Sprache ("Spannende Entwicklungen", "KI-Update").
- Die drei müssen sich WIRKLICH unterscheiden. Drei Umformulierungen desselben Satzes sind wertlos.

SO KLINGT NUMMER 1 RICHTIG:
- "Anthropic macht Claudes internes Reasoning sichtbar"
- "JPMorgan bewertet seine KI-Infrastruktur mit einer Milliarde"
- "New York Times: OpenAI hat im Copyright-Prozess systematisch gelogen"

SO NICHT — DAS GILT AUCH FÜR NUMMER 2 UND 3 (Thema ohne den Text nicht erkennbar):
- "Anthropic liest jetzt das Schmierheft in Claudes Kopf"
- "Neun Etagen KI, und die Mietgrenze verläuft im siebten Stock"
- "Eine Milliarde, um zu beweisen, dass die Milliarden am Falschen hängen"

AUSGABE: genau drei Zeilen, jede beginnt mit ihrer Ziffer und einem Punkt.
1. …
2. …
3. …
Keine Erklärung, keine Anführungszeichen, kein Markdown, keine Leerzeilen dazwischen.`

/**
 * Zerlegt die Modellantwort in drei Überschriften.
 *
 * Defensiv, weil ein Modell die Nummerierung gelegentlich anders setzt: es
 * werden alle Zeilen genommen, die mit einer Ziffer beginnen; fehlt die
 * Nummerierung ganz, dienen die ersten drei nicht-leeren Zeilen. Kommen weniger
 * als drei brauchbare heraus, gibt die Funktion null — dann bleibt alles beim
 * Alten, statt eine halbe Auswahl anzuzeigen.
 */
export function parseHeadlineVariants(raw: string): string[] | null {
  const zeilen = raw.split('\n').map((z) => z.trim()).filter(Boolean)
  const nummeriert = zeilen
    .filter((z) => /^\d\s*[.)]/.test(z))
    .map((z) => sanitizeHeading(z.replace(/^\d\s*[.)]\s*/, '')))
  const kandidaten = (nummeriert.length >= HEADLINE_VARIANT_COUNT ? nummeriert : zeilen.map(sanitizeHeading))
    .filter((z) => z.length > 0)

  // Doppelte verwerfen: drei identische Vorschläge sind keine Auswahl.
  const eindeutig: string[] = []
  for (const k of kandidaten) {
    if (!eindeutig.some((e) => e.toLowerCase() === k.toLowerCase())) eindeutig.push(k)
    if (eindeutig.length === HEADLINE_VARIANT_COUNT) break
  }
  return eindeutig.length === HEADLINE_VARIANT_COUNT ? eindeutig : null
}

/**
 * Erzeugt die drei Varianten zu einem fertigen Abschnitt.
 *
 * `call` wird injiziert statt importiert, damit dieses Modul ohne API-Zugriff
 * testbar bleibt — dieselbe Bauart wie heading-length.ts.
 */
export async function generateHeadlineVariants(
  abschnitt: string,
  originalTitel: string,
  model: AIModel,
  call: (userPrompt: string, system: string, model: AIModel) => Promise<string>,
): Promise<string[] | null> {
  try {
    const roh = await call(
      `ORIGINAL-SCHLAGZEILE DER QUELLE (nüchterne Faktengrundlage, oft englisch — nicht wörtlich übernehmen):\n${originalTitel}\n\nDER FERTIGE ABSCHNITT:\n${abschnitt}`,
      HEADLINE_VARIANTS_SYSTEM,
      model,
    )
    return parseHeadlineVariants(roh)
  } catch {
    return null
  }
}

/**
 * Schreibt die Varianten in den Abschnitt: Variante 1 wird die Überschrift,
 * die beiden anderen wandern als Marker auf dieselbe Zeile.
 *
 * Der Marker sitzt bewusst auf der Überschriftenzeile und nicht darunter —
 * genau wie `data-bundle-type`. Der Konverter zieht ihn dort vor `marked()`
 * heraus; stünde er in einer eigenen Zeile, würde marked einen Absatz daraus
 * machen und TipTaps DOM-Parser verwürfe den Kommentarknoten stillschweigend.
 */
export function embedHeadlineVariants(abschnitt: string, varianten: string[]): string {
  // Bewusst KEINE feste Länge: solange der Schalter aus ist, steht die
  // bestehende Überschrift als zusätzlicher erster Eintrag davor (dann vier).
  // Index 0 ist immer das, was gerade in der Überschrift steht.
  if (varianten.length < 2) return abschnitt
  const nutzlast = Buffer.from(JSON.stringify(varianten), 'utf8').toString('base64')

  return abschnitt.replace(/^(\s*#{1,6}\s+)([^\n]*)/, (_ganz, praefix: string, rest: string) => {
    // Einen bereits gesetzten eigenen Marker entfernen — die Funktion soll
    // idempotent sein, ein zweiter Lauf darf nicht zwei Marker hinterlassen.
    const ohneEigenen = rest.replace(MARKER_RE, '')
    // FREMDE Marker (data-bundle-type) müssen erhalten bleiben. Sie stehen
    // immer am Zeilenende, alles davor ist der Überschriftentext — und der
    // wird durch Variante 1 ersetzt.
    const ab = ohneEigenen.indexOf('<!--')
    const fremd = ab >= 0 ? ohneEigenen.slice(ab).trim() : ''

    // REIHENFOLGE IST WESENTLICH: der eigene Marker kommt VOR die fremden.
    // `BUNDLE_MARKER_RE` in markdown-to-tiptap.ts ist mit `$` ans Zeilenende
    // verankert — stünde hl-alts dahinter, fände die Bundle-Extraktion ihren
    // Marker nicht mehr, und „Thema des Tages" verlöre still seine Auszeichnung.
    const teile = [`${praefix}${varianten[0]}`, `<!-- hl-alts:${nutzlast} -->`]
    if (fremd) teile.push(fremd)
    return teile.join(' ')
  })
}

/**
 * Ist die Ersetzung der Überschrift durch Variante 1 scharf?
 *
 * SCHALTER, WEIL DIE ERZEUGUNG VOR DER AUSWAHL FERTIG WURDE: Die Varianten
 * entstehen bereits, das Auswahl-Popover im Editor noch nicht. Ohne Schalter
 * würde der 05:30-Cron ab sofort andere Überschriften veröffentlichen, ohne
 * dass jemand eingreifen kann.
 *
 * WICHTIG: Der Schalter steuert NUR die Ersetzung. Erzeugt und mitgeführt
 * werden die Varianten in jedem Fall — sonst fehlten die Daten für die
 * Auswertung genau in der Anlaufzeit, in der sie am meisten aussagen.
 *
 * Aus `settings` (Key-Value, wie llm_model_config), damit das Umlegen keine
 * Auslieferung braucht:
 *   key   = 'headline_variants_config'
 *   value = { "replaceHeading": true }
 * Fehlt der Eintrag, gilt AUS — der sichere Zustand.
 */
export async function isHeadlineReplacementEnabled(
  loadSetting: (key: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    const wert = await loadSetting('headline_variants_config')
    return (wert as { replaceHeading?: unknown } | null)?.replaceHeading === true
  } catch {
    return false
  }
}

/** Liest die Varianten aus einer Überschriftenzeile und gibt die Zeile ohne
 *  Marker zurück. Für den Markdown→TipTap-Konverter. */
export function extractHeadlineVariants(zeile: string): { cleaned: string; varianten: string[] | null } {
  const treffer = zeile.match(MARKER_RE)
  if (!treffer) return { cleaned: zeile, varianten: null }
  const cleaned = zeile.replace(MARKER_RE, '')
  try {
    const roh = JSON.parse(Buffer.from(treffer[1], 'base64').toString('utf8'))
    // Länge NICHT auf HEADLINE_VARIANT_COUNT festnageln: solange der
    // Ersetzungs-Schalter aus ist, steht die bestehende Überschrift als
    // zusätzlicher erster Eintrag davor, dann sind es vier.
    if (Array.isArray(roh) && roh.every((x) => typeof x === 'string') && roh.length >= 2) {
      return { cleaned, varianten: roh as string[] }
    }
  } catch { /* kaputter Marker: Zeile trotzdem säubern */ }
  return { cleaned, varianten: null }
}
