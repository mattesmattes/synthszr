/**
 * Zeitbezug statt Folgennummer im Podcast-Dialog.
 *
 * Betreiberwunsch 2026-08-23: Synthszr und Emma sollen sich nicht auf
 * "Episode 251" beziehen — das sagt einem Hoerer nichts. Stattdessen:
 *   unter einer Woche  -> Wochentag        ("wie letzten Dienstag")
 *   unter einem Monat  -> Wochenabstand    ("wie wir vor zwei Wochen besprochen haben")
 *   ab einem Monat     -> Monatsname       ("wie schon im Mai")
 *
 * Der Bezug wird in der ZIELSPRACHE geliefert, nicht auf Deutsch: der
 * Skript-Prompt ist deutsch, und deutsche Textbausteine darin haben schon
 * einmal englische Folgen ins Deutsche driften lassen (Befund INTERMEZZO,
 * project_podcast_intermezzo_lang).
 */
import { describe, expect, it } from 'vitest'
import { episodeTimeReference } from '@/lib/podcast/episode-reference'

// Referenz: Sonntag, 23. August 2026
const now = new Date('2026-08-23T09:00:00+02:00')
const ref = (iso: string, locale = 'de') => episodeTimeReference(iso, locale, now)

describe('episodeTimeReference — unter einer Woche: Wochentag', () => {
  it('nennt den Wochentag', () => {
    // Dienstag, 18.08. — fuenf Tage her
    expect(ref('2026-08-18T07:00:00+02:00')).toBe('letzten Dienstag')
  })

  it('auch am Vortag', () => {
    expect(ref('2026-08-22T07:00:00+02:00')).toBe('letzten Samstag')
  })

  it('auf Englisch', () => {
    expect(ref('2026-08-18T07:00:00+02:00', 'en')).toBe('last Tuesday')
  })
})

describe('episodeTimeReference — unter einem Monat: Wochenabstand', () => {
  it('eine Woche', () => {
    // 14.08. — neun Tage her
    expect(ref('2026-08-14T07:00:00+02:00')).toBe('vor einer Woche')
  })

  it('zwei Wochen', () => {
    expect(ref('2026-08-07T07:00:00+02:00')).toBe('vor zwei Wochen')
  })

  it('drei Wochen', () => {
    expect(ref('2026-07-31T07:00:00+02:00')).toBe('vor drei Wochen')
  })

  it('auf Englisch', () => {
    expect(ref('2026-08-07T07:00:00+02:00', 'en')).toBe('two weeks ago')
  })
})

describe('episodeTimeReference — ab einem Monat: Monatsname', () => {
  it('nennt den Monat', () => {
    expect(ref('2026-05-12T07:00:00+02:00')).toBe('im Mai')
    expect(ref('2026-04-03T07:00:00+02:00')).toBe('im April')
  })

  it('auf Englisch', () => {
    expect(ref('2026-05-12T07:00:00+02:00', 'en')).toBe('in May')
  })

  it('nennt bei einem Jahresabstand auch das Jahr — sonst klaenge es wie letzten Mai', () => {
    expect(ref('2025-05-12T07:00:00+02:00')).toBe('im Mai 2025')
    expect(ref('2025-05-12T07:00:00+02:00', 'en')).toBe('in May 2025')
  })
})

describe('episodeTimeReference — Randfaelle', () => {
  it('faellt bei unbekannter Sprache auf Englisch zurueck, nicht auf Deutsch', () => {
    // Deutsche Bausteine in einem fremdsprachigen Skript haben schon einmal
    // die ganze Passage ins Deutsche kippen lassen.
    expect(ref('2026-08-07T07:00:00+02:00', 'cs')).toBe('two weeks ago')
  })

  it('liefert bei kaputtem Datum null statt zu werfen', () => {
    expect(episodeTimeReference('kein-datum', 'de', now)).toBeNull()
  })

  it('behandelt 27 Tage noch als Wochen, 31 Tage als Monat', () => {
    expect(ref('2026-07-27T07:00:00+02:00')).toBe('vor vier Wochen')
    expect(ref('2026-07-20T07:00:00+02:00')).toBe('im Juli')
  })
})

describe('stripEpisodeNumbers', () => {
  it('entfernt Folgennummern aus gespeicherten Gag-Texten', async () => {
    // PROD-BEFUND 2026-08-23: In running_gags stand "Episode 262 slop argument
    // — HOST accuses GUEST…". Solche Altbestaende haetten die Nummer trotz
    // aller Prompt-Regeln zurueck in den Dialog getragen.
    const { stripEpisodeNumbers } = await import('@/lib/podcast/episode-reference')
    expect(stripEpisodeNumbers('Episode 262 slop argument — HOST accuses GUEST'))
      .toBe('slop argument — HOST accuses GUEST')
    expect(stripEpisodeNumbers('der Streit aus Folge 251 über Slop'))
      .toBe('der Streit über Slop')
    expect(stripEpisodeNumbers('Callback zu Episode #17')).toBe('Callback')
  })

  it('laesst Texte ohne Nummern unangetastet', async () => {
    const { stripEpisodeNumbers } = await import('@/lib/podcast/episode-reference')
    expect(stripEpisodeNumbers('der Slop-Streit')).toBe('der Slop-Streit')
  })

  it('laesst andere Zahlen in Ruhe — nur Folgenbezuege verschwinden', async () => {
    const { stripEpisodeNumbers } = await import('@/lib/podcast/episode-reference')
    expect(stripEpisodeNumbers('die 40-Prozent-Behauptung von LinkedIn'))
      .toBe('die 40-Prozent-Behauptung von LinkedIn')
  })
})
