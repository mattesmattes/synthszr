/**
 * Vorrueck-Logik der servergetriebenen Lexikonlaeufe (Task 4). Ein Minutentick
 * ruft advanceJob genau einmal auf; die Funktion arbeitet Einheiten ab, bis das
 * Zeitbudget aufgebraucht oder nichts mehr offen ist.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateCandidates, generateMissingIllustrations, relinkNextBatch } from '@/lib/glossary/crawl'
import { appendLog, finishJob, setAttempts, type GlossaryJob, type GlossaryJobLogEntry } from '@/lib/glossary/jobs/service'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Zeitbudget je Tick. 240s von 300s maxDuration — 60s Sicherheitsabstand, damit
 * das Schreiben des Protokolls nicht in den Timeout laeuft.
 */
const BUDGET_MS = 240_000

/**
 * Annahme fuer die Dauer der ERSTEN Einheit, fuer die es noch keinen Messwert
 * gibt. 270s ist die im Route-Kommentar belegte Obergrenze (ein Begriff mit
 * Nachforderung nach Regel 4, app/api/admin/glossary-crawl/route.ts:157). Die
 * erste Einheit laeuft trotzdem immer, sonst kaeme der Job nie voran; jede
 * weitere nur bei ausreichendem Rest.
 */
const ASSUMED_FIRST_UNIT_MS = 270_000

/** Erfolglose Ticks in Folge, ab denen der Job aufgibt. */
const MAX_ATTEMPTS = 10

function stamp(): string {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface UnitOutcome {
  entries: GlossaryJobLogEntry[]
  /** Etwas erledigt — der Zaehler steigt um diesen Wert. */
  doneDelta: number
  /** Nichts mehr offen: der Job ist fertig. */
  exhausted: boolean
  /** Nur voruebergehend gescheitert (Modell-Ueberlast). */
  overloaded: boolean
}

async function runUnit(supabase: AdminClient, job: GlossaryJob): Promise<UnitOutcome> {
  if (job.kind === 'generate') {
    const r = await generateCandidates(supabase, 1)
    const entries: GlossaryJobLogEntry[] = [
      ...r.generated.map((g) => ({ at: stamp(), text: `${g.name} — erzeugt und veroeffentlicht`, ok: true })),
      ...r.alreadyExisting.map((n) => ({ at: stamp(), text: `${n} — gab es schon, aus der Liste genommen`, ok: true })),
      ...r.failed.map((n) => ({
        at: stamp(),
        text: r.retryable.includes(n)
          ? `${n} — Modell überlastet, bleibt in der Warteschlange`
          : `${n} — fehlgeschlagen, siehe Server-Log`,
        ok: false,
      })),
    ]
    const nothingHappened = r.generated.length === 0 && r.failed.length === 0 && r.alreadyExisting.length === 0
    return {
      entries,
      doneDelta: r.generated.length,
      exhausted: nothingHappened,
      overloaded: r.generated.length === 0 && r.retryable.length > 0,
    }
  }

  if (job.kind === 'images') {
    const r = await generateMissingIllustrations(supabase)
    return {
      entries: [
        ...r.done.map((s) => ({ at: stamp(), text: `${s} — Illustration erzeugt`, ok: true })),
        ...r.failed.map((s) => ({ at: stamp(), text: `${s} — Illustration fehlgeschlagen`, ok: false })),
      ],
      doneDelta: r.done.length,
      exhausted: r.remaining === 0,
      overloaded: false,
    }
  }

  const since = (job.params.since as string | undefined) ?? null
  const r = await relinkNextBatch(supabase, { since })
  return {
    entries: [
      ...r.linked.map((s) => ({ at: stamp(), text: `${s} — neu verlinkt`, ok: true })),
      { at: stamp(), text: `${r.unchanged} Artikel unveraendert, ${r.remaining} offen`, ok: true },
    ],
    doneDelta: r.linked.length,
    exhausted: r.remaining === 0,
    overloaded: false,
  }
}

/**
 * Arbeitet Einheiten ab, bis das Zeitbudget aufgebraucht oder nichts mehr offen
 * ist. `now` ist injizierbar, damit das Budget testbar bleibt.
 */
export async function advanceJob(
  supabase: AdminClient,
  job: GlossaryJob,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<{ units: number; finished: boolean }> {
  const now = opts.now ?? (() => Date.now())
  const budgetMs = opts.budgetMs ?? BUDGET_MS
  const started = now()
  let units = 0
  /**
   * Die langsamste bisher gemessene Einheit dieses Ticks. Vor der ersten Einheit
   * gibt es keinen Messwert — dort gilt die Annahme aus
   * ASSUMED_FIRST_UNIT_MS, die aber nie in die Messung eingeht.
   */
  let slowestMs = ASSUMED_FIRST_UNIT_MS

  for (;;) {
    if (job.cancel_requested) {
      await finishJob(supabase, job.id, 'cancelled')
      return { units, finished: true }
    }

    // Die erste Einheit laeuft immer; jede weitere nur, wenn die Restzeit fuer
    // die bisher langsamste reicht.
    if (units > 0) {
      const elapsed = now() - started
      if (elapsed + slowestMs > budgetMs) return { units, finished: false }
    }

    const before = now()
    const outcome = await runUnit(supabase, job)
    const tookMs = now() - before
    // Beim ersten Durchgang die Annahme durch den echten Messwert ERSETZEN,
    // danach das Maximum halten. Ohne das Ersetzen bliebe die 270s-Annahme fuer
    // immer die Untergrenze und nach der ersten Einheit waere immer Schluss.
    slowestMs = units === 0 ? tookMs : Math.max(slowestMs, tookMs)
    units++

    if (outcome.entries.length > 0 || outcome.doneDelta > 0) {
      await appendLog(supabase, job, outcome.entries, outcome.doneDelta)
    }

    if (outcome.overloaded) {
      const attempts = job.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await finishJob(
          supabase, job.id, 'error',
          `Modell dauerhaft überlastet — nach ${MAX_ATTEMPTS} erfolglosen Durchgaengen aufgegeben. `
          + 'Die Begriffe bleiben in der Warteschlange, ein neuer Lauf setzt fort.',
        )
        return { units, finished: true }
      }
      await setAttempts(supabase, job.id, attempts)
      // Tick beenden statt sofort erneut zu versuchen: der naechste Cron
      // kommt in einer Minute, das ist die Wartezeit.
      return { units, finished: false }
    }

    if (job.attempts > 0) await setAttempts(supabase, job.id, 0)

    if (outcome.exhausted) {
      await finishJob(supabase, job.id, 'done')
      return { units, finished: true }
    }
  }
}
