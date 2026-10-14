/**
 * Reine Teile des Backtest-Scripts (Task 14, Anhang A §0 „Scripts bleiben
 * duenne Schleifen"): Argument-Parser, Tagesliste und Report-Aggregation.
 * `scripts/backtest-curation.ts` ruft diese Funktionen nur auf — jede
 * Entscheidung, welche Tage laufen und wie der Report aussieht, steht hier
 * und ist getestet (tests/lib/curation-backtest.test.ts).
 *
 * Kein Supabase, keine Modell- oder Embedding-Aufrufe — aggregateRuns
 * (lib/curation/reconcile.ts) ist selbst rein (Task 11 Docstring).
 */
import { isoDayShift } from '@/lib/curation/precedents'
import { aggregateRuns, type AggregateReport } from '@/lib/curation/reconcile'
import type { BriefMode, Degradation, RunMetrics, RunStatus } from '@/lib/curation/types'

export interface BacktestArgs {
  from: string
  to: string
  last: number
  brief: BriefMode
  sequential: boolean
  dryRun: boolean
  limit: number | null
  maxUsd: number
  kickoffUtc: string
  out: string
  force: boolean
}

/**
 * Gate-Fenster der Spec („Offline": 36 Gate-Tage 2026-08-25..09-29, wie
 * GATE_START/GATE_END in measure-curation-baseline.ts) plus die letzten 30
 * Tage vor heute — dieselbe Doppel-Referenz wie die Baseline-Messung.
 */
export const BACKTEST_DEFAULTS: BacktestArgs = {
  from: '2026-08-25',
  to: '2026-09-29',
  last: 30,
  brief: 'precedents-only',
  sequential: false,
  dryRun: false,
  limit: null,
  maxUsd: 90,
  kickoffUtc: '04:25',
  out: 'scripts/curation-backtest.json',
  force: false,
}

/** 'HH:MM', 00–23 : 00–59 — derselbe Rumpf wie KICKOFF_RE in lib/curation/service.ts. */
const KICKOFF_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const BRIEF_MODES: ReadonlySet<string> = new Set(['none', 'precedents-only', 'full'])

/**
 * Wert eines `--flag wert` oder `--flag=wert` — undefined, wenn das Flag
 * fehlt, null, wenn es da ist, aber ohne brauchbaren Wert (nichts danach,
 * oder das naechste Token ist selbst ein Flag). Muster parseSinceArg
 * (lib/curation/precedents.ts:553), auf beliebige Flag-Namen verallgemeinert.
 */
function readFlag(argv: string[], name: string): string | null | undefined {
  const idx = argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (idx < 0) return undefined
  if (argv[idx].includes('=')) return argv[idx].slice(name.length + 1)
  const next = argv[idx + 1]
  if (next === undefined || next.startsWith('--')) return null
  return next
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name)
}

/**
 * `--from`, `--to`, `--last N`, `--brief none|precedents-only|full`,
 * `--sequential`, `--dry-run`, `--limit N`, `--max-usd X`, `--kickoff
 * HH:MM`, `--out pfad`, `--force` — `=`- und Leerzeichen-Form, invalider
 * Wert → null. `--since` wird bewusst NICHT gelesen (anders als
 * measure-curation-baseline.ts): ein Backtest hat ein Gate-Fenster UND ein
 * Tagesfenster (`--from`/`--to`/`--last`), kein einzelnes „ab hier" — ein
 * `--since` auf der Kommandozeile hat deshalb keinerlei Wirkung, statt
 * eines der beiden Fenster stillschweigend zu verschieben.
 */
