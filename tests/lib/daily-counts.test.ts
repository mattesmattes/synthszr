/**
 * Tageszaehlungen fuer die Statistik — serverseitig aggregiert statt Rohzeilen.
 *
 * PROD-BEFUND 2026-08-23: Die Statistik-Seite hing in der 3-Monats-Ansicht. Sie
 * holte JEDE Rohzeile, fuer den Zeitraum UND die Vergleichsperiode: ~100.000
 * Zeilen, ~15 MB, ~100 sequenzielle PostgREST-Requests (fetchAllRows
 * paginiert), danach Zaehlen in JavaScript — um daraus 90 Balken zu machen.
 *
 * Zaehlen ist Datenbankarbeit. Mit `count()` liefert dieselbe Auskunft ~90
 * Zeilen statt 100.000.
 *
 * WEG: eine Datenbankfunktion (RPC). Supabase verbietet Aggregate in
 * PostgREST-Abfragen (PGRST123) und der Schalter dafuer ist im Dashboard nicht
 * erreichbar — innerhalb einer Funktion greift das Verbot nicht.
 *
 * Solange die Funktion nicht eingespielt ist (PGRST202 "not found"), MUSS der
 * alte Weg greifen — sonst waere die Seite zwischen Deploy und SQL-Lauf
 * komplett tot statt nur langsam.
 */
import { describe, expect, it, vi } from 'vitest'
import { fetchDailyCounts } from '@/lib/analytics/daily-counts'

/** Fake-Supabase: RPC vorhanden oder nicht, plus Rohzeilen-Rueckfallebene. */
function fakeDb(opts: { aggregatesAllowed: boolean; rows?: unknown[]; agg?: unknown[] }) {
  const calls = { aggregate: 0, fallback: 0 }
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      select: vi.fn(() => c),
      gte: vi.fn(() => c), lt: vi.fn(() => c), eq: vi.fn(() => c),
      match: vi.fn(() => c), not: vi.fn(() => c), order: vi.fn(() => c),
      range: vi.fn(() => {
        calls.fallback++
        return Promise.resolve({ data: opts.rows ?? [], error: null })
      }),
      then: (res: (v: unknown) => void) => {
        calls.fallback++
        return res({ data: opts.rows ?? [], error: null })
      },
    }
    return c
  }
  return {
    db: {
      from: vi.fn(() => chain()),
      rpc: vi.fn(() => {
        calls.aggregate++
        return Promise.resolve(opts.aggregatesAllowed
          ? { data: opts.agg ?? [], error: null }
          // PGRST202: Funktion noch nicht eingespielt
          : { data: null, error: { code: 'PGRST202', message: 'function not found' } })
      }),
    },
    calls,
  }
}

const spec = { table: 'analytics_events', dateColumn: 'created_at', from: '2026-08-01T00:00:00Z', to: '2026-08-03T00:00:00Z' }

describe('fetchDailyCounts', () => {
  it('nutzt die Datenbankfunktion, wenn sie da ist — und laedt keine Rohzeilen', async () => {
    const { db, calls } = fakeDb({
      aggregatesAllowed: true,
      agg: [{ bucket: '2026-08-01', n: 42 }, { bucket: '2026-08-02', n: 7 }],
    })
    const map = await fetchDailyCounts(db as never, spec)
    expect(map.get('2026-08-01')).toBe(42)
    expect(map.get('2026-08-02')).toBe(7)
    expect(calls.aggregate).toBe(1)
    expect(calls.fallback).toBe(0) // der springende Punkt: keine 100.000 Zeilen
  })

  it('faellt auf Rohzeilen zurueck, solange die Funktion fehlt', async () => {
    const { db, calls } = fakeDb({
      aggregatesAllowed: false,
      rows: [
        { created_at: '2026-08-01T10:00:00Z' },
        { created_at: '2026-08-01T11:00:00Z' },
        { created_at: '2026-08-02T09:00:00Z' },
      ],
    })
    const map = await fetchDailyCounts(db as never, spec)
    expect(calls.aggregate).toBe(1)   // erst versucht
    expect(calls.fallback).toBeGreaterThan(0) // dann der alte Weg
    expect(map.get('2026-08-01')).toBe(2)
    expect(map.get('2026-08-02')).toBe(1)
  })

  it('zaehlt im Fallback nach BERLINER Tagesgrenze, nicht nach UTC', async () => {
    // 22:30 UTC ist in Berlin bereits der Folgetag — sonst landen Abendaufrufe
    // im falschen Balken.
    const { db } = fakeDb({ aggregatesAllowed: false, rows: [{ created_at: '2026-08-01T22:30:00Z' }] })
    const map = await fetchDailyCounts(db as never, spec)
    expect(map.get('2026-08-02')).toBe(1)
  })

  it('liefert eine leere Zuordnung statt zu werfen, wenn beides scheitert', async () => {
    const { db } = fakeDb({ aggregatesAllowed: false, rows: [] })
    expect((await fetchDailyCounts(db as never, spec)).size).toBe(0)
  })
})
