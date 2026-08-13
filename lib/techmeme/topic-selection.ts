/**
 * Welche Techmeme-Stories werden „Thema des Tages"?
 *
 * BETREIBER-VORGABE 2026-08-13: Die fünf obersten Stories, vollautomatisch bis
 * in den Post.
 *
 * DIE FALLE, DIE DIESE DATEI VERHINDERT: Der Job läuft alle vier Stunden.
 * Markierte jeder Lauf schlicht „die obersten fünf", stünden nach sechs Läufen
 * bis zu dreißig Leitartikel im Tagespost — jeder bis zu 25 Sätze lang.
 * Bereits vorgemerkte Themen zählen deshalb mit.
 */

/** Wie viele Bündel-Themen der Tagespost höchstens trägt. */
export const TOPIC_STORY_LIMIT = 5

/**
 * Die Story-Schlüssel, die als Thema gelten sollen.
 *
 * @param storyKeys  Schlüssel der aktuellen Stories, in Techmemes Reihenfolge.
 * @param aktiv      Schlüssel, die bereits als Thema vorgemerkt sind.
 *
 * Vorgemerkte Themen BLEIBEN, auch wenn ihre Story inzwischen nach unten
 * gerutscht ist: Sonst verlöre der Post auf halbem Weg einen Abschnitt, dessen
 * Quellen schon geschrieben sind.
 *
 * Aufgefüllt wird nur aus den OBERSTEN Stories — „Top 5" heißt oben, nicht „die
 * ersten fünf, die noch frei sind". Stünden vier Themen fest, dürfte nicht
 * Platz 20 nachrücken.
 */
export function pickTopicStories(storyKeys: string[], aktiv: Set<string>): Set<string> {
  const gewaehlt = new Set(aktiv)

  for (const key of storyKeys.slice(0, TOPIC_STORY_LIMIT)) {
    if (gewaehlt.size >= TOPIC_STORY_LIMIT) break
    gewaehlt.add(key)
  }
  return gewaehlt
}
