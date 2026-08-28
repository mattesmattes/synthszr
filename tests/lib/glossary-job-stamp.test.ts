/**
 * Die Zeitstempel im Lexikon-Protokoll tragen auch das Datum.
 *
 * Betreiber-Wunsch 28.08.2026: Die Glossar-Jobs laufen resumable über viele
 * Cron-Ticks und damit über Tagesgrenzen hinweg. Eine reine Uhrzeit ließ offen,
 * ob ein Protokolleintrag von heute oder vorgestern stammt.
 *
 * Die Zeitzone bleibt zwingend Europe/Berlin (Befund N3 im Quelltext): Auf
 * Vercel ist die Serverzeit UTC, und ohne die explizite Zone verschöbe sich die
 * Bedeutung der Spalte still um zwei Stunden. Mit Datum wiegt das schwerer als
 * vorher — ein Eintrag um 00:30 Berliner Zeit trüge sonst das Datum des
 * Vortages.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

// advance.ts zieht ueber lib/glossary/crawl die Bildpipeline und damit sharp
// herein, das unter vitest nicht laedt. Gleicher Mock wie in
// glossary-jobs-advance.test.ts — hier interessiert nur stamp().
vi.mock('@/lib/glossary/crawl', () => ({
  extractCandidates: vi.fn(),
  generateCandidates: vi.fn(),
  generateMissingIllustrations: vi.fn(),
  relinkNextBatch: vi.fn(),
  relinkTranslationsNextBatch: vi.fn(),
}))
vi.mock('@/lib/glossary/pending-run', () => ({ runPendingUnit: vi.fn() }))
vi.mock('@/lib/glossary/translate-missing', () => ({ translateMissingTerms: vi.fn() }))
vi.mock('@/lib/glossary/terms', () => ({ getMatcherTerms: vi.fn() }))
vi.mock('@/lib/glossary/jobs/service', () => ({
  appendLog: vi.fn(), finishJob: vi.fn(), setAttempts: vi.fn(),
  stampLease: vi.fn(), releaseLease: vi.fn(), readCancelRequested: vi.fn(),
}))

import { stamp } from '@/lib/glossary/jobs/advance'

describe('Zeitstempel im Lexikon-Protokoll', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('zeigt Datum und Uhrzeit', () => {
    vi.setSystemTime(new Date('2026-08-28T12:23:45Z')) // 14:23:45 Berliner Zeit
    expect(stamp()).toBe('28.08., 14:23:45')
  })

  it('rechnet in Berliner Zeit, nicht in UTC', () => {
    // 22:30 UTC ist in Berlin (Sommerzeit, +2) bereits der naechste Tag.
    // Ohne timeZone stuende hier der 27.08. um 22:30 — falscher Tag UND
    // falsche Stunde.
    vi.setSystemTime(new Date('2026-08-27T22:30:00Z'))
    expect(stamp()).toBe('28.08., 00:30:00')
  })

  it('beachtet die Winterzeit (+1 statt +2)', () => {
    vi.setSystemTime(new Date('2026-01-15T23:10:05Z'))
    expect(stamp()).toBe('16.01., 00:10:05')
  })
})
