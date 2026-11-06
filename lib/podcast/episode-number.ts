/**
 * Folgennummer in der Begrüßung und Jubiläumsfolgen (Betreiber 2026-11-06).
 *
 * Die Nummer ist die Ausgabenummer der Website (`synthszrIssueNumber` in
 * lib/i18n/config.ts, „synthszr #311 vom Donnerstag, den 05.11.2026“): ganze
 * Tage seit dem 29.12.2025, aus dem `created_at` des Posts. Podcast und
 * Artikel tragen so immer dieselbe Zahl.
 *
 * Nicht verwechseln mit `podcast_personality_state.episode_count` (zählt jede
 * Audio-Erzeugung, auch Neuläufe) oder mit der Rotation der Einstiegs-Modi
 * (`pickOpener`, läuft weiter über die Tages-Nummer im Jahr).
 */

export type Milestone = 'none' | 'round' | 'big'

/** Runde Folgen: jede 50. (350, 450 …) wird kurz gefeiert, jede 100.
 *  (400, 500 …) etwas ausgiebiger. */
export function milestoneOf(episode: number | null): Milestone {
  if (!episode || episode <= 0) return 'none'
  if (episode % 100 === 0) return 'big'
  if (episode % 50 === 0) return 'round'
  return 'none'
}

/** Einschub für den Wiedererkennungssatz, direkt hinter dem Datum. */
export function episodeGreetingSuffix(episode: number | null, lang: 'de' | 'en'): string {
  if (!episode) return ''
  return lang === 'de' ? `, mit Folge ${episode}` : `, episode ${episode}`
}

/** Prompt-Abschnitt für Jubiläumsfolgen; leer bei allen anderen. */
export function milestonePromptSection(episode: number | null, lang: 'de' | 'en'): string {
  const m = milestoneOf(episode)
  if (m === 'none') return ''
  if (lang === 'de') {
    const umfang = m === 'big'
      ? 'Das ist ein großes Jubiläum: Gebt ihm etwas mehr Raum (vier bis sechs Wechsel).'
      : 'Haltet es kurz (zwei bis vier Wechsel).'
    return `\n\n**JUBILÄUMSFOLGE (PFLICHT):**
Heute ist Folge ${episode}, eine runde Nummer. HOST und GUEST feiern das hörbar. Die Feier beginnt direkt nach dem Wiedererkennungssatz und kommt vor dem Themen-Teaser. ${umfang}
- Echte Freude statt Pflichtprogramm: anstoßen, sich gegenseitig aufziehen, den Hörern danken.
- Rückblicke nur mit dem, was das Episoden-Gedächtnis hergibt. Nichts über frühere Folgen erfinden.
- Keine Geräusch-Anweisungen wie Gläserklirren oder Applaus: Es ist ein Gespräch, kein Hörspiel.
- Im Outro einmal kurz auf das Jubiläum zurückkommen.`
  }
  const scope = m === 'big'
    ? 'This is a big milestone: give it a little more room (four to six exchanges).'
    : 'Keep it short (two to four exchanges).'
  return `\n\n**MILESTONE EPISODE (MANDATORY):**
Today is episode ${episode}, a round number. HOST and GUEST celebrate it audibly. The celebration starts right after the recognisable greeting, before the topic tease. ${scope}
- Real joy, not a duty: raise a toast, tease each other, thank the listeners.
- Look back only with what the episode memory provides. Never invent details about earlier episodes.
- No sound cues like clinking glasses or applause: this is a conversation, not a radio play.
- In the outro, refer back to the milestone once, briefly.`
}
