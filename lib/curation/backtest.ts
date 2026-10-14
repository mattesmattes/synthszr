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
import type { BriefMode, ClusterResult, Degradation, PoolSnapshot, RunMetrics, RunStatus } from '@/lib/curation/types'

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
  /**
   * Kennung des Backtest-Arms auf curation_runs.label (Final-Review
   * 2026-10-14 (R25), I4) — trennt Ablationsstufen und Iterationen in Skip,
   * Korrektur-Paaren und Report. Default bt-<brief>-<YYYYMMDD des Starts, UTC>.
   */
  label: string
}

/**
 * Gate-Fenster der Spec („Offline": 36 Gate-Tage 2026-08-25..09-29, wie
 * GATE_START/GATE_END in measure-curation-baseline.ts) plus die letzten 30
 * Tage vor heute — dieselbe Doppel-Referenz wie die Baseline-Messung.
 */
export const BACKTEST_DEFAULTS: Omit<BacktestArgs, 'label'> = {
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
/** Ein Label ohne Leerzeichen und Sonderzeichen — es steht in Logs, Report und PostgREST-Filtern. */
const LABEL_RE = /^[A-Za-z0-9._-]+$/

/** Default-Label eines Backtest-Arms: bt-<brief>-<YYYYMMDD> mit dem UTC-Datum des Starts (R25). */
export function defaultBacktestLabel(brief: BriefMode, now: Date): string {
  return `bt-${brief}-${now.toISOString().slice(0, 10).replace(/-/g, '')}`
}

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
 * HH:MM`, `--out pfad`, `--force`, `--label name` — `=`- und
 * Leerzeichen-Form, invalider Wert → null. `--since` wird bewusst NICHT
 * gelesen (anders als measure-curation-baseline.ts): ein Backtest hat ein
 * Gate-Fenster UND ein Tagesfenster (`--from`/`--to`/`--last`), kein
 * einzelnes „ab hier" — ein `--since` auf der Kommandozeile hat deshalb
 * keinerlei Wirkung, statt eines der beiden Fenster stillschweigend zu
 * verschieben. `now` bestimmt nur das Datum im Default-Label.
 */
export function parseBacktestArgs(argv: string[], now: Date = new Date()): BacktestArgs | null {
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

  const labelRaw = readFlag(argv, '--label')
  if (labelRaw === null) return null
  const label = labelRaw ?? defaultBacktestLabel(brief as BriefMode, now)
  if (!LABEL_RE.test(label)) return null

  const sequential = hasFlag(argv, '--sequential')
  // Final-Review 2026-10-14 (R28, Minor 16): der volle Brief liest die
  // Korrektur-Paare frueherer Tage DESSELBEN Arms (loadCorrectionPairs) —
  // parallel laufende Tage saehen je nach Zufall der Reihenfolge mal mehr,
  // mal weniger davon. Ohne --sequential ist die dritte Ablationsstufe
  // deshalb nicht reproduzierbar.
  if (brief === 'full' && !sequential) return null

  return {
    from, to, last, brief: brief as BriefMode, limit, maxUsd, kickoffUtc, out, label,
    sequential,
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
export function backtestDays(args: Pick<BacktestArgs, 'from' | 'to' | 'last' | 'limit'>, today: string): string[] {
  const days = new Set<string>()
  for (let d = args.from; d <= args.to; d = isoDayShift(d, 1)) days.add(d)
  const recentStart = isoDayShift(today, -args.last)
  const recentEnd = isoDayShift(today, -1)
  for (let d = recentStart; d <= recentEnd; d = isoDayShift(d, 1)) days.add(d)
  const sorted = [...days].sort()
  return args.limit === null ? sorted : sorted.slice(0, args.limit)
}

/**
 * Eintrag eines Tages im Backtest-Report — dieselbe Zeile fuer Voll-, Skip-,
 * Dry-Run- und Fehler-Tage. `run_id` ist null, wenn kein Run angelegt werden
 * konnte (createRun selbst scheiterte, Review 2026-10-14 R20) — der einzige
 * Fall ohne eine echte curation_runs-Zeile.
 */
export interface BacktestDayReport {
  day: string
  run_id: string | null
  status: RunStatus
  spend_usd: number
  degraded: Degradation[]
  attribution: RunMetrics['attribution'] | null
  metrics: RunMetrics | null
  /** `run.error_message` — gesetzt, sobald das Script den Tag per finishRun(..., 'error', message) abgeschlossen hat (Fix-Runde 1, Review Important #1). */
  error: string | null
}

/** Formt eine curation_runs-Zeile in eine Report-Zeile — attribution kommt aus den Metriken, nicht der Spalte, error aus error_message. */
export function backtestDayReportOf(run: {
  day: string
  id: string
  status: RunStatus
  spend_usd: number
  degraded: Degradation[]
  metrics: RunMetrics | null
  error_message: string | null
}): BacktestDayReport {
  return {
    day: run.day,
    run_id: run.id,
    status: run.status,
    spend_usd: run.spend_usd,
    degraded: run.degraded,
    attribution: run.metrics?.attribution ?? null,
    metrics: run.metrics,
    error: run.error_message,
  }
}

/**
 * Lokale Fehler-Zeile OHNE DB-Zugriff (Review 2026-10-14, R20): fuer den
 * Fall, dass der Recovery-Pfad eines Tages selbst scheitert (finishRun oder
 * mustGetRun werfen) — dann ist ein erneutes DB-Lesen weder moeglich noch
 * sicher, der Report-Eintrag entsteht aus dem, was das Script ohnehin schon
 * weiss. `runId` ist null, wenn schon `createRun` scheiterte (kein Run
 * angelegt, also auch kein `finishRun`-Ziel); sonst die id des Runs, dessen
 * Abschluss NACH einem Fehler selbst fehlschlug.
 */
export function errorDayReportOf(day: string, runId: string | null, message: string): BacktestDayReport {
  return { day, run_id: runId, status: 'error', spend_usd: 0, degraded: [], attribution: null, metrics: null, error: message }
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
 * Tag → id des juengsten `done`-Runs DESSELBEN Arms, fuer das Ueberspringen
 * bereits erledigter Backtest-Tage (ein `done`-Run blockiert createRun NICHT
 * — der Unique-Index von curation_runs schuetzt nur offene Status, Anhang A
 * §1). Nur gleicher brief_mode UND gleiches label zaehlen (Final-Review
 * 2026-10-14 (R25), I4): sonst uebersprang `--brief none` nach einem
 * precedents-only-Lauf alle Tage und trug deren Metriken unter falschem Etikett.
 */
export function doneRunIdByDay(
  runs: Array<{ day: string; id: string; status: RunStatus; brief_mode: BriefMode; label: string | null }>,
  arm: { brief_mode: BriefMode; label: string },
): Map<string, string> {
  const map = new Map<string, string>()
  for (const run of runs) {
    if (run.status !== 'done') continue
    if (run.brief_mode !== arm.brief_mode || run.label !== arm.label) continue
    map.set(run.day, run.id)
  }
  return map
}

/** Gate-Aggregat eines Arms fuer `reconcile-curation --report`. */
export interface ArmAggregate {
  brief_mode: BriefMode
  label: string | null
  aggregate: AggregateReport
}

/**
 * Ein Aggregat je (brief_mode, label) in der Reihenfolge des ersten Auftretens
 * (Final-Review 2026-10-14 (R25)): ein Aggregat ueber alle Arme mischte die
 * Ablationsstufen und waere als Gate-Stand wertlos. metrics null (Abgleich
 * aufgegeben, R22) ignoriert aggregateRuns selbst.
 */
export function aggregateByArm(
  rows: Array<{ brief_mode: BriefMode; label: string | null; metrics: RunMetrics | null }>,
  handPrecisionRef: number | null,
): ArmAggregate[] {
  const groups = new Map<string, { brief_mode: BriefMode; label: string | null; metrics: Array<RunMetrics | null> }>()
  for (const row of rows) {
    const key = JSON.stringify([row.brief_mode, row.label])
    const group = groups.get(key) ?? { brief_mode: row.brief_mode, label: row.label, metrics: [] }
    group.metrics.push(row.metrics)
    groups.set(key, group)
  }
  return [...groups.values()].map((g) => ({
    brief_mode: g.brief_mode,
    label: g.label,
    aggregate: aggregateRuns(g.metrics, handPrecisionRef),
  }))
}

/** Pfad des Baseline-Reports (measure-curation-baseline.ts) — von backtest-curation.ts und reconcile-curation.ts geteilt (Fix-Runde 1, Review Minor #3). */
export const BASELINE_FILE = 'scripts/curation-baseline.json'

/**
 * `baselines.hand.precision_full` aus dem Baseline-Report, falls die Datei
 * existiert und valides JSON mit dem Feld enthaelt — sonst null (kein
 * Gate-Vergleich). `exists`/`read` sind injiziert (Muster `EmbedTexts`,
 * `CallToolFn`): die Funktion bleibt ohne echtes Dateisystem testbar, die
 * Scripts rufen sie mit `existsSync`/`readFileSync` auf.
 */
export function handPrecisionRefOf(
  path: string,
  exists: (p: string) => boolean,
  read: (p: string) => string,
): number | null {
  if (!exists(path)) return null
  try {
    const raw = JSON.parse(read(path)) as { baselines?: { hand?: { precision_full?: unknown } } }
    const value = raw.baselines?.hand?.precision_full
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

/**
 * Pool-/Cluster-Vorschauzeile des `--dry-run`-Pfads (Ruling R12) — identisch
 * in `backtest-curation.ts` und `shadow-once-curation.ts`, deshalb hier
 * einmal geteilt (Fix-Runde 1, Review Minor #4). Reine Formatierung, kein
 * `console.log` hier — das bleibt Sache der Scripts.
 */
export function dryRunPoolLine(day: string, pool: PoolSnapshot, cluster: ClusterResult): string {
  const ex = pool.excluded
  const stories = Object.keys(cluster.clusters).length
  return `[Curation] ${day}: Pool ${pool.items.length} Items `
    + `(excluded used_earlier ${ex.used_earlier}, expired ${ex.expired}, skipped ${ex.skipped}, junk ${ex.junk}, short ${ex.short}) `
    + `· ${stories} Stories · ${pool.handIds.length} Hand`
}
