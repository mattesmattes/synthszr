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
 * Fehler eines einzelnen Tages (Fix-Runde 1, Review Important #1): ein
 * Scout-/Kritiker-/Compose-/Archiv-/Rekonziliations-Fehler reisst NICHT den
 * ganzen Backtest mit — der Tag wird als `error` abgeschlossen (Run per
 * `finishRun`, sonst blockiert die offene Zeile ueber den Unique-Index jeden
 * Retry), im Report mit `status:'error'` und `error` gefuehrt, die uebrigen
 * Tage laufen weiter. Nur `pool_small` ist ein Sonderfall: den schliesst
 * `advanceRun` selbst als `error` ab (lib/curation/run.ts:379-387), ohne zu
 * werfen — das greift hier durch, ohne dass dieses Script etwas tun muss.
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

async function main(): Promise<number> {
  const {
    parseBacktestArgs, backtestDays, backtestDayReportOf, buildBacktestReport, doneRunIdByDay, dryRunPoolLine,
    errorDayReportOf, handPrecisionRefOf, BASELINE_FILE,
  } = await import('@/lib/curation/backtest')

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

    console.log(dryRunPoolLine(run.day, patched.pool!, patched.story_keys!))

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

  /**
   * Fehler aus `createRun`, `dryRunDay`/`runDayFull` UND dem Recovery-Pfad
   * selbst (finishRun/mustGetRun) wirft `processDay` nicht weiter (Review
   * 2026-10-14, R20) — jeder dieser Zweige liefert eine Report-Zeile zurueck.
   * Nur so kann `Promise.all` einer Parallelgruppe (unten) verlaesslich ALLE
   * Ergebnisse einsammeln, auch wenn ein Tag scheitert.
   */
  async function processDay(d: string): Promise<{ entry: DayReport; spend: number }> {
    const existingId = doneByDay.get(d)
    if (existingId) {
      console.log(`[Curation] ${d}: uebersprungen — bereits done (Run ${existingId})`)
      return { entry: backtestDayReportOf(await mustGetRun(existingId)), spend: 0 }
    }

    // WARUM createRun jetzt IM try: ein einzelner transienter DB-Fehler auf
    // genau diesem Request hat dieselbe Eintrittswahrscheinlichkeit wie ein
    // transienter Fehler in einer der anderen, schon geschuetzten Phasen
    // (Re-Review 2026-10-14) — der Unique-Violation-Fall (haengender
    // pending/processing-Run) wirft dabei NICHT: createRun faengt ihn selbst
    // ab und liefert den bestehenden offenen Run zurueck (lib/curation/
    // service.ts:100-116); was hier durchkommt, sind echte Ausfaelle.
    let run: RunRow | undefined
    try {
      const asof = `${d}T${kickoffHH}:${kickoffMM}:00.000Z`
      run = await createRun(supabase, { day: d, mode: 'backtest', asof, brief_mode: args.brief, budget_usd: settings.budget_usd, models })
      const callTool = args.dryRun ? dryRunCallTool : createCaller({ runId: run.id, mode: 'backtest' }).callTool
      const deps: RunDeps = { supabase, callTool, embed, settings, models, budgetMs: Number.POSITIVE_INFINITY, log: console.log }
      const entry = args.dryRun ? await dryRunDay(deps, run) : await runDayFull(deps, run)
      return { entry, spend: entry.spend_usd }
    } catch (err) {
      // WARUM hier fangen statt den ganzen Backtest mitreissen zu lassen
      // (Fix-Runde 1, Review Important #1): ein einzelner transienter Fehler
      // (Modell-API, Validierung, Rekonziliation, jetzt auch createRun
      // selbst) soll weder die bereits bezahlten Tage noch den Report
      // verwerfen. finishRun schliesst den Run als 'error' ab — sonst
      // blockiert die offene Zeile (status pending/processing) ueber
      // curation_runs_one_open_per_day jeden Retry desselben Tages; ein Run,
      // der schon 'done' war (nur reconcileRun scheiterte danach), wird
      // bewusst ebenfalls auf 'error' gesetzt — ohne Metriken ist der Tag
      // fuer das Aggregat ohnehin nicht nutzbar.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Curation] ${d}: FEHLER ${message}`)

      if (!run) {
        // createRun selbst ist gescheitert — keine Zeile zum Abschliessen,
        // kein mustGetRun moeglich. Lokaler Eintrag ohne run_id.
        return { entry: errorDayReportOf(d, null, message), spend: 0 }
      }

      try {
        await finishRun(supabase, run.id, 'error', message)
        const entry = backtestDayReportOf(await mustGetRun(run.id))
        return { entry, spend: entry.spend_usd }
      } catch (recoveryErr) {
        // WARUM dieses verschachtelte try/catch (Review 2026-10-14, R20):
        // finishRun/mustGetRun koennen selbst scheitern (transienter
        // Supabase-Fehler beim Status-Update, Zeile nicht gefunden) — ohne
        // diesen Fang entkaeme GENAU DIESER Recovery-Fehler `processDay` und
        // riesse die laufende Promise.all-Gruppe mit, derselbe Fehlerfall wie
        // Important #1, nur auf den Recovery-Pfad selbst verschoben. Scheitert
        // die Recovery, wird der Report-Eintrag lokal gebaut — kein weiteres
        // DB-Lesen, das ebenfalls scheitern koennte.
        const recoveryMessage = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
        console.error(`[Curation] ${d}: Sekundaerfehler ${recoveryMessage}`)
        return { entry: errorDayReportOf(d, run.id, message), spend: 0 }
      }
    }
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

  const failedDays = reports.filter((r) => r.status === 'error').length
  const handPrecisionRef = handPrecisionRefOf(BASELINE_FILE, existsSync, (p) => readFileSync(p, 'utf-8'))
  const report = buildBacktestReport(args, reports, handPrecisionRef)
  // WARUM nicht bei --dry-run: der Report beschreibt einen echten Backtest-
  // Lauf (Spend, Metriken); eine Pool/Cluster-Vorschau soll eine bestehende
  // Report-Datei nicht stillschweigend ueberschreiben (Muster
  // measure-curation-baseline.ts: `if (!args.dryRun) writeFileSync(...)`).
  // Gilt AUCH bei Fehlern: der Report wird immer geschrieben (Review
  // Important #1), nicht nur im reinen Erfolgsfall.
  if (!args.dryRun) writeFileSync(args.out, JSON.stringify(report, null, 1))

  console.table(report.aggregate.mean)
  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG — ${reports.length}/${days.length} Tage (${failedDays} fehlgeschlagen), ${spentThisRun.toFixed(2)} USD (${mins} min)`)
  if (failedDays > 0) {
    console.warn(`[Curation] WARNUNG: ${failedDays} von ${reports.length} Tagen mit Fehler abgeschlossen — Details in ${args.out} (days[].error).`)
  }
  if (budgetExceeded) {
    console.warn(
      `[Curation] WARNUNG: Budget ueberschritten (${spentThisRun.toFixed(2)} USD > ${args.maxUsd} USD) `
      + `— ${reports.length}/${days.length} Tage verarbeitet, Report trotzdem geschrieben.`,
    )
  }

  // WARUM kein flushUsageLog() hier: das uebernimmt runScript() (scripts/lib/
  // curation-script-runner.ts) einheitlich fuer alle drei curation:*-Scripts,
  // AUCH wenn main() wirft (Fix-Runde 1, Review Important #2).
  return budgetExceeded || failedDays > 0 ? 1 : 0
}

/** Gruppen der Groesse `size`, letzte Gruppe ggf. kleiner — Reihenfolge bleibt erhalten. */
function groupsOf<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
}

void import('@/scripts/lib/curation-script-runner').then(({ runScript }) => runScript(main))
