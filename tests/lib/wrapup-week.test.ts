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
import { lastCompleteWeek } from '@/lib/wrapup/week'

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

  it('bildet ein lesbares Label', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.label).toBe('3.–8. August 2026')
  })

  it('verkraftet einen Monatswechsel im Label', () => {
    // Woche vom 29. Juni bis 4. Juli 2026
    const w = lastCompleteWeek(new Date('2026-07-05T10:00:00Z'))
    expect(w.label).toBe('29. Juni – 4. Juli 2026')
  })
})
