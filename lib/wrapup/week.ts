/**
 * Wochenfenster des Wrap-ups.
 *
 * IMMER die letzte ABGESCHLOSSENE Woche (Montag bis Sonnabend) — unabhängig
 * davon, wann der Knopf gedrückt wird. Betreiber-Entscheidung 2026-08-09: das
 * Ergebnis soll nicht am Klickzeitpunkt hängen, sonst liefert derselbe Knopf am
 * Sonntag und am Mittwoch verschiedene Artikel.
 *
 * Sonntag ist bewusst nicht enthalten (Vorgabe „Montags bis Sonnabend"). Die
 * obere Grenze ist deshalb Sonntag 00:00 und exklusiv zu lesen.
 *
 * Die Zeitzone ist hier kein Detail: Vercel läuft auf UTC, die Artikel-
 * Zeitstempel werden in Berliner Zeit gelesen. Eine Wochengrenze ohne explizite
 * Zone verschiebt sich um zwei Stunden — ein Artikel von Montag 00:30 fiele
 * dann in die Vorwoche.
 */
const TZ = 'Europe/Berlin'

/** "YYYY-MM-DD" in Berliner Zeit — dasselbe Muster wie toBerlinDateStr in
 *  app/api/admin/analytics/stats/route.ts. */
function berlinDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

/** Wochentag (0=So … 6=Sa) für einen Datums-String. Über den Mittag gerechnet,
 *  damit die Sommerzeit-Umstellung das Ergebnis nicht kippt. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

/** Kalendarische Verschiebung auf dem Datums-String, nicht auf einem Zeitpunkt:
 *  über den Mittag gerechnet gibt es keine DST-Kante, die einen Tag verschluckt. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return berlinDateStr(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)))
}

/**
 * ISO-Zeitpunkt für 00:00 Berliner Zeit an diesem Tag.
 *
 * Der Offset ist je nach Jahreszeit +01:00 oder +02:00. Statt ihn zu berechnen,
 * werden die plausiblen UTC-Stunden durchprobiert und die genommen, die in
 * Berlin auf Mitternacht desselben Tages fällt — das kommt ohne eine
 * Zeitzonen-Bibliothek aus und bleibt bei einer künftigen Regeländerung richtig.
 */
function berlinMidnightIso(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  for (const utcHour of [0, 22, 23, 1, 2]) {
    // 22/23 des VORTAGS sind die üblichen Fälle (MEZ/MESZ liegen vor UTC).
    const dayShift = utcHour >= 22 ? -1 : 0
    const candidate = new Date(Date.UTC(y, m - 1, d + dayShift, utcHour, 0, 0))
    if (berlinDateStr(candidate) !== dateStr) continue
    const localHour = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hour: '2-digit', hour12: false,
    }).format(candidate)
    if (localHour === '00') return candidate.toISOString()
  }
  // Fallback: UTC-Mitternacht. Verschiebt das Fenster um höchstens zwei Stunden
  // — ein Artikel aus dem Grenzbereich könnte in die Nachbarwoche rutschen, das
  // Ergebnis bleibt aber brauchbar. Lieber das als ein Wurf.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString()
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

/**
 * Zeitraum für den Titel, Betreiber-Muster 2026-08-09:
 *   „Die AI-Themen der Woche vom 3. bis 9. August 2026"
 *
 * Das Label nennt die volle KALENDERWOCHE bis Sonntag, obwohl der Inhalt bis
 * Sonnabend reicht: der Rückblick erscheint frühestens am Sonntag, und der
 * Zeitraum im Titel benennt die Woche als Ganzes, nicht die Liste der Beiträge.
 *
 * Der Monat steht nur einmal, solange die Woche ihn nicht wechselt.
 */
function formatLabel(mondayStr: string, sundayStr: string): string {
  const [my, mm, md] = mondayStr.split('-').map(Number)
  const [sy, sm, sd] = sundayStr.split('-').map(Number)
  if (mm === sm && my === sy) return `${md}. bis ${sd}. ${MONTHS[sm - 1]} ${sy}`
  return `${md}. ${MONTHS[mm - 1]} bis ${sd}. ${MONTHS[sm - 1]} ${sy}`
}

export interface WrapupWeek {
  /** Montag 00:00 Berliner Zeit, als ISO-String. Untere Grenze, inklusiv.
   *  ACHTUNG: das UTC-Datum darin ist der SONNTAG davor (Mitternacht in Berlin
   *  ist 22:00 oder 23:00 UTC). Für Anzeige und Vergleiche `mondayDate` nehmen. */
  mondayIso: string
  /** Sonntag 00:00 Berliner Zeit. Obere Grenze, EXKLUSIV — der Sonntag selbst
   *  gehört nicht mehr dazu. */
  saturdayEndIso: string
  /** "YYYY-MM-DD" des Montags in Berliner Zeit. */
  mondayDate: string
  /** "YYYY-MM-DD" des Sonnabends in Berliner Zeit. */
  saturdayDate: string
  /** Für Titel und Meldungen, z. B. „3.–8. August 2026". */
  label: string
}

