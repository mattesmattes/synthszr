#!/usr/bin/env npx tsx
/**
 * Backtest der Morgenkonferenz-Engine, Phase 1 „Shadow" (Task 14, Anhang A
 * §3.9/3.10): fuehrt runDayInline fuer vergangene Tage in einem Rutsch aus
 * und gleicht jeden Tag SOFORT gegen den historisch veroeffentlichten Post
 * ab (reconcileRun) — der Post ist bei einem Backtest-Tag bereits bekannt,
 * anders als beim Shadow-Betrieb, der zehn Minuten nach `asof` wartet
 * (getRunsToReconcile, service.ts).
 *
 * Tage: backtestDays (lib/curation/backtest.ts) — Gate-Fenster [from,to]
 * UNION die letzten `last` Tage vor heute, sortiert, dedupliziert, bei
 * `--limit` vom Anfang gekappt. Ein Tag mit einem bereits `done`-Backtest-
 * Run wird uebersprungen (ausser `--force`): der Unique-Index auf
 * curation_runs schuetzt nur offene Status (Anhang A §1), ein erneuter
 * Lauf legte sonst bei jedem Wiederanlauf einen zweiten, kostenpflichtigen
 * Run fuer denselben Tag an.
 *
 * Kosten: ein Tag kostet ungefaehr 1-2 USD (Scout, Chefredaktion, Kritiker);
 * `--max-usd` bricht ab, SOBALD die bisher in DIESEM Lauf angefallenen
 * Kosten die Grenze ueberschreiten (uebersprungene, schon erledigte Tage
 * zaehlen nicht mit — sonst scheiterte jeder Wiederanlauf eines grossen
 * Backtests sofort am Budget der schon bezahlten Tage), schreibt den Report
 * trotzdem und beendet mit Exit 1.
 *
 * `--dry-run`: nur phasePool und phaseCluster, OHNE advanceRun und OHNE
 * Modellaufruf (Ruling R12) — zeigt Pool-Groesse, Ausschluesse, Stories und
 * Hand-Anteil, schreibt aber NICHTS in curation_runs ausser der angelegten
 * Zeile selbst (kein saveRunState); der Run endet als `cancelled`.
 *
 * Lauf: pnpm curation:backtest -- --dry-run --limit 2
 *       pnpm curation:backtest -- --limit 2 --max-usd 6 --out scripts/curation-backtest-probe.json
 *       pnpm curation:backtest                              (voller Gate-Bereich, ~55-90 USD)
 */
import { config } from 'dotenv'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { CallToolFn } from '@/lib/ai/call'
import type { RunDeps } from '@/lib/curation/run'
import type { RunRow } from '@/lib/curation/types'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

/** Tage, die gleichzeitig laufen, solange `--sequential` nicht gesetzt ist — s. Begruendung bei groupsOf unten. */
const PARALLEL_DAYS = 3
/** Baseline-Report aus measure-curation-baseline.ts — Referenz fuer aggregateRuns' precision_vs_hand-Gate. */
const BASELINE_FILE = 'scripts/curation-baseline.json'

