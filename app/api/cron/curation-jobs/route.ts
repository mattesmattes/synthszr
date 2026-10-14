import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCaller } from '@/lib/ai/call'
import { generateEmbeddings } from '@/lib/embeddings/generator'
import { berlinDay } from '@/lib/curation/precedents'
import {
  appendRunLog, claimRun, createRun, finishRun, getNextOpenRun, getRunsToReconcile,
  kickoffAsOf, listRuns, loadCurationSettings, releaseLease, spentTodayUsd, stamp, MAX_ATTEMPTS,
} from '@/lib/curation/service'
import { advanceRun, TICK_BUDGET_MS } from '@/lib/curation/run'
import { reconcileRun } from '@/lib/curation/reconcile'

// 800 wie app/api/cron/article-jobs/route.ts:6 (Pro-Plan) — TICK_BUDGET_MS
// (600 s, lib/curation/run.ts) laesst 200 s fuer Protokoll und Antwort.
export const maxDuration = 800
export const runtime = 'nodejs'

/**
 * Minutentick der Morgenkonferenz, Phase 1 „Shadow" (Anhang A §3, Task 12):
 * (1) Kickoff zum festen UTC-Slot, (2) Rekonziliation des Vortags — hat
 * Vorrang vor (3), weil sie kurz ist und sonst von einer langen
 * Advance-Arbeitseinheit verdraengt wuerde — (3) sonst eine Arbeitseinheit
 * eines offenen Runs mit Lease. Immer HTTP 200 (ausser 401): Vercel fuehrt
 * den Cron bei jedem anderen Status als fehlgeschlagen.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request).authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const settings = await loadCurationSettings(supabase)
  const nowIso = new Date().toISOString()
  const out: Record<string, unknown> = { ok: true }
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })

  // 1 Kickoff — fester UTC-Slot in Phase 1 (kein Analyse-Trigger, keine
  // Deadline-Pruefung; beides kommt erst in Phase 2, Anhang A §3 Step 3).
  if (settings.shadow_enabled) {
    const asof = kickoffAsOf(nowIso, settings.kickoff_utc)
    if (asof) {
      const day = berlinDay(asof)
      const today = (await listRuns(supabase, { limit: 5, mode: 'shadow' })).filter((r) => r.day === day)
      const spent = await spentTodayUsd(supabase, day)
      // Nur anlegen, wenn weder heute schon ein Run existiert noch die
      // Tageskappe ausgeschoepft ist — sonst legte jeder Minutentick nach dem
      // Kickoff-Slot einen weiteren Run an (der Unique-Index schuetzt nur vor
      // ZWEI OFFENEN Runs, nicht vor beliebig vielen fertigen).
      if (!today.length && spent < settings.daily_budget_usd) {
        const { modelFor } = createCaller({ runId: 'kickoff', mode: 'shadow' })
        const run = await createRun(supabase, {
          day,
          mode: 'shadow',
          asof,
          brief_mode: 'full',
          budget_usd: settings.budget_usd,
          models: {
            scout: await modelFor('curation_scout'),
            editor: await modelFor('curation_editor'),
            critic: await modelFor('curation_critic'),
          },
        })
        out.kickoff = run.id
      }
    }
  }

  // 2 Rekonziliation des Vortags — eine je Tick, kurz; ein Fehler bleibt
  // sichtbar im Body, bricht den Tick aber nicht ab (eigener Pfad, kein throw).
  const [due] = await getRunsToReconcile(supabase, nowIso, 1)
  if (due) {
    try {
      const r = await reconcileRun(supabase, due, embed)
      out.reconciled = due.id
      out.attribution = r.matched?.attribution ?? 'none'
    } catch (err) {
      console.error('[Curation] Rekonziliation fehlgeschlagen:', err)
      out.reconcile_error = err instanceof Error ? err.message : String(err)
    }
    return NextResponse.json(out)
  }

  // 3 Advance — eine Arbeitseinheit je Tick (Muster app/api/cron/glossary-jobs/route.ts).
  const run = await getNextOpenRun(supabase)
  if (!run) return NextResponse.json({ ...out, idle: true })

  // Aufgeben, BEVOR gearbeitet wird: MAX_ATTEMPTS erfolglose Ticks heissen
  // meist Function-Timeout — ein hart beendeter Tick kann danach selbst
  // nichts mehr schreiben, der Check hier ist der einzige Ausweg (Muster
  // glossary-jobs/route.ts).
  if (run.attempts >= MAX_ATTEMPTS) {
    await finishRun(supabase, run.id, 'error', `Nach ${MAX_ATTEMPTS} Durchgaengen ohne Fortschritt aufgegeben (Function-Timeout?). Server-Log pruefen.`)
    return NextResponse.json({ ...out, ok: false, error: 'max attempts' })
  }

  // Versuch zaehlen und Lease stempeln in EINEM Update, vor der Arbeit — ein
  // Tick, der ins Timeout laeuft, schreibt danach nichts mehr; der Zaehler
  // muss also schon beim Start persistiert sein (claimRun, service.ts).
  const attempt = run.attempts + 1
  await claimRun(supabase, run.id, attempt)
  run.attempts = attempt

  const { callTool } = createCaller({ runId: run.id, mode: 'shadow' })
  try {
    const res = await advanceRun(
      {
        supabase,
        callTool,
        embed,
        settings,
        models: { scout: run.model_scout!, editor: run.model_editor!, critic: run.model_critic! },
        budgetMs: TICK_BUDGET_MS,
        log: (t) => console.log(t),
      },
      run,
    )
    // R10 (Controller-Ruling, verbindlich): advanceRun meldet finished:false,
    // wenn das Tick-Budget aufgebraucht ist ODER compose auf den naechsten
    // Tick vertagt (COMPOSE_MIN_REMAINING_MS, run.ts) — in beiden Faellen hat
    // die zuletzt gelaufene Phase ihren Zwischenstand schon persistiert
    // (advanceRun ruft saveRunState vor der Rueckkehr). Das Lease bliebe sonst
    // bis LEASE_STALE_MS (15 min, service.ts) stehen, obwohl der naechste
    // Minutentick sofort weiterarbeiten koennte — die Freigabe spart bis zu
    // 15 Minuten Leerlauf je Vertagung.
    if (!res.finished) await releaseLease(supabase, run.id)
    return NextResponse.json({ ...out, advanced: run.id, ...res })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[Curation] Tick fehlgeschlagen:', err)
    await appendRunLog(supabase, run, [{ at: stamp(), text: `Tick fehlgeschlagen: ${message}`, ok: false }])
    // Lease freigeben: sonst nimmt der naechste Tick den Run erst nach
    // LEASE_STALE_MS wieder auf statt in der naechsten Minute (gleiche
    // Begruendung wie der Ueberlast-Pfad in glossary-jobs/route.ts).
    await releaseLease(supabase, run.id)
    return NextResponse.json({ ...out, ok: false, advanced: run.id, error: message })
  }
}