export function lastCompleteWeek(now: Date): WrapupWeek {
  const today = berlinDateStr(now)
  const dow = weekdayOf(today) // 0=So, 1=Mo … 6=Sa
  // SONNTAG IST DER SONDERFALL: dort ist die Woche Mo–Sa gerade zu Ende
  // gegangen, ihr Montag liegt sechs Tage zurück. An jedem anderen Tag läuft
  // bereits die neue Woche, die letzte abgeschlossene beginnt also eine weitere
  // Woche früher: Montag −7, Dienstag −8 … Samstag −12.
  const back = dow === 0 ? 6 : 6 + dow
  const monday = addDays(today, -back)
  const saturday = addDays(monday, 5)
  return {
    mondayIso: berlinMidnightIso(monday),
    saturdayEndIso: berlinMidnightIso(addDays(monday, 6)),
    mondayDate: monday,
    saturdayDate: saturday,
    // Label ueber Mo–So (nicht Mo–Sa): s. formatLabel.
    label: formatLabel(monday, addDays(monday, 6)),
  }
}

// --- Frei wählbarer Zeitraum (Betreiber-Wunsch 2026-10-24) -------------------
// Im Admin sind die letzten zehn Tage (heute eingeschlossen) als Von/Bis
// wählbar. Die Feldnamen von WrapupWeek (mondayIso …) bleiben, damit
// collect.ts und build.ts unverändert mit beiden Fenstern arbeiten: `monday*`
// ist der erste, `saturday*` der letzte gewählte Tag.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/**
 * Fenster für einen gewählten Zeitraum, beide Tage inklusiv: von 00:00 Berliner
 * Zeit des ersten Tags bis 00:00 des Tags NACH dem letzten (exklusiv) — der
 * letzte Tag zählt also ganz, auch ein Artikel von 23:30.
 */
export function dateRangeWindow(fromDate: string, toDate: string): WrapupWeek {
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    throw new Error(`Ungültiges Datum: ${fromDate} / ${toDate} (erwartet YYYY-MM-DD)`)
  }
  if (fromDate > toDate) throw new Error(`Zeitraum verdreht: ${fromDate} liegt nach ${toDate}`)
  return {
    mondayIso: berlinMidnightIso(fromDate),
    saturdayEndIso: berlinMidnightIso(addDays(toDate, 1)),
    mondayDate: fromDate,
    saturdayDate: toDate,
    label: formatLabel(fromDate, toDate),
  }
}

/** Die letzten `count` Berliner Kalendertage, ältester zuerst, heute zuletzt —
 *  mit Anzeige-Label „Fr, 24.10.2026" für die Auswahl im Admin. */
export function selectableDays(now: Date, count = 10): Array<{ date: string; label: string }> {
  const today = berlinDateStr(now)
  const out: Array<{ date: string; label: string }> = []
  for (let back = count - 1; back >= 0; back--) {
    const date = addDays(today, -back)
    const [y, m, d] = date.split('-')
    out.push({ date, label: `${WEEKDAY_SHORT[weekdayOf(date)]}, ${d}.${m}.${y}` })
  }
  return out
}

/**
 * Vorschlag für die Auswahl: Montag der laufenden Woche bis heute. Am Sonntag
 * endet der Vorschlag mit dem Sonnabend — der Sonntag gehört nach der Konvention
 * des Rückblicks (Mo–Sa) nicht dazu. Der Montag wird auf den ältesten wählbaren
 * Tag geklemmt, falls das Fenster kleiner ist.
 */
export function defaultRange(now: Date, count = 10): { from: string; to: string } {
  const today = berlinDateStr(now)
  const to = weekdayOf(today) === 0 ? addDays(today, -1) : today
  const monday = addDays(to, -((weekdayOf(to) + 6) % 7))
  const oldest = addDays(today, -(count - 1))
  return { from: monday < oldest ? oldest : monday, to }
}

/**
 * Prüft einen vom Admin gewählten Zeitraum. `null` heißt gültig, sonst die
 * Meldung für die 400-Antwort. Höchstens `maxDays` Tage, nichts in der
 * Zukunft — die Auswahl im Panel bietet genau diese Tage an, die Route traut
 * dem Browser aber nicht.
 */
export function rangeError(from: unknown, to: unknown, now: Date, maxDays = 10): string | null {
  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return 'Zeitraum: „von“ und „bis“ werden als YYYY-MM-DD erwartet.'
  }
  if (from > to) return 'Zeitraum verdreht: „von“ liegt nach „bis“.'
  if (to > berlinDateStr(now)) return 'Das Enddatum liegt in der Zukunft.'
  const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1
  if (span > maxDays) return `Der Zeitraum darf höchstens ${maxDays === 10 ? 'zehn' : maxDays} Tage umfassen.`
  return null
}
