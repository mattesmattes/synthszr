// components/admin/glossary-job-shared.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type JobKind = 'generate' | 'images' | 'relink' | 'pending' | 'translations' | 'term-translations' | 'extract'

export interface JobView {
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
  total: number | null
  done_count: number
  log: Array<{ at: string; text: string; ok: boolean }>
  error_message: string | null
}

/**
 * Ein Lauf ist offen, wenn er noch nicht abgeschlossen ist. Eine Stelle fuer
 * diese Definition statt vier Kopien im Panel: die Statuswerte kommen aus dem
 * CHECK-Constraint der Tabelle, und eine spaeter ergaenzte Art wuerde sonst an
 * einer der Kopien vergessen.
 */
export function isJobOpen(job: JobView | null | undefined): boolean {
  return job?.status === 'pending' || job?.status === 'processing'
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
 *
 * `postId` ist bei kind='pending' PFLICHT (Review-Fund, artikelweiser
 * Unique-Index): ohne ihn koennte die Route den Job eines FREMDEN Artikels
 * liefern. Fuer generate/images/relink bleibt er weg, dort ist der Lauf
 * global.
 */
export function useJob(kind: JobKind, postId?: string, onFinished?: () => void) {
  const [job, setJob] = useState<JobView | null>(null)

  const load = useCallback(async () => {
    const url = postId
      ? `/api/admin/glossary-jobs?kind=${kind}&postId=${encodeURIComponent(postId)}`
      : `/api/admin/glossary-jobs?kind=${kind}`
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    setJob(data?.job ?? null)
  }, [kind, postId])

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
    if (!isJobOpen(job)) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [load, job?.status])

  // Meldet EINMAL, wenn ein offener Lauf endet. Ohne das bleibt die Umgebung
  // (Begriffsliste, Zaehler) auf dem Stand des Seitenaufrufs stehen, bis jemand
  // neu laedt — der Lauf ist fertig, aber das Panel zeigt weiter die alte Welt.
  // Der Vergleich laeuft ueber eine ref statt ueber den Status allein: ein
  // Job, der schon abgeschlossen war, als das Panel geoeffnet wurde, darf den
  // Callback nicht feuern.
  const wasOpen = useRef(false)
  useEffect(() => {
    const open = isJobOpen(job)
    if (wasOpen.current && !open) onFinished?.()
    wasOpen.current = open
  }, [job?.status, onFinished, job])

  return { job, reload: load }
}

/**
 * Abbrechen-Knopf eines offenen Laufs — mit dem NAMEN des Laufs und seinem
 * Fortschritt auf dem Knopf.
 *
 * Vorher stand an allen sechs Stellen nur "Abbrechen". Bei mehreren gleichzeitig
 * offenen Laeufen war damit nicht erkennbar, WELCHER noch laeuft: der Knopf sass
 * in der Leiste oben, sein Protokollblock aber weit unten (die Leiste wurde
 * bewusst nach oben gezogen, s. glossary-crawl-panel). Ein aktiver Lauf sah
 * dadurch wie ein Haenger aus — beobachtet am 2026-08-06, als
 * term-translations mit 43 von 133 arbeitete, waehrend im sichtbaren
 * Protokollblock darueber "Fertig — 249 Begriffe erzeugt." des generate-Laufs
 * stand. Der Fortschritt gehoert deshalb an den Knopf, nicht nur ins Protokoll.
 */
export function JobCancelButton({
  job,
  label,
  onCancel,
}: {
  job: JobView | null
  label: string
  onCancel: () => void
}) {
  // total ist bei relink NULL (die Zahl der zu pruefenden Artikel haengt am
  // Cursor und steht nicht vorab fest) — dann nur den Zaehler zeigen, sonst
  // stuende dort "5/null".
  const progress = !job
    ? ''
    : job.total !== null
      ? ` (${job.done_count}/${job.total})`
      : ` (${job.done_count})`
  return (
    <Button size="sm" variant="destructive" onClick={onCancel}>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label} abbrechen{progress}
    </Button>
  )
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
  const open = isJobOpen(job)
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
