// components/admin/glossary-job-shared.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export type JobKind = 'generate' | 'images' | 'relink' | 'pending'

export interface JobView {
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
  total: number | null
  done_count: number
  log: Array<{ at: string; text: string; ok: boolean }>
  error_message: string | null
  /** Nur bei kind='pending' bedeutsam: traegt postId/confirmedSlugs — damit
   *  ein Aufrufer pruefen kann, ob ein offener Job zu SEINEM Artikel gehoert
   *  (der Unique-Index laesst nur EINEN offenen 'pending'-Job systemweit zu,
   *  s. glossary-approval-panel.tsx). */
  params?: Record<string, unknown>
}

/**
 * Liest den Job-Status, solange ein Lauf offen ist.
 *
 * Der Browser TREIBT NICHTS mehr — er zeigt nur. Dieses Polling darf gedrosselt
 * werden, ohne dass ein Lauf langsamer wird: den treibt der Minutentakt-Cron.
 * Genau das war vorher das Problem, als for(;;)-Schleifen den Fortschritt an
 * einen aktiven Tab banden (drei Laeufe am 2026-08-05, ein vierter — die
 * Begriffs-Freigabe im Editor — folgte hier).
 *
 * Extrahiert aus glossary-crawl-panel.tsx, damit glossary-approval-panel.tsx
 * (kind='pending') dieselbe Logik nutzt statt sie zu kopieren.
 */
export function useJob(kind: JobKind) {
  const [job, setJob] = useState<JobView | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/glossary-jobs?kind=${kind}`, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    setJob(data?.job ?? null)
  }, [kind])

  // Einmaliger Initial-Load beim Mount: so erscheint ein bereits laufender Job
  // mitsamt Protokoll, sobald das Panel geoeffnet wird, ohne dass jemand ihn
  // gerade erst angestossen haben muss.
  useEffect(() => { void load() }, [load])

  // Polling nur, solange ein Lauf offen ist — getrennt vom Initial-Load oben.
  // In einem gemeinsamen Effekt (Abhaengigkeit job?.status) wuerde jeder
  // Statuswechsel (pending -> processing -> done) einen zusaetzlichen,
  // sofortigen Fetch ausloesen, weil der Effekt-Koerper load() unbedingt
  // aufruft, bevor er ueberhaupt prueft, ob noch offen ist.
  useEffect(() => {
    const open = job?.status === 'pending' || job?.status === 'processing'
    if (!open) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [load, job?.status])

  return { job, reload: load }
}

/**
 * Fortschritt und Protokoll eines Jobs. Eine gemeinsame Funktion fuer alle
 * vier Laeufe (Begriffe/Bilder/Verlinkung/Freigabe), statt den Block mehrfach
 * zu wiederholen — die Daten kommen ausschliesslich vom Server (Job-Tabelle)
 * statt aus lokalem log/current-State, damit sie einen Neuladen der Seite
 * ueberleben.
 */
export function JobLog({ job, unit, verb }: { job: JobView | null; unit: string; verb: string }) {
  if (!job) return null
  const open = job.status === 'pending' || job.status === 'processing'
  // 'pending' getrennt von 'processing': solange der Job wartet, hat noch
  // keine Einheit gelaufen — "In Arbeit — 0 von N" waere hier gelogen. Seit
  // dem Serialisierungs-Fix laeuft je Tick maximal ein Lexikonlauf; ein
  // zweiter angestossener Lauf bleibt also fuer die Dauer des ersten in
  // 'pending' stehen.
  const headline = job.status === 'pending'
    ? 'Wartet.'
    : job.status === 'processing'
      ? `In Arbeit — ${job.done_count}${job.total !== null ? ` von ${job.total}` : ''} ${unit}`
      : job.status === 'done'
        ? `Fertig — ${job.done_count} ${unit} ${verb}.`
        : job.status === 'cancelled'
          ? `Abgebrochen nach ${job.done_count} ${unit}.`
          : (job.error_message ?? 'Fehlgeschlagen.')
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className={`mb-2 flex items-center gap-2 font-mono text-xs ${job.status === 'error' ? 'text-destructive' : ''}`}>
        {open && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {headline}
      </div>
      {job.log.length > 0 && (
        <ol className="max-h-56 space-y-1 overflow-y-auto font-mono text-xs">
          {[...job.log].reverse().map((entry, i) => (
            <li key={job.log.length - i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60 tabular-nums">{entry.at}</span>
              <span className={entry.ok ? 'text-foreground' : 'text-destructive'}>
                {entry.ok ? '✓' : '×'} {entry.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
