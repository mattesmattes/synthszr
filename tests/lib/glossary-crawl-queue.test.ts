/**
 * Zählung der offenen Kandidaten im Artikel-Crawl.
 *
 * Anlass ist ein Abbruch in Prod (2026-08-05): der Batch "alle ausgewählten
 * erzeugen" lief nicht durch. Zwei Ursachen, davon eine hier — die Route meldete
 * als `remainingCandidates` die Zahl ALLER Kandidaten, inklusive der abgewählten.
 * Die Browser-Schleife läuft aber, bis diese Zahl 0 ist. Mit auch nur einem
 * abgewählten Kandidaten (bei uns: 177 von 178 ausgewählt) tritt das nie ein.
 */
import { describe, expect, it } from 'vitest'
import { openCandidateCount } from '@/lib/glossary/crawl'

describe('openCandidateCount', () => {
  it('zählt Kandidaten, die weder abgewählt noch erzeugt sind', () => {
    expect(openCandidateCount({ Alpha: 3, Beta: 2 }, [], [])).toBe(2)
  })

  it('zählt ABGEWÄHLTE nicht mit', () => {
    // Der Kern des Fehlers: sie bleiben absichtlich in der Liste, damit der
    // Operator seine Entscheidung sieht — aber sie sind keine offene Arbeit.
    expect(openCandidateCount({ Alpha: 3, Beta: 2 }, ['Beta'], [])).toBe(1)
  })

  it('zählt bereits ERZEUGTE nicht mit', () => {
    expect(openCandidateCount({ Alpha: 3, Beta: 2 }, [], ['alpha'])).toBe(1)
  })

  it('vergleicht Erzeugte über den Slug, nicht über den Namen', () => {
    // In `generated` stehen Slugs, in `candidates` die Anzeigenamen.
    expect(openCandidateCount({ 'Mixture of Experts': 2 }, [], ['mixture-of-experts'])).toBe(0)
  })

  it('gibt 0 zurück, wenn alles abgearbeitet oder abgewählt ist', () => {
    expect(openCandidateCount({ Alpha: 1, Beta: 1 }, ['Beta'], ['alpha'])).toBe(0)
  })

  it('verkraftet eine leere Kandidatenliste', () => {
    expect(openCandidateCount({}, [], [])).toBe(0)
  })
})