async function main(): Promise<number> {
  const { parseBacktestArgs, backtestDays, backtestDayReportOf, buildBacktestReport, doneRunIdByDay } =
    await import('@/lib/curation/backtest')

  const parsed = parseBacktestArgs(process.argv.slice(2))
  if (!parsed) {
    // WARUM vor jedem DB-Zugriff: der Parser laeuft, BEVOR ein Supabase-Client
    // oder ein Modell-Aufrufer entsteht — ein Tippfehler in --brief o.ae.
    // soll nicht erst nach einem teuren Teil-Lauf auffallen.
    console.warn('[Curation] WARNUNG: Argumente ungueltig (--from/--to/--last/--brief/--limit/--max-usd/--kickoff/--out pruefen) — Abbruch.')
    return 1
  }
  // WARUM eine eigene Zuweisung statt mit `parsed` weiterzuarbeiten: die
  // Funktionen weiter unten (processDay, dryRunDay, runDayFull) sind
  // verschachtelte Closures — TypeScript haelt eine Null-Pruefung nicht ueber
  // Funktionsgrenzen hinweg fest. `args` ist eine frische, nie neu zugewiesene
  // const-Bindung mit dem schon geprueften, nicht-nullen Typ und bleibt
  // deshalb auch in den Closures nicht-nullable.
  const args = parsed

  const { berlinDay } = await import('@/lib/curation/precedents')
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { createCaller } = await import('@/lib/ai/call')
  const { flushUsageLog } = await import('@/lib/ai/usage-log')
  const { generateEmbeddings } = await import('@/lib/embeddings/generator')
  const { createRun, finishRun, getRun, listRuns, loadCurationSettings } = await import('@/lib/curation/service')
  const { phaseCluster, phasePool, runDayInline } = await import('@/lib/curation/run')
  const { reconcileRun } = await import('@/lib/curation/reconcile')
  const supabase = createAdminClient()

  const today = berlinDay(new Date().toISOString())
  const days = backtestDays(args, today)
  console.log(
    `[Curation] backtest-curation: ${days.length} Tage (${days[0]}..${days[days.length - 1]}), brief=${args.brief}, `
    + `${args.sequential ? 'sequentiell' : `parallel (${PARALLEL_DAYS})`}${args.dryRun ? ', DRY-RUN' : ''}, Budget ${args.maxUsd} USD`,
  )
  const t0 = Date.now()

  // WARUM einmal vor der Tagesschleife: modelFor haengt (lib/ai/call.ts)
  // nicht von runId ab, nur der spaetere callTool je Tag braucht den
  // ECHTEN Run fuer die Kostenzuordnung in llm_usage (Muster: cron-Route
  // app/api/cron/curation-jobs/route.ts verwendet denselben Sentinel-Trick
  // mit runId 'kickoff' fuer die Modellwahl vor dem createRun).
  const modelLookup = createCaller({ runId: 'model-lookup', mode: 'backtest' })
  const models = {
    scout: await modelLookup.modelFor('curation_scout'),
    editor: await modelLookup.modelFor('curation_editor'),
    critic: await modelLookup.modelFor('curation_critic'),
  }
  const settings = await loadCurationSettings(supabase)
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })
  const [kickoffHH, kickoffMM] = args.kickoffUtc.split(':')

  // WARUM einmal vorab geladen statt je Tag eine Abfrage: ein Backtest ueber
  // 36+ Gate-Tage waere sonst 36 zusaetzliche Round-Trips nur fuers
  // Ueberspringen-Pruefen.
  const existingDays = args.force ? [] : await listRuns(supabase, { limit: 2000, mode: 'backtest' })
  const doneByDay = doneRunIdByDay(existingDays)

  const dryRunCallTool: CallToolFn = async () => {
    // Sicherheitsnetz zu Ruling R12: phasePool/phaseCluster rufen callTool
    // heute nicht auf — faellt das in Zukunft nicht mehr zu, bricht der
    // Dry-Run hier hart ab, statt still einen Modellaufruf zu bezahlen.
    throw new Error('dry-run: Modellaufruf nicht erlaubt')
  }

  type DayReport = ReturnType<typeof backtestDayReportOf>
  const reports: DayReport[] = []
  let spentThisRun = 0
  let budgetExceeded = false

  async function mustGetRun(id: string) {
    const run = await getRun(supabase, id)
    if (!run) throw new Error(`curation_runs: Run ${id} nicht gefunden`)
    return run
  }

  /** Pool- und Cluster-Vorschau ohne advanceRun, ohne Modellaufruf, ohne Zwischenspeichern (Ruling R12). */
  async function dryRunDay(deps: RunDeps, run: RunRow): Promise<DayReport> {
    let patched: RunRow
    try {
      const poolPatch = await phasePool(deps, run)
      patched = { ...run, ...poolPatch }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.startsWith('pool_small')) throw err
      await finishRun(supabase, run.id, 'error', message)
      console.warn(`[Curation] ${run.day}: ${message} — kein Cluster, Run auf error`)
      return backtestDayReportOf(await mustGetRun(run.id))
    }
    const clusterPatch = await phaseCluster(deps, patched)
    patched = { ...patched, ...clusterPatch }

    const pool = patched.pool!
    const cluster = patched.story_keys!
    const stories = Object.keys(cluster.clusters).length
    const ex = pool.excluded
    console.log(
      `[Curation] ${run.day}: Pool ${pool.items.length} Items `
      + `(excluded used_earlier ${ex.used_earlier}, expired ${ex.expired}, skipped ${ex.skipped}, junk ${ex.junk}, short ${ex.short}) `
      + `· ${stories} Stories · ${pool.handIds.length} Hand`,
    )

    await finishRun(supabase, run.id, 'cancelled')
    return backtestDayReportOf(await mustGetRun(run.id))
  }

  async function runDayFull(deps: RunDeps, run: RunRow): Promise<DayReport> {
    const finished = await runDayInline(deps, run)
    // WARUM nur bei 'done': reconcileRun braucht run.pool (archive.ts-
    // Snapshot) — ein pool_small-Fehler hat die Pool-Phase nie abgeschlossen,
    // run.pool ist dann null (reconcileRun wirft sonst, s. Anhang A §3.10).
    if (finished.status === 'done') await reconcileRun(supabase, finished, embed)
    const final = await mustGetRun(finished.id)
    const m = final.metrics
    const units = m ? m.plan.recommended + m.plan.bench + m.plan.held : 0
    const recall = m ? m.unit_recall_20.toFixed(2) : '–'
    const baseline = m?.baseline_total_score_unit_recall_20 != null ? m.baseline_total_score_unit_recall_20.toFixed(2) : '–'
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    console.log(
      `[Curation] ${run.day}: ${final.status} · ${units} Einheiten · UnitRecall@20 ${recall} (total_score ${baseline}) `
      + `· ${final.spend_usd.toFixed(2)} USD · ${mins} min`,
    )
    return backtestDayReportOf(final)
  }

  async function processDay(d: string): Promise<{ entry: DayReport; spend: number }> {
    const existingId = doneByDay.get(d)
    if (existingId) {
      console.log(`[Curation] ${d}: uebersprungen — bereits done (Run ${existingId})`)
      return { entry: backtestDayReportOf(await mustGetRun(existingId)), spend: 0 }
    }

    const asof = `${d}T${kickoffHH}:${kickoffMM}:00.000Z`
    const run = await createRun(supabase, { day: d, mode: 'backtest', asof, brief_mode: args.brief, budget_usd: settings.budget_usd, models })
    const callTool = args.dryRun ? dryRunCallTool : createCaller({ runId: run.id, mode: 'backtest' }).callTool
    const deps: RunDeps = { supabase, callTool, embed, settings, models, budgetMs: Number.POSITIVE_INFINITY, log: console.log }

    const entry = args.dryRun ? await dryRunDay(deps, run) : await runDayFull(deps, run)
    return { entry, spend: entry.spend_usd }
  }

  // WARUM 3 parallel ohne --sequential: Backtest-Tage sind voneinander
  // unabhaengig (anders als der Shadow-Betrieb — ein Tag braucht keinen
  // Vortag), drei gleichzeitig halten die Laufzeit handhabbar, ohne das
  // Modell-Rate-Limit zu sprengen (dieselbe Groessenordnung wie
  // SCOUT_PARALLEL in lib/curation/run.ts). `--sequential` erzwingt
  // Gruppen der Groesse 1, weil dann Korrektur-Paare aus EIGENEN,
  // bereits rekonziliierten Backtest-Tagen ueber loadCorrectionPairs
  // (archive.ts, mode 'backtest') in den Archivbrief spaeterer Tage
  // einfliessen sollen — das setzt voraus, dass der fruehere Tag schon
  // fertig UND rekonziliert ist, wenn der naechste beginnt.
  const groups = args.sequential ? days.map((d) => [d]) : groupsOf(days, PARALLEL_DAYS)

  groupLoop: for (const group of groups) {
    const results = await Promise.all(group.map((d) => processDay(d)))
    for (const r of results) {
      reports.push(r.entry)
      spentThisRun += r.spend
    }
    if (spentThisRun > args.maxUsd) {
      budgetExceeded = true
      break groupLoop
    }
  }

  const handPrecisionRef = handPrecisionRefOf()
  const report = buildBacktestReport(args, reports, handPrecisionRef)
  // WARUM nicht bei --dry-run: der Report beschreibt einen echten Backtest-
  // Lauf (Spend, Metriken); eine Pool/Cluster-Vorschau soll eine bestehende
  // Report-Datei nicht stillschweigend ueberschreiben (Muster
  // measure-curation-baseline.ts: `if (!args.dryRun) writeFileSync(...)`).
  if (!args.dryRun) writeFileSync(args.out, JSON.stringify(report, null, 1))

  console.table(report.aggregate.mean)
  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG — ${reports.length}/${days.length} Tage, ${spentThisRun.toFixed(2)} USD (${mins} min)`)
  if (budgetExceeded) {
    console.warn(
      `[Curation] WARNUNG: Budget ueberschritten (${spentThisRun.toFixed(2)} USD > ${args.maxUsd} USD) `
      + `— ${reports.length}/${days.length} Tage verarbeitet, Report trotzdem geschrieben.`,
    )
  }

  // WARUM hier und nicht in .then(): flushUsageLog() muss VOR process.exit
  // abgeschlossen sein (Anhang A §0) — sonst verliert ein Skript die
  // llm_usage-Zeilen der letzten Aufrufe (BEFUND 2026-10-14, usage-log.ts).
  await flushUsageLog()
  return budgetExceeded ? 1 : 0
}

/** Gruppen der Groesse `size`, letzte Gruppe ggf. kleiner — Reihenfolge bleibt erhalten. */
function groupsOf<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
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
