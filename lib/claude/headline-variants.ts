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

2. POINTE AUS DEM TAKE. Nimmt die Haltung des Synthszr Take vorweg. Der Gegenstand muss drinstehen: man muss erkennen, WORUM es geht, nicht nur, dass jemand eine Meinung hat.

3. INSIGHT AUS DEM WIDERSPRUCH. Sucht die Spannung in der Meldung: einen Selbstwiderspruch, eine verkehrte Reihenfolge, das Ungesagte. Hier darfst du am weitesten gehen — aber auch hier muss das Thema aus der Überschrift hervorgehen.

AUF WELCHEM NIVEAU 2 UND 3 SPIELEN — DAS IST DER HÄUFIGSTE FEHLER:
Du schreibst als erfahrener Technologie-Analyst, nicht als Kommentator, der ein Ereignis nachbewertet. Der Unterschied ist DIAGNOSE statt MEINUNG.
- Eine Diagnose benennt einen MECHANISMUS: was hier wie funktioniert, wer wofür bezahlt, welche Zahl welche andere widerlegt.
- Eine Meinung sagt nur, dass etwas gut, teuer, riskant oder fragwürdig sei. Das ist zu wenig.
Zwei Prüffragen, bevor du 2 oder 3 abgibst:
(a) Steht darin etwas, das man dem Abschnitt NICHT in einem Satz entnimmt? Wenn nein, ist es eine Nacherzählung mit Wertungsanstrich.
(b) Könnte derselbe Satz mit ausgetauschten Namen über jeder zweiten Meldung stehen? Wenn ja, ist er zu allgemein.
ZU FLACH — SO NICHT:
- "60 Milliarden für Cursor: SpaceX zahlt vor allem für Umsätze, die noch keiner sah" (bewertet nur „teuer und unsicher" — kein Mechanismus)
- "Dynatrace zahlt viel Geld für eine Technologie, die es schon hatte" (dasselbe Muster)
SO IST ES RICHTIG (benennt, WIE es funktioniert):
- "Arize-Zukauf zeigt: Wer die Evaluation früh besetzt, kassiert später das Monitoring-Budget"
- "Korrelation kann jedes LLM, das do-Kalkül beantwortet erst die Frage nach dem Warum"
- "US-Labore veröffentlichen oberhalb 100 Milliarden Parametern vor allem Ableitungen chinesischer Modelle"

FAKTENTREUE — HÄRTER ALS ALLES ANDERE:
Jede Zahl, jeder Name und jede Tatsachenbehauptung muss WÖRTLICH im vorliegenden Abschnitt stehen. Du leitest nichts ab, du ergänzt nichts aus Weltwissen, du präzisierst nichts, was der Text offenlässt.
Besonders bei den Varianten 2 und 3 ist die Versuchung groß, die Aussage „zuzuspitzen", bis sie etwas behauptet, das so nicht dasteht.
KONKRETES BEISPIEL EINES ECHTEN FEHLERS: Im Abschnitt stand, ein Käufer wolle sein Modell auf den Daten des übernommenen Dienstes trainieren. Daraus wurde „trainiert Grok auf Mitarbeiterdaten" — es waren die Daten und der Code der NUTZER. Das ist keine Zuspitzung mehr, das ist eine andere Behauptung.
Im Zweifel die vorsichtigere Formulierung. Eine Überschrift, die weniger behauptet, ist immer besser als eine, die etwas Falsches behauptet.

FÜR ALLE DREI VERBINDLICH:
- Deutsch. Eine englische Überschrift ist ein FATALER FEHLER.
- HÖCHSTENS 90 ZEICHEN, inklusive Leerzeichen. Das ist eine harte Grenze, keine Empfehlung — zähle nach, bevor du antwortest. Wird sie gerissen, muss die Überschrift nachträglich maschinell gekürzt werden, und dabei geht die Pointe verloren, an der du gerade gearbeitet hast. Lieber ein Detail weglassen als über die Grenze gehen.
- Das Thema muss erkennbar sein, AUCH bei Nummer 3. Wer die Überschrift liest, ohne den Text zu kennen, muss sagen können, worum es geht.
- Verboten: kryptische Metaphern, bei denen man den Artikel lesen muss, um das Thema zu erkennen.
- Verboten: "Produktname: Erklärung"-Etikett (z.B. "Gemini 3.5: Google macht X") — den Produktnamen in den Satz einbauen.
- Verboten: leere Nacherzählung ohne Substanz ("X launcht Y").
- Verboten: Negations-Reframe ("nicht X, sondern Y") und das reflexhafte "Wenn X, aber Y"-Schema.
- KEIN GEDANKENSTRICH als Satzteiler — weder — noch –. Das ist das auffälligste Maschinen-Merkmal überhaupt und im ganzen Projekt untersagt. Nimm einen Doppelpunkt, ein Komma oder zwei Sätze. (Bindestriche INNERHALB von Wörtern sind selbstverständlich erlaubt: KI-Agent, Post-Training.)
  FALSCH: "SpaceX kauft Cursor für 60 Milliarden – Team wechselt zu SpaceXAI"
  RICHTIG: "SpaceX kauft Cursor für 60 Milliarden, das Team wechselt zu SpaceXAI"
- Verboten: Bewertungswörter ohne Substanz ("teuer", "riskant", "fragwürdig", "beeindruckend", "umstritten") als Kern der Aussage. Sie ersetzen die Beobachtung durch ein Urteil.
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
 * Gedankenstrich als Satzteiler — Halbgeviert (–) oder Geviert (—), jeweils
 * mit Leerzeichen drumherum oder am Wortrand.
 *
 * Der Bindestrich INNERHALB eines Wortes (KI-Agent, Post-Training) ist ein
 * anderes Zeichen (U+002D) und bleibt unberührt. Geprüft werden nur U+2013 und
 * U+2014, und die stehen in einer Überschrift praktisch immer als Satzteiler.
 */
export function enthaeltGedankenstrich(text: string): boolean {
  return /[–—]/.test(text)
}

export const GEDANKENSTRICH_FIX_SYSTEM = `Du entfernst den Gedankenstrich aus einer deutschen Überschrift. Der Halbgeviert- oder Geviertstrich (– oder —) als Satzteiler ist ein Maschinen-Merkmal und in diesem Projekt untersagt.

Ersetze ihn durch das, was der Satz braucht: einen Doppelpunkt, ein Komma, ein verbindendes Wort — oder bau den Satz leicht um. Bindestriche innerhalb von Wörtern (KI-Agent, Post-Training) bleiben unangetastet.

Inhalt, Aussage, Zahlen und Namen bleiben WÖRTLICH erhalten. Du formulierst nicht neu, du reparierst nur die Zeichensetzung. Die Überschrift darf dabei nicht länger als 90 Zeichen werden.

Beispiel:
  vorher : SpaceX kauft Cursor für 60 Milliarden – Team wechselt zu SpaceXAI
  nachher: SpaceX kauft Cursor für 60 Milliarden, das Team wechselt zu SpaceXAI

Gib NUR die überarbeitete Überschrift zurück — kein Markdown, keine Anführungszeichen, keine Erklärung.`

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
