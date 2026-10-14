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
 * Lauf: pnpm curation:shadow-once -- --dry-run
 *       pnpm curation:shadow-once
 *       pnpm curation:shadow-once -- --asof 2026-10-14T04:25:00.000Z
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
  const asof = asofArg ?? new Date().toISOString()

  const { berlinDay } = await import('@/lib/curation/precedents')
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { createCaller } = await import('@/lib/ai/call')
  const { flushUsageLog } = await import('@/lib/ai/usage-log')
  const { generateEmbeddings } = await import('@/lib/embeddings/generator')
  const { createRun, finishRun, loadCurationSettings } = await import('@/lib/curation/service')
  const { phaseCluster, phasePool, runDayInline } = await import('@/lib/curation/run')
  const { reconcileRun } = await import('@/lib/curation/reconcile')
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
    let patched = run
    try {
      const poolPatch = await phasePool(deps, run)
      patched = { ...run, ...poolPatch }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.startsWith('pool_small')) throw err
      await finishRun(supabase, run.id, 'error', message)
      console.warn(`[Curation] ${day}: ${message} — kein Cluster, Run auf error`)
      await flushUsageLog()
      return 0
    }
    const clusterPatch = await phaseCluster(deps, patched)
    patched = { ...patched, ...clusterPatch }

    const pool = patched.pool!
    const cluster = patched.story_keys!
    const stories = Object.keys(cluster.clusters).length
    const ex = pool.excluded
    console.log(
      `[Curation] ${day}: Pool ${pool.items.length} Items `
      + `(excluded used_earlier ${ex.used_earlier}, expired ${ex.expired}, skipped ${ex.skipped}, junk ${ex.junk}, short ${ex.short}) `
      + `· ${stories} Stories · ${pool.handIds.length} Hand`,
    )
    await finishRun(supabase, run.id, 'cancelled')
    await flushUsageLog()
    return 0
  }

  const finished = await runDayInline(deps, run)
  console.log(`[Curation] ${day}: Lauf beendet — Status ${finished.status}, Phase ${finished.phase}, ${finished.spend_usd.toFixed(2)} USD, Degradierungen ${JSON.stringify(finished.degraded)}`)

  if (finished.status === 'done') {
    // WARUM sofort und nicht ueber getRunsToReconcile (service.ts, 10 min
    // Vorlauf): ein manuell angestossener Einzellauf soll sein Ergebnis beim
    // Beenden des Scripts zeigen, nicht erst beim naechsten Cron-Tick.
    const { matched, metrics } = await reconcileRun(supabase, finished, embed)
    console.log(
      `[Curation] ${day}: Rekonziliation — ${matched ? `Post ${matched.post_id} (${matched.attribution})` : 'kein Post (zu frueh?)'} `
      + `· UnitRecall@20 ${metrics.unit_recall_20.toFixed(2)}`,
    )
  } else {
    console.warn(`[Curation] ${day}: Lauf nicht 'done' (${finished.status}) — ${finished.error_message ?? 'kein Fehlertext'}, keine Rekonziliation.`)
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG — ${mins} min`)
  await flushUsageLog()
  return 0
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1) })
