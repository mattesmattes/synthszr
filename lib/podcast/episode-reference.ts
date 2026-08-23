/**
 * Zeitbezug auf eine frühere Folge — statt ihrer Nummer.
 *
 * Betreiberwunsch 2026-08-23: Synthszr und Emma sollen sich im Dialog nicht auf
 * „Episode 251" beziehen. Eine Nummer sagt einem Hörer nichts; ein Zeitbezug
 * schon. Die Regel:
 *
 *   unter einer Woche  -> Wochentag      „letzten Dienstag"
 *   unter einem Monat  -> Wochenabstand  „vor zwei Wochen"
 *   ab einem Monat     -> Monatsname     „im Mai"
 *
 * Der Bezug entsteht in der ZIELSPRACHE, nicht auf Deutsch. Der Skript-Prompt
 * ist zwar deutsch, aber deutsche Textbausteine darin haben schon einmal eine
 * englische Folge mitten im Abschnitt ins Deutsche kippen lassen (Befund
 * INTERMEZZO, s. project_podcast_intermezzo_lang). Unbekannte Sprachen bekommen
 * deshalb Englisch und nicht Deutsch.
 */

const WOCHENTAGE_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const WOCHENTAGE_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONATE_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONATE_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// Ausgeschrieben statt als Ziffer: „vor zwei Wochen" spricht sich natürlicher
// als „vor 2 Wochen" — und der Text geht direkt in eine Sprachausgabe.
const WOCHEN_DE = ['', 'einer', 'zwei', 'drei', 'vier', 'fünf']
const WOCHEN_EN = ['', 'one', 'two', 'three', 'four', 'five']

const TAG_MS = 86_400_000

/**
 * @param recordedAt  ISO-Zeitpunkt der früheren Folge
 * @param locale      Zielsprache des Skripts ('de' | 'en' | …)
 * @param now         Bezugszeitpunkt (Testbarkeit)
 * @returns Formulierung wie „vor zwei Wochen", oder null bei unbrauchbarem Datum
 */
export function episodeTimeReference(
  recordedAt: string,
  locale: string,
  now: Date = new Date(),
): string | null {
  const d = new Date(recordedAt)
  if (Number.isNaN(d.getTime())) return null

  const de = locale === 'de'
  const tage = Math.floor((now.getTime() - d.getTime()) / TAG_MS)

  // Unter einer Woche: der Wochentag ist der greifbarste Bezug.
  if (tage < 7) {
    return de
      ? `letzten ${WOCHENTAGE_DE[d.getDay()]}`
      : `last ${WOCHENTAGE_EN[d.getDay()]}`
  }

  // Unter einem Monat: in Wochen. 28 Tage als Grenze, damit „vor vier Wochen"
  // noch vorkommt und nicht direkt in den Monatsnamen springt.
  if (tage < 28) {
    // Gerundet, nicht abgeschnitten: 27 Tage sind gesprochen „vor vier Wochen",
    // nicht „vor drei". Der Text geht in eine Sprachausgabe, da zaehlt der
    // natuerliche Klang mehr als die exakte Division.
    const wochen = Math.round(tage / 7)
    return de
      ? `vor ${WOCHEN_DE[wochen]} Woche${wochen === 1 ? '' : 'n'}`
      : `${WOCHEN_EN[wochen]} week${wochen === 1 ? '' : 's'} ago`
  }

  // Ab einem Monat: der Monatsname. Das Jahr nur, wenn es ein anderes ist —
  // „im Mai" wäre bei einer Folge von vor einem Jahr irreführend.
  const monat = de ? MONATE_DE[d.getMonth()] : MONATE_EN[d.getMonth()]
  const anderesJahr = d.getFullYear() !== now.getFullYear()
  const jahr = anderesJahr ? ` ${d.getFullYear()}` : ''
  return de ? `im ${monat}${jahr}` : `in ${monat}${jahr}`
}

/**
 * Entfernt Folgennummern aus einem Textbaustein.
 *
 * PROD-BEFUND 2026-08-23: In `running_gags_introduced` stand
 * „Episode 262 slop argument — HOST accuses GUEST…". Solche Altbestände
 * hätten die Nummer trotz aller Prompt-Regeln zurück in den Dialog getragen —
 * das Modell übernimmt, was im Kontext steht. Der Sinn des Gags bleibt ohne die
 * Nummer erhalten („slop argument — HOST accuses GUEST…").
 *
 * Bewusst eng gefasst: nur „Episode"/„Folge" gefolgt von einer Zahl. Andere
 * Zahlen im Text (Prozente, Beträge) sind Inhalt und bleiben stehen.
 */
export function stripEpisodeNumbers(text: string): string {
  return text
    .replace(/\b(?:aus|in|zu|from|in)\s+(?:Episode|Folge)\s*#?\s*\d+\s*/gi, '')
    .replace(/\b(?:Episode|Folge)\s*#?\s*\d+\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
