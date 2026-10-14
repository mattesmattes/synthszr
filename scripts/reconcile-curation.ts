#!/usr/bin/env npx tsx
/**
 * Nach-Rekonziliation der Morgenkonferenz, Phase 1 „Shadow" (Task 14):
 * holt alle Laeufe mit status='done' und reconciled_at IS NULL nach — der
 * Normalfall ist der Shadow-Cron selbst (getRunsToReconcile, service.ts,
 * zehn Minuten nach `asof`), dieses Script ist der Nachschlag fuer alles,
 * was dabei liegen geblieben ist (ein ausgefallener Tick, ein Lauf, dessen
 * Post erst Tage spaeter veroeffentlicht wurde) oder fuer Backtest-Laeufe,
 * die aus irgendeinem Grund ohne sofortige Rekonziliation endeten.
 *
 * `--mode shadow|backtest` (Default: beide), `--since YYYY-MM-DD` filtert
 * auf `asof` (Berlin-unabhaengig, UTC-Mitternacht — Muster parseSinceArg,
 * lib/curation/precedents.ts).
 *
 * `--dry-run`: zeigt je offenem Lauf nur das Ergebnis von pickMatchingPost
 * (loadMatchCandidates + pickMatchingPost, beides rein bzw. lesend) — KEIN
 * reconcileRun, also keine Schreibzugriffe.
 * `--report`: zusaetzlich aggregateRuns ueber ALLE bereits rekonziliierten
 * Laeufe (reconciled_at IS NOT NULL) je angefragtem Modus — der aktuelle
 * Gate-Stand, nicht nur die in diesem Lauf frisch abgeglichenen Tage.
 *
 * Lauf: pnpm curation:reconcile -- --dry-run
 *       pnpm curation:reconcile -- --mode shadow
 *       pnpm curation:reconcile -- --report
 */
import { config } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import type { RunMetrics, RunMode, RunRow } from '@/lib/curation/types'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const MODES: readonly RunMode[] = ['shadow', 'backtest']
/** Seitengroesse fuer .range() (Vertrag 0: Scheiben à 1000/200 — hier die schmale 1000er-Seite, keine Payload-Spalten). */
const PAGE = 1000
const BASELINE_FILE = 'scripts/curation-baseline.json'

interface ReconcileArgs { mode: RunMode | undefined; since: string | undefined; dryRun: boolean; report: boolean }

/** `--mode shadow|backtest`, `--since YYYY-MM-DD`, `--dry-run`, `--report` — `=`- und Leerzeichen-Form, invalider Wert → null. */
function parseReconcileArgs(argv: string[]): ReconcileArgs | null {
  const modeIdx = argv.findIndex((a) => a === '--mode' || a.startsWith('--mode='))
  let mode: RunMode | undefined
  if (modeIdx >= 0) {
    const raw = argv[modeIdx].includes('=') ? argv[modeIdx].slice('--mode='.length) : argv[modeIdx + 1]
    if (!raw || !(MODES as readonly string[]).includes(raw)) return null
    mode = raw as RunMode
  }

  const sinceIdx = argv.findIndex((a) => a === '--since' || a.startsWith('--since='))
  let since: string | undefined
  if (sinceIdx >= 0) {
    const raw = argv[sinceIdx].includes('=') ? argv[sinceIdx].slice('--since='.length) : argv[sinceIdx + 1]
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return null
    since = raw
  }

  return { mode, since, dryRun: argv.includes('--dry-run'), report: argv.includes('--report') }
}

