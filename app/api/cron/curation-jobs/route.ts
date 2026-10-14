import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCaller } from '@/lib/ai/call'
import { generateEmbeddings } from '@/lib/embeddings/generator'
import { berlinDay } from '@/lib/curation/precedents'
import {
  appendRunLog, claimRun, createRun, finishRun, getNextOpenRun, getRunsToReconcile,
  kickoffAsOf, listRuns, loadCurationSettings, markReconciled, releaseLease, spentTodayUsd, stamp, MAX_ATTEMPTS,
} from '@/lib/curation/service'
import { advanceRun, TICK_BUDGET_MS } from '@/lib/curation/run'
import { reconcileRun } from '@/lib/curation/reconcile'

// 800 wie app/api/cron/article-jobs/route.ts:6 (Pro-Plan) — TICK_BUDGET_MS
// (600 s, lib/curation/run.ts) laesst 200 s fuer Protokoll und Antwort.
export const maxDuration = 800
export const runtime = 'nodejs'

/** Praefix der Protokollzeile eines gescheiterten Abgleichs — der Zaehler fuer MAX_RECONCILE_FAILURES. */
const RECONCILE_ERROR = 'reconcile_error'

/**
 * Fehlversuche, nach denen der Abgleich eines Runs aufgegeben wird
 * (Final-Review 2026-10-14 (R22)). Ein dauerhafter Fehler (Embedding lehnt
 * einen Abschnitt ab, Post geloescht) soll nicht jede Minute bezahlte
 * Embedding-Calls und rund 9 MB Egress wiederholen.
 */
const MAX_RECONCILE_FAILURES = 3

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
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: 16 })

  try {
    // R19 (Controller-Ruling, verbindlich): aeusserer try/catch um den
    // gesamten Tick NACH der Auth-Pruefung. Ohne ihn verliesse eine
    // DB-Exception AUSSERHALB jeder Arbeitseinheit (loadCurationSettings,
    // listRuns, spentTodayUsd, createRun, getRunsToReconcile, getNextOpenRun,
    // claimRun) den Handler ungefangen — Next.js antwortete dann mit 500, und
    // Vercel fuehrt jede Nicht-200-Antwort als fehlgeschlagenen Cron. Die
    // inneren try/catch-Bloecke (Rekonziliation, Advance) bleiben zusaetzlich
    // bestehen: sie behandeln ueber das reine Abfangen hinaus auch Log und Lease.
    const settings = await loadCurationSettings(supabase)
    const nowIso = new Date().toISOString()
    const out: Record<string, unknown> = { ok: true }

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

    // 2 Rekonziliation des Vortags — eine je Tick, kurz. Nur ein ERFOLGREICHER
    // Abgleich beendet den Tick (Vorrang vor Advance). Ein Fehler wird am Run
    // protokolliert und der Tick faellt zu Schritt 3 durch (Final-Review
    // 2026-10-14 (R22), I1): getRunsToReconcile liefert per limit 1 / asof asc
    // immer denselben Run — ein dauerhafter Fehler blockierte sonst jeden
    // Advance, auch den des heutigen Runs (Spec-Fehlerpfad „Rekonziliation
    // wirft: best-effort, Log, Run laeuft weiter").
    const [due] = await getRunsToReconcile(supabase, nowIso, 1)
    if (due) {
      const failures = due.log.filter((entry) => entry.text.startsWith(RECONCILE_ERROR)).length
      if (failures >= MAX_RECONCILE_FAILURES) {
        // Vor dem erneuten Versuch pruefen, nicht danach: der Run wird
        // abgeschlossen, ohne noch einmal Embedding-Calls zu bezahlen.
        // metrics null statt Nullen — aggregateRuns ignoriert ihn, das Panel
        // zeigt „Abgleich fehlgeschlagen" statt einer Messung mit Ergebnis 0.
        try {
          await markReconciled(supabase, due.id, { matched_post_id: null, matched_job_id: null, metrics: null })
          const text = `reconcile_failed: nach ${failures} Fehlversuchen aufgegeben`
          await appendRunLog(supabase, due, [{ at: stamp(), text, ok: false }])
          console.warn(`[Curation] Rekonziliation ${due.day} aufgegeben (${failures} Fehlversuche)`)
          out.reconcile_failed = due.id
        } catch (err) {
          console.error('[Curation] Rekonziliation: Abschluss nach Fehlversuchen fehlgeschlagen:', err)
          out.ok = false
          out.reconcile_error = err instanceof Error ? err.message : String(err)
        }
      } else {
        try {
          const r = await reconcileRun(supabase, due, embed)
          out.reconciled = due.id
          out.attribution = r.matched?.attribution ?? 'none'
          return NextResponse.json(out)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[Curation] Rekonziliation fehlgeschlagen:', err)
          out.ok = false
          out.reconcile_error = message
          // Eigener Fang: scheitert schon das Protokoll, soll der Advance
          // trotzdem laufen — der Fehlversuch zaehlt dann eben erst beim
          // naechsten Tick, der Run bleibt sichtbar offen.
          try {
            await appendRunLog(supabase, due, [{ at: stamp(), text: `${RECONCILE_ERROR}: ${message}`, ok: false }])
          } catch (logErr) {
            console.error('[Curation] Rekonziliation: Protokoll fehlgeschlagen:', logErr)
          }
        }
      }
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
    // Compare-and-Set (Final-Review 2026-10-14 (R23)): hat ein anderer Tick
    // oder ein Script den Run zwischen getNextOpenRun und hier geclaimt,
    // greift das Update nicht — dann ohne Arbeit enden, auch ohne Log und
    // ohne releaseLease, denn das Lease gehoert dem anderen Prozess.
    const attempt = run.attempts + 1
    const claimed = await claimRun(supabase, run.id, attempt)
    if (!claimed) {
      console.log(`[Curation] claim verloren ${run.id}`)
      return NextResponse.json({ ...out, claim_lost: run.id })
    }
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
  } catch (err) {
    // Faengt nur Fehler AUSSERHALB jeder Arbeitseinheit (s. Kommentar oben) —
    // ohne Run-Kontext gibt es hier kein Log und kein Lease zu bedienen, nur
    // eine saubere 200-Antwort, damit Vercel den Cron nicht als fehlgeschlagen fuehrt.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[Curation] Tick fehlgeschlagen (ausserhalb der Arbeitseinheit):', err)
    return NextResponse.json({ ok: false, error: message }, { status: 200 })
  }
}
