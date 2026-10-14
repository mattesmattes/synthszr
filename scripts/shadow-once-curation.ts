#!/usr/bin/env npx tsx
/**
 * Ein einzelner Shadow-Lauf der Morgenkonferenz, Phase 1 „Shadow" (Task 14):
 * derselbe Weg wie der Minuten-Cron (app/api/cron/curation-jobs/route.ts),
 * aber in einem Rutsch (runDayInline statt tickweise advanceRun) und von
 * Hand angestossen — der erste beobachtete Lauf, BEVOR settings.curation
 * .shadow_enabled auf true steht (Betreiber-Freigabe, Anhang A §1).
 *
 * `asof`: `--asof <ISO>` oder der aktuelle Zeitpunkt — anders als die
 * Cron-Route (kickoffAsOf, nur zum konfigurierten UTC-Slot) laeuft dieser
 * Script-Aufruf, wann der Betreiber ihn startet, nicht erst nach dem
 * Kickoff-Slot.
 *
 * `--dry-run`: nur phasePool und phaseCluster, OHNE advanceRun und OHNE
 * Modellaufruf (Ruling R12, wie backtest-curation.ts) — zeigt Pool-Groesse,
 * Ausschluesse, Stories und Hand-Anteil, Run endet als `cancelled`.
 *
 * Rekonziliation (Final-Review 2026-10-14 (R21)): nur, wenn das
 * Abgleichfenster (24 h nach `asof`) geschlossen ist — sonst fehlt der Post
 * des Tages meist noch, und ein Abgleich schriebe dauerhaft attribution
 * 'none'. Den Shadow-Run gleicht dann der Cron am Folgetag ab.
 * `--force` gleicht trotzdem sofort ab.
 *
 * Fehler des Laufs (Fix-Runde 1, Review Important #1, "dasselbe Muster wie
 * backtest-curation.ts"): ein Fehler in runDayInline oder der anschliessenden
 * Rekonziliation wird geloggt, der Run per `finishRun(...,'error',message)`
 * abgeschlossen (sonst blockiert die offene Zeile ueber den Unique-Index
 * einen erneuten Versuch) und das Script beendet mit Exit 1 — ebenso, wenn
 * der Lauf ohne Wurf in einem anderen Status als 'done' endet.
 *
 * Lauf: pnpm curation:shadow-once -- --dry-run
 *       pnpm curation:shadow-once
 *       pnpm curation:shadow-once -- --asof 2026-10-14T04:25:00.000Z
 *       pnpm curation:shadow-once -- --asof 2026-10-12T04:25:00.000Z --force
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import type { CallToolFn } from '@/lib/ai/call'
import type { RunDeps } from '@/lib/curation/run'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

/** Wie die Cron-Route (app/api/cron/curation-jobs/route.ts:66): voller Archivbrief im Shadow-Betrieb. */
const BRIEF_MODE = 'full' as const

