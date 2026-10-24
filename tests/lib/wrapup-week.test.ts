/**
 * Wochenfenster des Wrap-ups: die letzte ABGESCHLOSSENE Woche, Montag bis
 * Sonnabend.
 *
 * Die Zeitzone ist hier kein Detail: Vercel läuft auf UTC, der Betreiber und
 * die Artikel-Zeitstempel auf Europe/Berlin. Eine Wochengrenze ohne explizite
 * Zone verschiebt sich um zwei Stunden — ein Artikel von Montag 00:30 Berliner
 * Zeit fiele dann in die Vorwoche.
 */
import { describe, expect, it } from 'vitest'
import { lastCompleteWeek, dateRangeWindow, selectableDays, defaultRange, rangeError } from '@/lib/wrapup/week'

describe('lastCompleteWeek', () => {
  it('liefert von Sonntag aus die gerade vergangene Woche', () => {
    // Sonntag, 9. August 2026, 12:00 Berliner Zeit
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.mondayDate).toBe('2026-08-03')
  })

  it('liefert von Montag aus dieselbe Woche wie von Sonntag', () => {
    // Der Betreiber drückt Montag früh — er erwartet die Woche davor, nicht
    // die gerade erst begonnene.
    const w = lastCompleteWeek(new Date('2026-08-10T06:00:00Z'))
    expect(w.mondayDate).toBe('2026-08-03')
  })

  it('liefert mitten in der Woche weiterhin die letzte abgeschlossene', () => {
    // Mittwoch, 12. August
    const w = lastCompleteWeek(new Date('2026-08-12T09:00:00Z'))
    expect(w.mondayDate).toBe('2026-08-03')
  })

  it('setzt die obere Grenze auf den Sonntag — Sonntag selbst faellt raus', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.saturdayDate).toBe('2026-08-08')
    // Die Grenze ist Sonntag 00:00 Berliner Zeit = Samstag 22:00 UTC. Ein
    // Artikel von Samstag 23:00 Berliner Zeit liegt DAVOR und zaehlt noch mit.
    expect(new Date(w.saturdayEndIso).getTime())
      .toBeGreaterThan(new Date('2026-08-08T21:00:00Z').getTime())
  })

  // Titel-Muster, Betreiber-Vorgabe 2026-08-09:
  //   "Die AI-Themen der Woche vom 3. bis 9. August 2026"
  // Das Label nennt also die volle KALENDERWOCHE Mo–So, obwohl der Inhalt bis
  // Sonnabend reicht. Der Rueckblick erscheint fruehestens am Sonntag; der
  // Zeitraum im Titel ist die Woche als Ganzes, nicht die Liste der Beitraege.
  it('bildet das Label ueber die volle Kalenderwoche bis Sonntag', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.label).toBe('3. bis 9. August 2026')
  })

  it('verkraftet einen Monatswechsel im Label', () => {
    // Woche vom 29. Juni bis 5. Juli 2026
    const w = lastCompleteWeek(new Date('2026-07-05T10:00:00Z'))
    expect(w.label).toBe('29. Juni bis 5. Juli 2026')
  })

  it('nennt den Monat nur einmal, wenn die Woche nicht wechselt', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.label.match(/August/g)).toHaveLength(1)
  })
})

// --- Frei waehlbarer Zeitraum (Betreiber-Wunsch 2026-10-24) ------------------
// Im Admin sind die letzten zehn Tage (heute eingeschlossen) als Von/Bis
// waehlbar. Die Tage kommen vom Server, damit die Berliner Zeitzone an EINER
// Stelle gerechnet wird — der Browser des Betreibers kann in China stehen.
describe('dateRangeWindow', () => {
  it('spannt das Fenster von Mitternacht des ersten bis Mitternacht NACH dem letzten Tag (Berlin)', () => {
    const w = dateRangeWindow('2026-10-20', '2026-10-24')
    expect(w.mondayDate).toBe('2026-10-20')
    expect(w.saturdayDate).toBe('2026-10-24')
    // MESZ: 00:00 Berlin = 22:00Z des Vortags. Der letzte Tag zaehlt GANZ mit.
    expect(w.mondayIso).toBe('2026-10-19T22:00:00.000Z')
    expect(w.saturdayEndIso).toBe('2026-10-24T22:00:00.000Z')
  })

  it('bildet das Label ueber genau den gewaehlten Zeitraum', () => {
    expect(dateRangeWindow('2026-10-20', '2026-10-24').label).toBe('20. bis 24. Oktober 2026')
  })

  it('lehnt ein verdrehtes oder ungueltiges Datum ab', () => {
    expect(() => dateRangeWindow('2026-10-24', '2026-10-20')).toThrow()
    expect(() => dateRangeWindow('24.10.2026', '2026-10-24')).toThrow()
  })
})

describe('selectableDays', () => {
  it('liefert die letzten zehn Berliner Tage, heute zuletzt', () => {
    // Sonnabend, 24.10.2026, 18:00 Berlin
    const days = selectableDays(new Date('2026-10-24T16:00:00Z'))
    expect(days).toHaveLength(10)
    expect(days[0].date).toBe('2026-10-15')
    expect(days[9].date).toBe('2026-10-24')
    expect(days[9].label).toBe('Sa, 24.10.2026')
  })

  it('rechnet in Berliner Zeit: kurz nach Mitternacht Berlin ist der neue Tag schon dabei', () => {
    // 22:30Z am 24.10. = 00:30 MESZ am 25.10. (Umstellung erst 25.10. 03:00)
    const days = selectableDays(new Date('2026-10-24T22:30:00Z'))
    expect(days[9].date).toBe('2026-10-25')
  })
})

describe('defaultRange', () => {
  it('schlaegt Montag der laufenden Woche bis heute vor', () => {
    expect(defaultRange(new Date('2026-10-24T16:00:00Z'))).toEqual({ from: '2026-10-19', to: '2026-10-24' }) // Sonnabend
  })

  it('endet am Sonntag mit dem Sonnabend — der Sonntag gehoert nicht zur Woche', () => {
    expect(defaultRange(new Date('2026-10-25T10:00:00Z'))).toEqual({ from: '2026-10-19', to: '2026-10-24' }) // Sonntag
  })

  it('klemmt den Montag auf den aeltesten waehlbaren Tag', () => {
    expect(defaultRange(new Date('2026-10-24T16:00:00Z'), 3)).toEqual({ from: '2026-10-22', to: '2026-10-24' })
  })
})

describe('rangeError', () => {
  const now = new Date('2026-10-24T16:00:00Z') // Sonnabend, 24.10.

  it('akzeptiert einen gueltigen Zeitraum innerhalb der letzten zehn Tage', () => {
    expect(rangeError('2026-10-19', '2026-10-24', now)).toBeNull()
    expect(rangeError('2026-10-15', '2026-10-24', now)).toBeNull()
  })

  it('weist fehlende oder falsch formatierte Werte ab', () => {
    expect(rangeError(undefined, '2026-10-24', now)).toMatch(/YYYY-MM-DD/)
    expect(rangeError('24.10.2026', '2026-10-24', now)).toMatch(/YYYY-MM-DD/)
  })

  it('weist einen verdrehten Zeitraum ab', () => {
    expect(rangeError('2026-10-24', '2026-10-20', now)).toMatch(/verdreht/)
  })

  it('weist ein Enddatum in der Zukunft und einen zu weiten Zeitraum ab', () => {
    expect(rangeError('2026-10-20', '2026-10-25', now)).toMatch(/Zukunft/)
    expect(rangeError('2026-10-14', '2026-10-24', now)).toMatch(/zehn Tage/)
  })
})
