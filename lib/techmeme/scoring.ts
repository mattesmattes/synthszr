/**
 * Techmemes Kuration als Bewertung.
 *
 * BETREIBER-ENTSCHEIDUNG 2026-08-13: „Techmemes Rangfolge ist bereits eine
 * redaktionelle Bewertung, die wir sonst wegwerfen."
 *
 * Der erste Produktionslauf zeigte, warum das nötig ist: Die 69 Einträge kamen
 * mit Werten zwischen 0,02 und 0,31 in eine Queue, deren Median bei 6,1 liegt.
 * Sie standen ganz unten und wären nie aufgefallen — der Job hätte Material
 * geliefert, das niemand sieht. Grund: `synthesis_score` und die beiden anderen
 * werden von der Synthese-Pipeline gesetzt, die auf `daily_repo` arbeitet, und
 * Techmeme-Einträge haben keinen Eintrag dort.
 *
 * DREI SIGNALE, ALLE VON TECHMEME SELBST:
 *
 * 1. POSITION der Story auf der Startseite. Techmemes Haupturteil darüber, was
 *    heute zählt — die einzige Angabe, die eine Redaktion bewusst setzt.
 * 2. BREITE: wie viele Publikationen darüber berichten. Heute gemessen zwischen
 *    1 und 41. Berichten vierzig Häuser, ist es ein Großereignis; bei einem ist
 *    es eine Randnotiz.
 * 3. RANG der Quelle innerhalb der Story. Rang 0 ist Techmemes Auswahl der
 *    besten Darstellung.
 *
 * SKALA 0–10, ausgerichtet an der gemessenen Verteilung der pending-Queue
 * (Median 6,1 · p75 8,6 · p90 9,7 · Maximum 14,9). Eine Top-Story landet damit
 * im obersten Zehntel, eine Randmeldung unten — und die eigene Bewertung wird
 * nicht überstimmt, weil deren Spitze über 10 hinausreicht.
 */

export interface CurationInput {
  /** Position der Story auf der Startseite, 0 = ganz oben. */
  storyIndex: number
  /** Wie viele Stories die Seite hatte. */
  totalStories: number
  /** Wie viele Publikationen Techmeme zu dieser Story listet. */
  sourceCount: number
  /** Position dieser Quelle innerhalb der Story, 0 = Hauptmeldung. */
  rank: number
}

/** Ab dieser Breite bringt jede weitere Publikation kaum noch etwas. */
const BREITE_SAETTIGUNG = 30

/**
 * Gewicht der Position gegenüber der Breite.
 *
 * Die Position wiegt schwerer: Sie ist eine redaktionelle Setzung, die Breite
 * ergibt sich aus dem Verhalten anderer Häuser. Beide zusammen ergeben 1,0.
 */
const GEWICHT_POSITION = 0.55
const GEWICHT_BREITE = 0.45

/**
 * Abschlag je Rangstufe innerhalb der Story.
 *
 * Bewusst klein: Über zehn Ränge summiert er sich auf höchstens 27 Prozent und
 * bleibt damit unter dem Abstand zweier Stories. Sonst schlüge die zehnte
 * Quelle einer Top-Story die Hauptmeldung der nächsten — und genau die
 * Reihenfolge, die wir übernehmen wollen, wäre verdreht.
 */
const RANG_ABSCHLAG = 0.03

export function curationScore(input: CurationInput): number {
  const { storyIndex, totalStories, sourceCount, rank } = input

  const gesamt = Math.max(1, totalStories)
  const platz = Math.min(Math.max(0, storyIndex), gesamt - 1)
  const position = 1 - platz / gesamt

  // Logarithmisch: Der Sprung von 1 auf 5 berichtende Häuser sagt mehr aus als
  // der von 35 auf 39.
  const breite = Math.min(1, Math.log10(Math.max(0, sourceCount) + 1) / Math.log10(BREITE_SAETTIGUNG + 1))

  const rangFaktor = 1 - Math.min(Math.max(0, rank), 9) * RANG_ABSCHLAG

  const roh = 10 * (GEWICHT_POSITION * position + GEWICHT_BREITE * breite) * rangFaktor
  const begrenzt = Math.min(10, Math.max(0, roh))

  // Eine Nachkommastelle: Die Spalten sind NUMERIC(3,1), Postgres rundete sonst
  // selbst — und die Werte hier wären nicht die, die in der Datenbank stehen.
  return Number(begrenzt.toFixed(1))
}