/** `--asof <ISO>` — undefined ohne Flag, null bei ungueltigem Wert (kein stiller Fallback auf „jetzt"). */
function parseAsofArg(argv: string[]): string | undefined | null {
  const idx = argv.findIndex((a) => a === '--asof' || a.startsWith('--asof='))
  if (idx < 0) return undefined
  const raw = argv[idx].includes('=') ? argv[idx].slice('--asof='.length) : argv[idx + 1]
  if (!raw || Number.isNaN(Date.parse(raw))) return null
  return raw
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const asofArg = parseAsofArg(argv)
  if (asofArg === null) {
    console.warn('[Curation] WARNUNG: --asof ist ungueltig (ISO-8601 erwartet) — Abbruch.')
    return 1
  }
  const dryRun = argv.includes('--dry-run')
  const force = argv.includes('--force')
  const asof = asofArg ?? new Date().toISOString()

  const { dryRunPoolLine } = await import('@/lib/curation/backtest')
  const { berlinDay } = await import('@/lib/curation/precedents')
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { createCaller } = await import('@/lib/ai/call')
  const { generateEmbeddings } = await import('@/lib/embeddings/generator')
  const { claimRun, createRun, finishRun, loadCurationSettings } = await import('@/lib/curation/service')
  const { phaseCluster, phasePool, runDayInline, RunClaimLostError } = await import('@/lib/curation/run')
  const { isMatchWindowOpen, reconcileRun } = await import('@/lib/curation/reconcile')
  const supabase = createAdminClient()

  const day = berlinDay(asof)
  console.log(`[Curation] shadow-once-curation: Tag ${day}, asof ${asof}${dryRun ? ', DRY-RUN' : ''}`)
  const t0 = Date.now()

  const { modelFor } = createCaller({ runId: 'model-lookup', mode: 'shadow' })
  const models = {
    scout: await modelFor('curation_scout'),
    editor: await modelFor('curation_editor'),
    critic: await modelFor('curation_critic'),
  }
  const settings = await loadCurationSettings(supabase)
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })

  const run = await createRun(supabase, { day, mode: 'shadow', asof, brief_mode: BRIEF_MODE, budget_usd: settings.budget_usd, models })
  console.log(`[Curation] ${day}: Run ${run.id} angelegt (Phase ${run.phase}, Status ${run.status})`)

  const dryRunCallTool: CallToolFn = async () => {
    // Sicherheitsnetz zu Ruling R12 (wie backtest-curation.ts): phasePool und
    // phaseCluster rufen callTool heute nicht auf.
    throw new Error('dry-run: Modellaufruf nicht erlaubt')
  }
  const callTool = dryRun ? dryRunCallTool : createCaller({ runId: run.id, mode: 'shadow' }).callTool
  const deps: RunDeps = { supabase, callTool, embed, settings, models, budgetMs: Number.POSITIVE_INFINITY, log: console.log }

  if (dryRun) {
    // Ruling R12 (wie backtest-curation.ts): nur Pool + Cluster, kein
    // advanceRun, kein weiteres Schreiben ausser der angelegten Zeile selbst.
    // Lease wie runDayInline (Final-Review 2026-10-14 (R23)): ein pending-
    // Shadow-Run ohne Lease waere fuer den Minutentick ein normaler offener
    // Run — er naehme ihn auf und bezahlte Modellaufrufe fuer einen Dry-Run.
    if (!(await claimRun(supabase, run.id, run.attempts + 1))) {
      console.warn(`[Curation] ${day}: Run ${run.id} wird von einem anderen Prozess bearbeitet — Dry-Run abgebrochen.`)
      return 1
    }
    let patched = run
    try {
      const poolPatch = await phasePool(deps, run)
      patched = { ...run, ...poolPatch }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.startsWith('pool_small')) throw err
      await finishRun(supabase, run.id, 'error', message)
      console.warn(`[Curation] ${day}: ${message} — kein Cluster, Run auf error`)
      return 1
    }
    const clusterPatch = await phaseCluster(deps, patched)
    patched = { ...patched, ...clusterPatch }

    console.log(dryRunPoolLine(day, patched.pool!, patched.story_keys!))
    await finishRun(supabase, run.id, 'cancelled')
    return 0
  }

  try {
    const finished = await runDayInline(deps, run)
    console.log(`[Curation] ${day}: Lauf beendet — Status ${finished.status}, Phase ${finished.phase}, ${finished.spend_usd.toFixed(2)} USD, Degradierungen ${JSON.stringify(finished.degraded)}`)

    if (finished.status !== 'done') {
      // WARUM Exit 1 ohne Wurf: pool_small (oder ein anderer Status, den
      // advanceRun selbst setzt) hat keinen Post-Abgleich zum Ziel — der
      // Betreiber soll den Fehlschlag am Exit-Code erkennen, nicht nur im Log.
      console.warn(`[Curation] ${day}: Lauf nicht 'done' (${finished.status}) — ${finished.error_message ?? 'kein Fehlertext'}, keine Rekonziliation.`)
      return 1
    }

    // WARUM nur bei geschlossenem Abgleichfenster (Final-Review 2026-10-14
    // (R21)): ein Lauf mit asof von heute faende den Post des Tages noch
    // nicht und schriebe reconciled_at mit attribution 'none' — endgueltig.
    // Dann uebernimmt der Cron am Folgetag (getRunsToReconcile). Ein
    // nachgeholter Lauf fuer einen frueheren Tag (--asof) gleicht sofort ab.
    if (!force && isMatchWindowOpen(finished.asof, Date.now())) {
      console.log(`[Curation] ${day}: Abgleichfenster noch offen, Rekonziliation übersprungen`)
    } else {
      const { matched, metrics } = await reconcileRun(supabase, finished, embed)
      console.log(
        `[Curation] ${day}: Rekonziliation — ${matched ? `Post ${matched.post_id} (${matched.attribution})` : 'kein Post (zu frueh?)'} `
        + `· UnitRecall@20 ${metrics.unit_recall_20.toFixed(2)}`,
      )
    }
  } catch (err) {
    // WARUM hier fangen (Fix-Runde 1, Review Important #1, dasselbe Muster
    // wie backtest-curation.ts): ohne diesen Fang springt ein Fehler aus
    // runDayInline oder reconcileRun direkt in runScript()s Catch-Zweig,
    // OHNE den Run abzuschliessen — die Zeile bleibt 'processing' und
    // blockiert ueber curation_runs_one_open_per_day jeden erneuten Versuch.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Curation] ${day}: FEHLER ${message}`)
    // Claim verloren (Final-Review 2026-10-14 (R23)): der Run gehoert dem
    // Prozess, der das Lease haelt (meist der Cron) — ihn hier als 'error'
    // abzuschliessen, braeche dessen laufende Arbeit ab.
    if (err instanceof RunClaimLostError) return 1
    try {
      await finishRun(supabase, run.id, 'error', message)
    } catch (recoveryErr) {
      // WARUM dieses verschachtelte try/catch (Review 2026-10-14, R20):
      // finishRun kann selbst scheitern (transienter Supabase-Fehler) — ohne
      // diesen Fang wuerde DIESER Fehler ungefangen in runScript()s
      // Catch-Zweig springen; das Ergebnis waere dasselbe wie ohne Fang
      // ueberhaupt (Run bleibt 'processing', blockiert ueber
      // curation_runs_one_open_per_day), nur mit einem irrefuehrenden
      // Stacktrace statt der eigentlichen Fehlermeldung im Log. Exit 1 steht
      // so oder so fest, also nur geloggt, nicht erneut geworfen.
      const recoveryMessage = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
      console.error(`[Curation] ${day}: Sekundaerfehler ${recoveryMessage}`)
    }
    return 1
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG — ${mins} min`)
  return 0
}

void import('@/scripts/lib/curation-script-runner').then(({ runScript }) => runScript(main))
