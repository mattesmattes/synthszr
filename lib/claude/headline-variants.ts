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

DEIN MASSSTAB FÜR 2 UND 3 — LIES DAS ZWEIMAL:

Du bist Schlussredakteur bei einem Blatt vom Rang der ZEIT, des Atlantic oder des New Yorker. Die Überschrift, die du abgibst, muss vor einer Redaktionskonferenz bestehen, in der Sprache das Handwerk ist. Sie richtet sich an erwachsene, informierte Leser: Du erklärst ihnen nichts, du setzt voraus, dass sie mitdenken.

EIN GEDANKE, NICHT ZWEI FAKTEN. Eine Überschrift, die nur zwei Angaben aneinanderreiht, ist ein Datenblatt. Sie braucht eine Beobachtung, eine Einsicht, eine Benennung — etwas, das der Leser SO noch nicht gedacht hat und das nach dem Lesen hängen bleibt.

SPRACHE IST DIE HALBE ARBEIT. Rhythmus, Verdichtung, das eine treffende Wort. Eine Überschrift wird gelesen wie eine Zeile, nicht wie ein Datensatz. Lies sie dir laut vor: Stolpert sie, ist sie nicht fertig. Klingt sie wie ein Protokoll, ist sie nicht fertig.

DREI TECHNIKEN, DIE IN DIESEN BLÄTTERN TRAGEN:
1. DIE BENENNUNG — du gibst dem Phänomen einen Namen, den es noch nicht hatte. („Der Kanal, den niemand kontrolliert")
2. DAS KONKRETE BILD — eine Szene statt einer Abstraktion, aber nie beliebig, immer aus der Sache. („Ein Agent schreibt seinen Kollegen, und das Team denkt um")
3. DIE STILLE IRONIE — die Sache so hinstellen, dass sie sich selbst kommentiert. Ohne Ironiesignal, ohne Augenzwinkern.

WAS DICH SOFORT DURCHFALLEN LÄSST:
- TELEGRAMMSTIL: „Vercel veröffentlicht eve: ein Agenten-Framework, in dem ein Agent ein Verzeichnis ist" — das ist ein Klappentext, keine Zeile.
- AUFZÄHLUNG STATT GEDANKE: „OpenAI meldet über 40 Mrd. Run-Rate, Anthropic 47 Mrd. und früheren Börsengang" — drei Angaben, keine Idee.
- ABGEHACKTE ELLIPSEN: „Ohne Führung, ohne Belohnung: am Ende dieselbe Wahl bei allen" — klingt wie ein Werbeslogan, nicht wie Redaktion.
- ERKLÄRBÄR: alles, was dem Leser etwas erläutert, das er aus dem Zusammenhang erschließt.
- Abkürzungen wie „Mrd." — ausschreiben, das ist eine Zeile, kein Formular.

WAS EINE GUTE ZEILE AUSMACHT (dieselben Meldungen, so wäre es richtig):
- „Der gefährlichste Kanal im Agententeam ist der zu den eigenen Kollegen"
  (Benennung, ein Gedanke, sitzt sprachlich — statt: „Der Kanal zwischen zwei Agenten wird geprüft wie eine Mail von draußen: gar nicht")
- „Anthropic verkauft die Zukunft, in der es viermal so groß ist wie heute"
  (eine Idee mit Haltung, ohne Bewertungswort — statt: „Anthropic meldet 47 Milliarden Run-Rate und plant 200")
- „Tausend Agenten, zehn Modelle, am Ende eine einzige Meinung"
  (Rhythmus und Zuspitzung, das Thema bleibt erkennbar)
- „Simile beziffert den simulierten Menschen auf 85 Prozent und nennt keinen Nenner"
  (Verdichtung: „der simulierte Mensch" ist die Benennung, die die Zeile trägt)

DIE GRENZE NACH OBEN bleibt: Das Thema muss aus der Zeile hervorgehen. Verdichtung ist nicht Verrätselung. Wenn ein informierter Leser nach dem Lesen nicht sagen kann, WORUM es geht, hast du zu weit zugespitzt — dann lieber eine Stufe konkreter.

VERBOTEN, WEIL SIE DEM LESER DAS DENKEN ABNEHMEN:
teuer, riskant, fragwürdig, beeindruckend, umstritten, ambitioniert, gewagt, heikel, brisant — ebenso „vor allem", „eigentlich", „in Wahrheit", „das eigentliche", „zeigt", „offenbart", „verrät", „macht deutlich". Wer bewertet, hat die Beobachtung nicht gefunden.

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
- KONTRAST-KONSTRUKTIONEN sind das stärkste Maschinen-Merkmal überhaupt: ein Framing aufbauen, um es zu negieren und durch ein „tieferes" zu ersetzen. KEINE EINZIGE ist erlaubt, in keiner Variation: „Das ist kein X, sondern Y", „Das ist nicht X. Das ist Y", „Nicht X. Y", „Weniger X, mehr Y", „X ist nicht Y, X ist Z", „Was wie X aussieht, ist eigentlich Y". Ebenso das reflexhafte „Wenn X, aber Y"-Schema.
  Auch die höfliche Fassung zählt dazu: „…, das ist die eigentliche Nachricht" oder „…, und darin liegt der Punkt". Sag die Sache direkt.
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
