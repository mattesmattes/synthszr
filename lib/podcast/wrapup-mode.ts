/**
 * Wochenrückblick-Modus für das Podcast-Skript.
 *
 * Betreiber-Vorgabe 2026-08-09: Bei einem Wochenrückblick sollen die beiden
 * Stimmen merken, dass es KEINE Tagesnews sind. Ohne diesen Hinweis arbeiten
 * sie den Rückblick ab wie jeden anderen Artikel — Thema für Thema, ohne den
 * Bogen über die Woche, ohne die ruhigere Haltung eines Sonntags.
 *
 * Der Zusatz wird an den bestehenden Skript-Prompt gehängt, nach demselben
 * Muster wie der optionale Smalltalk-Abschnitt in der generate-script-Route.
 * Das Grundgerüst (Länge, Format, Sprecherwechsel, Personality) bleibt damit
 * unangetastet — nur die Haltung kommt dazu.
 */

/**
 * Ist dieser Artikel ein Wochenrückblick?
 *
 * Geprüft werden SLUG UND TITEL. Den Slug erzeugt die Wrap-up-Route
 * deterministisch (`ai-week-wrap-up-YYYY-MM-DD`), der Titel folgt dem
 * Betreiber-Muster („Die AI-Themen der Woche vom …") — aber beide sind im
 * Editor änderbar. Zwei Wege bedeuten, dass eine redaktionelle Änderung an
 * einem von beiden den Modus nicht still abschaltet.
 */
export function isWeekWrapup(
  slug: string | null | undefined,
  title: string | null | undefined,
): boolean {
  if (slug?.startsWith('ai-week-wrap-up')) return true
  return (title ?? '').toLowerCase().includes('die ai-themen der woche')
}

const DE = `

**WOCHENRÜCKBLICK — DIESE FOLGE IST ANDERS:**
Dies ist NICHT die tägliche Nachrichtenausgabe, sondern der Rückblick auf eine ganze Woche. Der Artikel führt von Montag bis Sonnabend durch die wichtigsten Themen. Das ändert, wie ihr sprecht:

- FÜHRT DURCH DIE WOCHE. Benennt die Wochentage ("Am Montag…", "Mittwoch dann…"). Die Chronologie ist der rote Faden der Folge, nicht eine Liste abgehakter Themen.
- STELLT ZUSAMMENHÄNGE HER. Wo ein Thema am Donnerstag zu etwas vom Montag gehört, sagt das ausdrücklich. Genau dafür ist dieses Format da. Erfindet aber keine Bezüge, wo keine sind.
- SEID REFLEKTIERTER. Ihr redet nicht über frische Meldungen, sondern über eine Woche, die schon vorbei ist. Ihr habt Abstand. Fragt euch, was am Ende der Woche hängengeblieben ist, was sich verschoben hat, was vorschnell wirkte.
- RUHIGERES TEMPO. Es ist Sonntag. Weniger Betriebsamkeit als in einer Tagesfolge, mehr Nachdenken.
- Am Ende zieht ihr ein kurzes Fazit über die Woche als Ganzes, nicht über das letzte Thema.`

const EN = `

**WEEKLY WRAP-UP — THIS EPISODE IS DIFFERENT:**
This is NOT the daily news edition but a look back at an entire week. The article walks through the main topics from Monday to Saturday. That changes how you speak:

- WALK THROUGH THE WEEK. Name the weekdays ("On Monday…", "Then Wednesday…"). The chronology is the thread of this episode, not a list of topics checked off.
- MAKE CONNECTIONS. Where a Thursday topic belongs to something from Monday, say so explicitly. That is what this format is for. But do not invent connections that are not there.
- BE MORE REFLECTIVE. You are not discussing fresh headlines but a week that is already over. You have distance. Ask what stuck by the end of the week, what shifted, what looks premature in hindsight.
- SLOWER PACE. It is Sunday. Less bustle than a daily episode, more thinking.
- Close with a short verdict on the week as a whole, not on the last topic.`

/** Der anzuhängende Prompt-Abschnitt, in der Sprache des Podcasts. */
export function wrapupPromptSection(ttsLang: string): string {
  return ttsLang === 'de' ? DE : EN
}
