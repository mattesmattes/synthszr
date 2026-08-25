/**
 * Verfuegbarkeits-Pruefung der oeffentlichen Seiten.
 *
 * ANLASS (2026-08-25): Ein zu offener pnpm-Override zog nanoid 6 herein
 * (ESM-only), postcss laedt es per require() — jede serverseitig gerenderte
 * Seite starb mit ERR_REQUIRE_ESM. ALLE Artikelseiten lieferten 500, und
 * bemerkt wurde es erst, als der Betreiber zufaellig eine URL oeffnete.
 *
 * ZWEI LEHREN, die hier eingebaut sind:
 *
 * 1. Die Locale-STARTSEITEN lieferten waehrend des Ausfalls weiter 200 — aus
 *    dem Edge-Cache (x-vercel-cache: STALE). Wer nur die Homepage prueft, sieht
 *    nichts. Deshalb gehoeren Artikel-, Begriffs- und Produktseiten in die Liste.
 *
 * 2. Aus demselben Grund braucht jede Anfrage einen Cache-Buster: sonst
 *    beantwortet der CDN-Cache die Frage, nicht die Funktion.
 */
import { describe, expect, it, vi } from 'vitest'
import { evaluateHealth, shouldNotify } from '@/lib/health/check'

const ok = (url: string) => ({ url, status: 200, ms: 120 })
const bad = (url: string, status = 500) => ({ url, status, ms: 90 })

describe('evaluateHealth', () => {
  it('meldet gesund, wenn alle Seiten 200 liefern', () => {
    const r = evaluateHealth([ok('/de'), ok('/de/posts/x'), ok('/de/rankings')])
    expect(r.healthy).toBe(true)
    expect(r.failed).toHaveLength(0)
  })

  it('meldet krank, sobald EINE Seite ausfaellt', () => {
    const r = evaluateHealth([ok('/de'), bad('/de/posts/x'), ok('/de/rankings')])
    expect(r.healthy).toBe(false)
    expect(r.failed.map((f) => f.url)).toEqual(['/de/posts/x'])
  })

  it('wertet 3xx als Erfolg — Weiterleitungen sind kein Ausfall', () => {
    expect(evaluateHealth([{ url: '/de', status: 308, ms: 10 }]).healthy).toBe(true)
  })

  it('wertet 404 als Ausfall — eine oeffentliche Seite darf nicht verschwinden', () => {
    expect(evaluateHealth([bad('/de/rankings', 404)]).healthy).toBe(false)
  })

  it('zaehlt geprüfte und fehlgeschlagene Seiten', () => {
    const r = evaluateHealth([ok('/a'), bad('/b'), bad('/c')])
    expect(r.checked).toBe(3)
    expect(r.failed).toHaveLength(2)
  })
})

describe('shouldNotify — Mail nur bei Zustandswechsel, kein Dauerfeuer', () => {
  it('meldet, wenn es vorher gesund war und jetzt kaputt ist', () => {
    expect(shouldNotify({ healthy: false }, { healthy: true })).toBe(true)
  })

  it('schweigt, wenn es schon beim letzten Lauf kaputt war', () => {
    // Alle vier Stunden dieselbe Mail waere nach einem Tag Rauschen.
    expect(shouldNotify({ healthy: false }, { healthy: false })).toBe(false)
  })

  it('meldet die Erholung, damit man das Ende des Ausfalls mitbekommt', () => {
    expect(shouldNotify({ healthy: true }, { healthy: false })).toBe(true)
  })

  it('schweigt im Normalbetrieb', () => {
    expect(shouldNotify({ healthy: true }, { healthy: true })).toBe(false)
  })

  it('meldet beim allerersten Lauf nur, wenn etwas kaputt ist', () => {
    expect(shouldNotify({ healthy: false }, null)).toBe(true)
    expect(shouldNotify({ healthy: true }, null)).toBe(false)
  })
})

describe('checkPages — Cache-Buster', () => {
  it('haengt an jede URL einen eindeutigen Parameter', async () => {
    // Ohne ihn beantwortet der Edge-Cache die Frage. Genau deshalb sahen die
    // Startseiten am 2026-08-25 gesund aus, waehrend die Funktion tot war.
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 })
    const { checkPages } = await import('@/lib/health/check')
    await checkPages(['https://x.test/de'], { fetchImpl: fetchMock as never, now: 1234 })
    const called = String(fetchMock.mock.calls[0][0])
    expect(called).toContain('https://x.test/de')
    expect(called).toMatch(/[?&]hc=/)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('wertet einen Netzwerkfehler als Ausfall statt zu werfen', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const { checkPages } = await import('@/lib/health/check')
    const res = await checkPages(['https://x.test/de'], { fetchImpl: fetchMock as never })
    expect(res[0].status).toBe(0)
    expect(res[0].error).toContain('ECONNREFUSED')
  })
})
