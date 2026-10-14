/**
 * Reine Teile des Backtest-Scripts (Task 14, lib/curation/backtest.ts):
 * Argument-Parser, Tagesliste, Report-Aggregation. Keine Mocks — alle
 * Funktionen sind rein.
 */
import { describe, expect, it } from 'vitest'
import {
  BACKTEST_DEFAULTS, backtestDayReportOf, backtestDays, buildBacktestReport, doneRunIdByDay, parseBacktestArgs,
} from '@/lib/curation/backtest'
import type { RunMetrics } from '@/lib/curation/types'

describe('parseBacktestArgs', () => {
  it('liefert Defaults ohne Argumente', () => {
    expect(parseBacktestArgs([])).toEqual(BACKTEST_DEFAULTS)
  })

  it('ungueltiger --brief-Wert → null', () => {
    expect(parseBacktestArgs(['--brief', 'quatsch'])).toBeNull()
  })

  it('--since hat keine Wirkung (anders als measure-curation-baseline.ts)', () => {
    expect(parseBacktestArgs(['--since', '2026-09-01'])).toEqual(BACKTEST_DEFAULTS)
  })

  it('liest --from/--to/--last/--brief/--limit/--max-usd/--kickoff/--out in der Leerzeichen-Form', () => {
    const args = parseBacktestArgs([
      '--from', '2026-01-01', '--to', '2026-01-31', '--last', '5', '--brief', 'full',
      '--limit', '2', '--max-usd', '12.5', '--kickoff', '05:00', '--out', 'scripts/x.json',
    ])
    expect(args).toEqual({
      from: '2026-01-01', to: '2026-01-31', last: 5, brief: 'full', sequential: false, dryRun: false,
      limit: 2, maxUsd: 12.5, kickoffUtc: '05:00', out: 'scripts/x.json', force: false,
    })
  })

  it('liest dieselben Flags in der =-Form', () => {
    const args = parseBacktestArgs(['--from=2026-01-01', '--brief=none', '--max-usd=5'])
    expect(args?.from).toBe('2026-01-01')
    expect(args?.brief).toBe('none')
    expect(args?.maxUsd).toBe(5)
  })

  it('setzt --sequential, --dry-run und --force unabhaengig voneinander', () => {
    const args = parseBacktestArgs(['--sequential', '--dry-run', '--force'])
    expect(args?.sequential).toBe(true)
    expect(args?.dryRun).toBe(true)
    expect(args?.force).toBe(true)
  })

  it('ungueltiges Datum → null', () => {
    expect(parseBacktestArgs(['--from', '01-01-2026'])).toBeNull()
    expect(parseBacktestArgs(['--to', 'quatsch'])).toBeNull()
  })

  it('nicht-numerisches --last/--limit/--max-usd → null', () => {
    expect(parseBacktestArgs(['--last', 'abc'])).toBeNull()
    expect(parseBacktestArgs(['--limit', 'abc'])).toBeNull()
    expect(parseBacktestArgs(['--max-usd', 'abc'])).toBeNull()
  })

  it('negatives --last/--limit und --max-usd <= 0 → null', () => {
    expect(parseBacktestArgs(['--last', '-1'])).toBeNull()
    expect(parseBacktestArgs(['--limit', '-1'])).toBeNull()
    expect(parseBacktestArgs(['--max-usd', '0'])).toBeNull()
  })

  it('ungueltiges --kickoff-Format → null', () => {
    expect(parseBacktestArgs(['--kickoff', '4:25'])).toBeNull()
    expect(parseBacktestArgs(['--kickoff', '24:00'])).toBeNull()
  })

  it('Flag ohne Wert am Ende der argv → null', () => {
    expect(parseBacktestArgs(['--brief'])).toBeNull()
    expect(parseBacktestArgs(['--last'])).toBeNull()
  })
})

