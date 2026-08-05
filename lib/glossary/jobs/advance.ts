/**
 * Vorrueck-Logik der servergetriebenen Lexikonlaeufe (Task 4). Ein Minutentick
 * ruft advanceJob genau einmal auf; die Funktion arbeitet Einheiten ab, bis das
 * Zeitbudget aufgebraucht oder nichts mehr offen ist.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateCandidates, generateMissingIllustrations, relinkNextBatch } from '@/lib/glossary/crawl'
import { runPendingUnit } from '@/lib/glossary/pending-run'
import { appendLog, finishJob, releaseLease, setAttempts, type GlossaryJob, type GlossaryJobLogEntry } from '@/lib/glossary/jobs/service'

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

/**
 * Erfolglose Ticks in Folge, ab denen der Job aufgibt. Exportiert, weil die
 * Cron-Route (Befund N2 des Abschluss-Reviews) denselben Zaehler auch fuer
 * Exceptions braucht, die advanceJob VERLAESST — sonst zaehlt nur die
 * Ueberlast INNERHALB dieser Funktion, ein geplatzter Tick (z. B.
 * relinkNextBatch ohne ladbare Begriffsliste) wuerde nie eskalieren.
 */
export const MAX_ATTEMPTS = 10

/**
 * Exportiert, damit die Cron-Route (Befund N2) fuer ihre eigene Fehler-
 * Protokollzeile denselben Zeitstempel-Stil verwendet.
 *
 * `timeZone: 'Europe/Berlin'` ist Pflicht (Befund N3): ohne sie liest die
 * Funktion die Serverzeit — auf Vercel UTC. Vorher liefen diese Zeitstempel
 * im Browser des Betreibers, also in Berliner Zeit; ohne die explizite Zone
 * verschiebt der Umbau die Bedeutung der Protokollspalte um zwei Stunden,
 * still. Genau dieses Protokoll belegt in der Design-Spec die 80-Minuten-
 * Luecke gegen glossary_terms.updated_at — der Vergleich waere beim naechsten
 * Mal falsch.
 */
export function stamp(): string {
  return new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin',
  })
}

