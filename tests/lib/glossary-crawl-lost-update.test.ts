/**
 * Lost Update im Crawl-Zustand.
 *
 * PROD-BEFUND 2026-08-08: Waehrend ein Erzeugen-Job lief, wurden 78 Kandidaten
 * abgewaehlt. Beim naechsten Tick waren sie wieder da — `excluded` stand auf dem
 * Stand von vor der Abwahl, die Zeitstempel von State und Job waren auf die
 * Sekunde identisch (08:16:23).
 *
 * URSACHE: Fortschritt und Auswahl liegen in DERSELBEN JSONB-Spalte
 * (settings.glossary_crawl_state). Der Job liest den ganzen Zustand zu Beginn
 * seines Ticks, arbeitet 45-90 Sekunden an einem Begriff und schreibt am Ende
 * `{ ...state, candidates, generated }` zurueck — das `...state` traegt das
 * ALTE `excluded` mit. Jede Abwahl in diesem Zeitfenster ist verloren.
 *
 * Das trifft nicht nur Skripte: der Operator waehlt im Panel waehrend eines
 * laufenden Laufs ab, und seine Entscheidung verschwindet ohne Fehlermeldung.
 * Das Panel sperrt zwar extract/generate/reset waehrend `termsRunning` — die
 * Abwahl-Checkboxen aber nicht.
 *
 * Der Fix betrifft die Schreibrichtung: wer FORTSCHRITT schreibt, darf die
 * AUSWAHL nicht mitschreiben, sondern muss sie frisch uebernehmen.
 */
import { describe, expect, it } from 'vitest'
import { mergeProgressState, type CrawlState } from '@/lib/glossary/crawl'

const stale: CrawlState = {
  cursor: '2026-08-01T00:00:00Z',
  postsProcessed: 10,
  candidates: { Alpha: 1, Beta: 2 },
  generated: ['alpha'],
  excluded: [],           // Stand zu Beginn des Ticks
  relinkCursor: null,
  translationsCursor: null,
  updatedAt: null,
}

describe('mergeProgressState', () => {
  it('uebernimmt die AKTUELLE Auswahl statt der aus dem alten Snapshot', () => {
    // Der Kern: „Beta" wurde abgewaehlt, waehrend der Tick lief.
    const merged = mergeProgressState(stale, ['Beta'], { generated: ['alpha', 'beta'] })
    expect(merged.excluded).toEqual(['Beta'])
  })

  it('schreibt den Fortschritt des Ticks trotzdem', () => {
    const merged = mergeProgressState(stale, ['Beta'], {
      generated: ['alpha', 'beta'],
      postsProcessed: 20,
    })
    expect(merged.generated).toEqual(['alpha', 'beta'])
    expect(merged.postsProcessed).toBe(20)
  })

  it('laesst unveraenderte Felder unangetastet', () => {
    const merged = mergeProgressState(stale, [], { generated: ['alpha'] })
    expect(merged.cursor).toBe('2026-08-01T00:00:00Z')
    expect(merged.candidates).toEqual({ Alpha: 1, Beta: 2 })
  })

  it('kommt mit einer leeren aktuellen Auswahl zurecht', () => {
    // Der Operator hat waehrend des Ticks eine Abwahl RUECKGAENGIG gemacht —
    // auch das ist die aktuelle Wahrheit und darf nicht ueberschrieben werden.
    const withExcluded = { ...stale, excluded: ['Beta'] }
    const merged = mergeProgressState(withExcluded, [], { generated: ['alpha'] })
    expect(merged.excluded).toEqual([])
  })
})