async function main(): Promise<number> {
  const args = parseReconcileArgs(process.argv.slice(2))
  if (!args) {
    console.warn('[Curation] WARNUNG: Argumente ungueltig (--mode shadow|backtest, --since YYYY-MM-DD erwartet) — Abbruch.')
    return 1
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { flushUsageLog } = await import('@/lib/ai/usage-log')
  const { generateEmbeddings } = await import('@/lib/embeddings/generator')
  const { aggregateRuns, loadMatchCandidates, pickMatchingPost, reconcileRun } = await import('@/lib/curation/reconcile')
  const supabase = createAdminClient()
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })
  const modes = args.mode ? [args.mode] : [...MODES]

  console.log(
    `[Curation] reconcile-curation: Modus ${args.mode ?? 'beide'}${args.since ? `, seit ${args.since}` : ''}`
    + `${args.dryRun ? ', DRY-RUN' : ''}${args.report ? ', mit Gate-Report' : ''}`,
  )

  // WARUM .select('*') statt RUN_SUMMARY_COLUMNS (listRuns): reconcileRun
  // braucht run.pool (Archiv-Snapshot) und run.story_keys, die die schlanke
  // Listenansicht nicht mitliefert.
  const open = await loadOpenRuns(supabase, modes, args.since)
  console.log(`[Curation] ${open.length} offene Laeufe (done, reconciled_at null).`)

  for (const run of open) {
    if (args.dryRun) {
      const candidates = await loadMatchCandidates(supabase, run.asof)
      const matched = pickMatchingPost(run.asof, candidates)
      console.log(
        `[Curation] ${run.day} (${run.mode}, Run ${run.id}): `
        + (matched ? `Post ${matched.post_id} (${matched.attribution})` : 'kein passender Post'),
      )
      continue
    }
    try {
      const { matched, metrics } = await reconcileRun(supabase, run, embed)
      console.log(
        `[Curation] ${run.day} (${run.mode}, Run ${run.id}): `
        + `${matched ? `Post ${matched.post_id} (${matched.attribution})` : 'kein Post — attribution none'} `
        + `· UnitRecall@20 ${metrics.unit_recall_20.toFixed(2)}`,
      )
    } catch (err) {
      // WARUM weiterlaufen statt abzubrechen: ein kaputter Einzelfall (z. B.
      // Post ohne Content) soll den Nachschlag der uebrigen Laeufe nicht
      // verhindern — derselbe Fehler bleibt beim naechsten Aufruf sichtbar.
      console.error(`[Curation] ${run.day} (${run.mode}, Run ${run.id}): Rekonziliation fehlgeschlagen —`, err)
    }
  }

  if (args.report) {
    const handPrecisionRef = handPrecisionRefOf()
    for (const mode of modes) {
      const metricsList = await loadReconciledMetrics(supabase, mode, args.since)
      const aggregate = aggregateRuns(metricsList, handPrecisionRef)
      console.log(`[Curation] Gate-Aggregat ${mode} (n=${aggregate.n}):`)
      console.table(aggregate.mean)
      console.log(`[Curation] Gate ${mode}:`, aggregate.gate)
    }
  }

  await flushUsageLog()
  return 0
}

/** Alle Laeufe status='done', reconciled_at IS NULL, optional nach mode/since (auf asof) gefiltert — seitenweise à PAGE. */
async function loadOpenRuns(supabase: SupabaseAdmin, modes: RunMode[], since: string | undefined): Promise<RunRow[]> {
  const { parseRunRow } = await import('@/lib/curation/service')
  const runs: RunRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    let query = supabase.from('curation_runs').select('*').eq('status', 'done').is('reconciled_at', null).in('mode', modes)
    if (since) query = query.gte('asof', `${since}T00:00:00.000Z`)
    const { data, error } = await query.order('asof', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`curation_runs: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data as Record<string, unknown>[]) runs.push(parseRunRow(row))
    if (data.length < PAGE) break
  }
  return runs
}

/** metrics aller bereits rekonziliierten Laeufe eines Modus (reconciled_at IS NOT NULL), optional seit `since` (auf asof). */
async function loadReconciledMetrics(supabase: SupabaseAdmin, mode: RunMode, since: string | undefined): Promise<RunMetrics[]> {
  const metrics: RunMetrics[] = []
  for (let offset = 0; ; offset += PAGE) {
    let query = supabase.from('curation_runs').select('metrics').eq('status', 'done').eq('mode', mode).not('reconciled_at', 'is', null)
    if (since) query = query.gte('asof', `${since}T00:00:00.000Z`)
    const { data, error } = await query.order('asof', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`curation_runs: ${error.message}`)
    if (!data || data.length === 0) break
    for (const row of data as Array<{ metrics: unknown }>) if (row.metrics) metrics.push(row.metrics as RunMetrics)
    if (data.length < PAGE) break
  }
  return metrics
}

/** baselines.hand.precision_full aus scripts/curation-baseline.json, falls die Datei existiert — sonst null (kein Gate-Vergleich). */
function handPrecisionRefOf(): number | null {
  if (!existsSync(BASELINE_FILE)) return null
  try {
    const raw = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { baselines?: { hand?: { precision_full?: unknown } } }
    const value = raw.baselines?.hand?.precision_full
    return typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1) })