describe('backtestDays', () => {
  it('kappt vom Anfang bei limit', () => {
    expect(backtestDays({ ...BACKTEST_DEFAULTS, limit: 3 }, '2026-10-14')).toEqual([
      '2026-08-25', '2026-08-26', '2026-08-27',
    ])
  })

  it('ohne limit: enthaelt Gate-Ende und juengsten Tag, nicht heute, keine Dubletten', () => {
    const days = backtestDays(BACKTEST_DEFAULTS, '2026-10-14')
    expect(days).toContain('2026-09-29')
    expect(days).toContain('2026-10-13')
    expect(days).not.toContain('2026-10-14')
    expect(new Set(days).size).toBe(days.length)
    expect(days).toEqual([...days].sort())
  })

  it('last=0: das juengere Fenster ist leer, nur das Gate-Fenster bleibt', () => {
    const days = backtestDays({ ...BACKTEST_DEFAULTS, last: 0 }, '2026-10-14')
    expect(days[0]).toBe('2026-08-25')
    expect(days[days.length - 1]).toBe('2026-09-29')
  })
})

function metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    attribution: 'job', published_units: 9, published_attributable: 9,
    plan: { recommended: 10, bench: 10, held: 0 },
    unit_recall_20: 0.7, unit_recall_id_20: 0.6, setzlisten_recall_10: 0.6, setzlisten_precision_10: 0.8,
    duplicate_rate_recommended: 0, cut_rate: 0.1, additions: 0, additions_rate: 0, hand_stories: 2, held_rate: 0,
    baseline_total_score_unit_recall_20: 0.5, baseline_total_score_recall_10: 0.4, diff_vs_total_score_20: 0.2,
    outcomes: { kept: 8, relabeled: 0, merged: 0, dropped_after_selection: 1, dropped_never_selected: 0, added: 0 },
    ...over,
  }
}

describe('backtestDayReportOf', () => {
  it('liest attribution aus metrics, nicht aus der Spalte', () => {
    const entry = backtestDayReportOf({
      day: '2026-09-01', id: 'r1', status: 'done', spend_usd: 1.5, degraded: ['scout_partial'], metrics: metrics(),
    })
    expect(entry).toEqual({
      day: '2026-09-01', run_id: 'r1', status: 'done', spend_usd: 1.5, degraded: ['scout_partial'],
      attribution: 'job', metrics: metrics(),
    })
  })

  it('attribution ist null ohne Metriken (z. B. cancelled/error)', () => {
    const entry = backtestDayReportOf({ day: '2026-09-02', id: 'r2', status: 'cancelled', spend_usd: 0, degraded: [], metrics: null })
    expect(entry.attribution).toBeNull()
  })
})

describe('buildBacktestReport', () => {
  it('aggregiert nur Tage mit Metriken', () => {
    const days = [
      backtestDayReportOf({ day: '2026-09-01', id: 'r1', status: 'done', spend_usd: 1.5, degraded: [], metrics: metrics() }),
      backtestDayReportOf({ day: '2026-09-02', id: 'r2', status: 'cancelled', spend_usd: 0, degraded: [], metrics: null }),
    ]
    const report = buildBacktestReport(BACKTEST_DEFAULTS, days, null, '2026-10-14T00:00:00.000Z')
    expect(report.generated_at).toBe('2026-10-14T00:00:00.000Z')
    expect(report.args).toEqual(BACKTEST_DEFAULTS)
    expect(report.days).toEqual(days)
    expect(report.aggregate.n).toBe(1)
  })
})

describe('doneRunIdByDay', () => {
  it('nimmt nur done-Runs, letzter Eintrag je Tag gewinnt', () => {
    const map = doneRunIdByDay([
      { day: '2026-09-01', id: 'r1', status: 'done' },
      { day: '2026-09-02', id: 'r2', status: 'error' },
      { day: '2026-09-01', id: 'r3', status: 'done' },
    ])
    expect(map.get('2026-09-01')).toBe('r3')
    expect(map.has('2026-09-02')).toBe(false)
  })
})