interface UnitOutcome {
  entries: GlossaryJobLogEntry[]
  /** Etwas erledigt — der Zaehler steigt um diesen Wert. */
  doneDelta: number
  /** Nichts mehr offen: der Job ist fertig. */
  exhausted: boolean
  /**
   * Nur voruebergehend gescheitert: die Einheit hat NICHTS erreicht, obwohl
   * noch Arbeit offen ist (Modell-Ueberlast bei generate; bei images/relink
   * mangels retryable-Signal als "keine Fortschritt" erkannt, s. runUnit).
   */
  overloaded: boolean
  /**
   * Nicht behebbarer Fehler: der Job wird SOFORT als 'error' beendet, ohne
   * die 10-Versuche-Eskalation von `overloaded` zu durchlaufen — ein Retry
   * wuerde denselben deterministischen Fehlschlag nur verzoegert wiederholen.
   * Bisher nur von 'pending' gesetzt: die Abschluss-Veroeffentlichung hat
   * nicht ALLE bestaetigten Slugs veroeffentlicht (Review-Fund, s. runUnit).
   */
  fatal?: string
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
    // IllustrationResult hat kein retryable-Signal wie generate — "ueberlastet"
    // heisst hier deshalb: der Batch hat NICHTS erreicht (kein einziges Bild),
    // obwohl noch etwas offen ist. Ohne dieses Signal wiederholt der Aufrufer
    // denselben deterministischen Batch (order('slug'), crawl.ts) sofort erneut
    // im selben Tick — bei einem dauerhaft scheiternden Begriff bis das ganze
    // Zeitbudget verbraucht ist, Tick fuer Tick, ohne je zu eskalieren.
    const noProgress = r.done.length === 0 && r.failed.length > 0 && r.remaining > 0
    return {
      entries: [
        ...r.done.map((s) => ({ at: stamp(), text: `${s} — Illustration erzeugt`, ok: true })),
        ...r.failed.map((s) => ({ at: stamp(), text: `${s} — Illustration fehlgeschlagen`, ok: false })),
      ],
      doneDelta: r.done.length,
      exhausted: r.remaining === 0,
      overloaded: noProgress,
    }
  }

  if (job.kind === 'pending') {
    const postId = job.params.postId as string | undefined
    const confirmedSlugs = (job.params.confirmedSlugs as string[] | undefined) ?? []
    if (!postId) {
      // Sollte die Admin-Route (POST-Validierung) schon abgefangen haben —
      // hart scheitern statt still nichts zu tun, damit ein Programmierfehler
      // nicht als Endlos-Idle im Cron-Log verschwindet.
      throw new Error('pending-Job ohne postId in params')
    }
    const r = await runPendingUnit(supabase, postId, confirmedSlugs)
    const entries: GlossaryJobLogEntry[] = [
      ...r.generated.map((n) => ({ at: stamp(), text: `${n} — erzeugt`, ok: true })),
      ...r.failed.map((n) => ({ at: stamp(), text: `${n} — fehlgeschlagen, siehe Server-Log`, ok: false })),
    ]
    // Verlinkung/Veroeffentlichung passiert erst bei remaining===0 (die
    // Injektion laeuft ueber den ganzen Artikeltext, s. pending-run.ts) — eine
    // eigene Zeile dafuer, sonst waere dieser fuer den Operator wichtigste
    // Schritt im Protokoll unsichtbar. Wortlaut ohne "und verlinkt"
    // (Review-Fund, Kosmetik): applyGlossaryConfirmation kann die
    // Text-Injektion uebersprungen haben (Parse-Fehler, terms===null), die
    // Zusage waere dann nicht garantiert.
    if (r.remaining === 0 && r.linked > 0) {
      entries.push({ at: stamp(), text: `${r.linked} Begriffe veröffentlicht`, ok: true })
    }
    // Review-Fund: nicht ALLE bestaetigten Slugs wurden beim Abschluss
    // veroeffentlicht (transienter Lesefehler im Status-Check, fehlgeschlagenes
    // Publish-Update, oder ein Slug ist inzwischen hidden/geloescht). Ohne
    // dieses Signal haette der Job faelschlich 'done' gemeldet — ein
    // persistenter gruener Endzustand, den niemand anzweifelt, obwohl
    // Kandidaten nie sichtbar wurden.
    if (r.publishFailed && r.publishFailed.length > 0) {
      entries.push({
        at: stamp(),
        text: `${r.publishFailed.length} Begriffe konnten nicht veröffentlicht werden, bleiben als Entwurf liegen`,
        ok: false,
      })
    }
    const fatal = r.publishFailed && r.publishFailed.length > 0
      ? `Veröffentlichung unvollständig — ${r.publishFailed.join(', ')} blieben Entwurf. `
        + 'Die Vormerkliste bleibt erhalten, ein neuer Lauf kann sie erneut versuchen.'
      : undefined
    // Gleiche Begruendung wie bei images/relink: "nichts erzeugt, aber noch
    // offen" heisst hier ein gescheiterter Erzeugungsversuch (Modell-Fehler
    // oder -Ueberlast) — ohne diese Erkennung wuerde der Tick denselben
    // Kandidaten wiederholt versuchen, bis das ganze Budget verbraucht ist.
    const noProgress = r.generated.length === 0 && r.remaining > 0
    return {
      entries,
      doneDelta: r.generated.length,
      exhausted: r.remaining === 0 && !fatal,
      overloaded: noProgress,
      fatal,
    }
  }

  const since = (job.params.since as string | undefined) ?? null
  const r = await relinkNextBatch(supabase, { since })
  // Gleiche Begruendung wie bei images: BackfillResult hat kein retryable-Feld,
  // "ueberlastet" heisst hier "der Durchgang hat weder etwas verlinkt noch als
  // unveraendert geprueft, obwohl noch Artikel offen sind".
  const noProgress = r.linked.length === 0 && r.unchanged === 0 && r.remaining > 0
  return {
    entries: [
      ...r.linked.map((s) => ({ at: stamp(), text: `${s} — neu verlinkt`, ok: true })),
      { at: stamp(), text: `${r.unchanged} Artikel unveraendert, ${r.remaining} offen`, ok: true },
    ],
    doneDelta: r.linked.length,
    exhausted: r.remaining === 0,
    overloaded: noProgress,
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
      if (elapsed + slowestMs > budgetMs) {
        // Lease freigeben: die letzte Einheit ist abgeschlossen und persistiert,
        // der naechste Minutentick darf den Job sofort wieder aufnehmen (s.
        // releaseLease-Doku in service.ts — ohne das waeren es sechs Minuten
        // statt einer).
        await releaseLease(supabase, job.id)
        return { units, finished: false }
      }
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

    if (outcome.fatal) {
      // Sofort und endgueltig 'error' — anders als bei outcome.overloaded KEIN
      // Retry-Pfad: der Fehler ist deterministisch (ein Slug ist z. B. hidden),
      // ein weiterer Versuch wuerde denselben Fehlschlag nur verzoegert
      // wiederholen. Kein releaseLease noetig, der Job ist final (wie beim
      // cancelled- und beim Ueberlast-Eskalations-Pfad unten).
      await finishJob(supabase, job.id, 'error', outcome.fatal)
      return { units, finished: true }
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
      // Lokale Kopie mitfuehren wie bei appendLog (job.log/done_count oben) —
      // die Cron-Route liest job.attempts nach einer spaeteren Exception
      // weiter (Befund N2) und braucht den aktuellen Stand, nicht den von vor
      // diesem Tick.
      job.attempts = attempts
      // Tick beenden statt sofort erneut zu versuchen: der naechste Cron
      // kommt in einer Minute. Das stimmt nur, WEIL das Lease jetzt freigegeben
      // wird — sonst haette last_advanced_at (gerade erst von appendLog
      // gestempelt) den Job fuer LEASE_STALE_MS (6 Minuten) fuer getNextOpenJob
      // gesperrt.
      await releaseLease(supabase, job.id)
      return { units, finished: false }
    }

    if (job.attempts > 0) {
      await setAttempts(supabase, job.id, 0)
      job.attempts = 0
    }

    if (outcome.exhausted) {
      await finishJob(supabase, job.id, 'done')
      return { units, finished: true }
    }
  }
}