export function parseBacktestArgs(argv: string[]): BacktestArgs | null {
  const fromRaw = readFlag(argv, '--from')
  if (fromRaw === null) return null
  const from = fromRaw ?? BACKTEST_DEFAULTS.from
  if (!DATE_RE.test(from) || Number.isNaN(Date.parse(from))) return null

  const toRaw = readFlag(argv, '--to')
  if (toRaw === null) return null
  const to = toRaw ?? BACKTEST_DEFAULTS.to
  if (!DATE_RE.test(to) || Number.isNaN(Date.parse(to))) return null

  const lastRaw = readFlag(argv, '--last')
  if (lastRaw === null) return null
  const last = lastRaw === undefined ? BACKTEST_DEFAULTS.last : Number(lastRaw)
  if (!Number.isInteger(last) || last < 0) return null

  const briefRaw = readFlag(argv, '--brief')
  if (briefRaw === null) return null
  const brief = briefRaw ?? BACKTEST_DEFAULTS.brief
  if (!BRIEF_MODES.has(brief)) return null

  const limitRaw = readFlag(argv, '--limit')
  if (limitRaw === null) return null
  let limit: number | null = BACKTEST_DEFAULTS.limit
  if (limitRaw !== undefined) {
    limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 0) return null
  }

  const maxUsdRaw = readFlag(argv, '--max-usd')
  if (maxUsdRaw === null) return null
  const maxUsd = maxUsdRaw === undefined ? BACKTEST_DEFAULTS.maxUsd : Number(maxUsdRaw)
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return null

  const kickoffRaw = readFlag(argv, '--kickoff')
  if (kickoffRaw === null) return null
  const kickoffUtc = kickoffRaw ?? BACKTEST_DEFAULTS.kickoffUtc
  if (!KICKOFF_RE.test(kickoffUtc)) return null

  const outRaw = readFlag(argv, '--out')
  if (outRaw === null) return null
  const out = outRaw ?? BACKTEST_DEFAULTS.out
  if (out.length === 0) return null

  return {
    from, to, last, brief: brief as BriefMode, limit, maxUsd, kickoffUtc, out,
    sequential: hasFlag(argv, '--sequential'),
    dryRun: hasFlag(argv, '--dry-run'),
    force: hasFlag(argv, '--force'),
  }
}

/**
 * Tage des Backtests: Gate-Fenster [from, to] ∪ [heute − last, heute − 1],
 * aufsteigend sortiert, dedupliziert (Ueberlappung der beiden Fenster ist
 * der Normalfall — das Gate-Ende 2026-09-29 liegt innerhalb der letzten
 * `last` Tage, sobald heute nach 2026-10-29 liegt). `limit` kappt vom
 * Anfang: die Gate-Tage zuerst, dann die juengsten Tage — ein knappes
 * Kosten-Limit soll zuerst die Gate-Referenz pruefen, nicht zufaellig in
 * den juengsten Tagen landen.
 */
export function backtestDays(args: BacktestArgs, today: string): string[] {
  const days = new Set<string>()
  for (let d = args.from; d <= args.to; d = isoDayShift(d, 1)) days.add(d)
  const recentStart = isoDayShift(today, -args.last)
  const recentEnd = isoDayShift(today, -1)
  for (let d = recentStart; d <= recentEnd; d = isoDayShift(d, 1)) days.add(d)
  const sorted = [...days].sort()
  return args.limit === null ? sorted : sorted.slice(0, args.limit)
}

/** Eintrag eines Tages im Backtest-Report — dieselbe Zeile fuer Voll-, Skip- und Dry-Run-Tage. */
export interface BacktestDayReport {
  day: string
  run_id: string
  status: RunStatus
  spend_usd: number
  degraded: Degradation[]
  attribution: RunMetrics['attribution'] | null
  metrics: RunMetrics | null
}

/** Formt eine curation_runs-Zeile in eine Report-Zeile — attribution kommt aus den Metriken, nicht der Spalte. */
export function backtestDayReportOf(run: {
  day: string
  id: string
  status: RunStatus
  spend_usd: number
  degraded: Degradation[]
  metrics: RunMetrics | null
}): BacktestDayReport {
  return {
    day: run.day,
    run_id: run.id,
    status: run.status,
    spend_usd: run.spend_usd,
    degraded: run.degraded,
    attribution: run.metrics?.attribution ?? null,
    metrics: run.metrics,
  }
}

export interface BacktestReport {
  generated_at: string
  args: BacktestArgs
  days: BacktestDayReport[]
  aggregate: AggregateReport
}

/** Report-JSON des Backtests — aggregate laeuft nur ueber Tage mit Metriken (reconcileRun ist jeweils schon gelaufen). */
export function buildBacktestReport(
  args: BacktestArgs,
  days: BacktestDayReport[],
  handPrecisionRef: number | null,
  generatedAt: string = new Date().toISOString(),
): BacktestReport {
  const metricsList = days.map((d) => d.metrics).filter((m): m is RunMetrics => m !== null)
  return { generated_at: generatedAt, args, days, aggregate: aggregateRuns(metricsList, handPrecisionRef) }
}

/**
 * Tag → id des juengsten `done`-Runs, fuer den Ueberspringen bereits
 * erledigter Backtest-Tage (ein `done`-Run blockiert createRun NICHT — der
 * Unique-Index von curation_runs schuetzt nur offene Status, Anhang A §1).
 */
export function doneRunIdByDay(runs: Array<{ day: string; id: string; status: RunStatus }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const run of runs) if (run.status === 'done') map.set(run.day, run.id)
  return map
}
