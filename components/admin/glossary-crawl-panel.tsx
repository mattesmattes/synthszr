'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw, Search, Sparkles, RotateCcw, AlertCircle, Image as ImageIcon } from 'lucide-react'
import { useJob, JobLog, type JobKind } from '@/components/admin/glossary-job-shared'

interface CrawlStatus {
  postsProcessed: number
  postsTotal: number
  candidateCount: number
  selectedCount: number
  /** Ausgewaehlt UND noch nicht erzeugt — die echte offene Arbeit. */
  openCount: number
  generatedCount: number
  missingImages: number
  updatedAt: string | null
  topCandidates: Array<{ name: string; mentions: number; selected: boolean }>
  postsPerExtraction: number
  termsPerGeneration: number
}

/**
 * Rückwärts-Crawl über veröffentlichte Artikel (lib/glossary/crawl.ts).
 *
 * Die UI spiegelt die Trennung der beiden Phasen bewusst als ZWEI Knöpfe:
 * "Artikel lesen" ist billig und dauert Sekunden, "Begriffe erzeugen" kostet pro
 * Begriff 45-90s und echtes Geld. Ein gemeinsamer Knopf würde beides verwischen
 * und unvorhersehbar lange laufen — genau der Defekt, den die entkoppelte
 * lexicon-Phase behoben hat.
 *
 * Kein Auto-Polling der teuren Einzelaktionen (extract/generate/reset/images)
 * — jeder Klick bleibt eine bewusste, kostenpflichtige Handlung. Die drei
 * Dauerlaeufe (generate-all/images/relink) pollen ihren Job-Status derweil
 * automatisch (useJob); das loest selbst keine weiteren teuren Aufrufe aus,
 * es liest nur, was der Minutentakt-Cron bereits erledigt hat.
 */
export function GlossaryCrawlPanel({ onTermsChanged }: { onTermsChanged?: () => void }) {
  const [status, setStatus] = useState<CrawlStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'extract' | 'generate' | 'generate-all' | 'reset' | 'images' | 'relink' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  /** Startdatum der Nachverlinkung. Default heute: der Lauf geht von neu nach
   *  alt, "heute" heisst also "alles". Ein aelteres Datum ueberspringt die
   *  neueren Artikel — nuetzlich, um einen abgebrochenen Lauf gezielt dort
   *  fortzusetzen, wo er stehen geblieben ist. */
  const [relinkFrom, setRelinkFrom] = useState(() => new Date().toISOString().slice(0, 10))
  // Die drei frueher hier im Browser getriebenen Dauerlaeufe sind jetzt
  // Jobs, die der Minutentakt-Cron abarbeitet — jeder Hook pollt nur noch
  // seinen eigenen Status, solange ein Lauf offen ist (siehe useJob oben).
  const termsJob = useJob('generate')
  const imagesJob = useJob('images')
  const relinkJob = useJob('relink')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/glossary-crawl', { credentials: 'include' })
      if (!res.ok) throw new Error(`Status nicht ladbar (HTTP ${res.status})`)
      setStatus(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status nicht ladbar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchStatus() }, [fetchStatus])

  /** Kandidat ab-/zuwählen. Optimistisch: der Klick soll sofort sichtbar sein,
   *  bei 60 Badges wäre ein Rundlauf pro Klick träge. Bei Fehler wird der
   *  Serverstand nachgeladen, damit die Anzeige nicht dauerhaft lügt. */
  async function toggle(name: string, selected: boolean) {
    setStatus((prev) => prev && ({
      ...prev,
      topCandidates: prev.topCandidates.map((c) => (c.name === name ? { ...c, selected } : c)),
      selectedCount: prev.selectedCount + (selected ? 1 : -1),
      // openCount mitführen, sonst zeigt die Kopfzeile nach einem Klick eine
      // andere Zahl als der Knopf darunter. Ein Kandidat, der hier auftaucht,
      // ist per Definition noch nicht erzeugt — ab-/zuwählen verschiebt ihn also
      // eins zu eins zwischen "offen" und "nicht offen".
      openCount: prev.openCount + (selected ? 1 : -1),
    }))
    try {
      const res = await fetch('/api/admin/glossary-crawl?action=toggle', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, selected }),
      })
      if (!res.ok) throw new Error(`Auswahl nicht gespeichert (HTTP ${res.status})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auswahl nicht gespeichert')
      await fetchStatus()
    }
  }

  /**
   * Stoesst den Begriffslauf an. Fruehere Fassung trieb ihn hier in einer
   * for(;;)-Schleife, um maxDuration=300 zu umgehen — der Fortschritt hing
   * damit am aktiven Tab. Gemessen: der Server war bei "Provenienz" um 14:05:51
   * fertig, das UI zeigte den Begriff um 15:25:58, 80 Minuten spaeter.
   *
   * Ab jetzt: ein Klick legt den Job an, der Minutentakt-Cron arbeitet ihn ab.
   * Idempotent — ein zweiter Klick liefert den bereits offenen Lauf zurueck.
   */
  async function startTermsJob() {
    setBusy('generate-all')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'generate' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await termsJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /** Stoesst den Illustrationslauf an. Vorher lief er in Runden im Browser. */
  async function startImagesJob() {
    setBusy('images')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'images' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await imagesJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Stoesst die Nachverlinkung an. `relinkFrom` ist die UNTERE Datumsgrenze
   * ("verlinke Artikel AB diesem Tag") und wandert als params.since in den Job.
   */
  async function startRelinkJob() {
    setBusy('relink')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'relink', from: relinkFrom }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await relinkJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /** Abbruchwunsch; der naechste Cron-Tick wertet ihn aus. */
  async function stopJob(kind: JobKind) {
    await fetch('/api/admin/glossary-jobs', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
  }

  async function run(action: 'extract' | 'generate' | 'reset' | 'images') {
    setBusy(action)
    setError(null)
    setLastResult(null)
    try {
      const res = await fetch(`/api/admin/glossary-crawl?action=${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `Fehlgeschlagen (HTTP ${res.status})`)

      if (action === 'extract') {
        setLastResult(
          `${data.postsRead} Artikel gelesen, ${data.newCandidates} neue Begriffe gefunden` +
          (data.done ? ' — alle Artikel durch.' : ` · noch ${data.postsRemaining} offen`),
        )
      } else if (action === 'generate') {
        const names = (data.generated ?? []).map((g: { name: string }) => g.name)
        setLastResult(
          names.length > 0
            ? `Erzeugt und veröffentlicht: ${names.join(', ')}` +
              (data.failed?.length ? ` · übersprungen: ${data.failed.join(', ')}` : '')
            : 'Keine Begriffe erzeugt' + (data.failed?.length ? ` (übersprungen: ${data.failed.join(', ')})` : ''),
        )
        onTermsChanged?.()
      } else if (action === 'images') {
        setLastResult(
          `${data.done?.length ?? 0} Illustrationen erzeugt` +
          (data.failed?.length ? ` · fehlgeschlagen: ${data.failed.join(', ')}` : '') +
          (data.remaining ? ` · noch ${data.remaining} ohne Bild` : ' — alle Begriffe haben ein Bild.'),
        )
        onTermsChanged?.()
      } else {
        setLastResult('Fortschritt zurückgesetzt. Bestehende Begriffe bleiben erhalten.')
      }
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Lade Crawl-Status...
      </div>
    )
  }

  const pct = status && status.postsTotal > 0
    ? Math.round((status.postsProcessed / status.postsTotal) * 100)
    : 0

  // Ein Lauf gilt als offen, solange der Server ihn noch abarbeitet — das
  // steuert, ob der Knopf oder der Abbrechen-Knopf zu sehen ist. `busy`
  // allein reicht nicht mehr: es ist nur waehrend des POST-Requests gesetzt,
  // der Job selbst laeuft danach unabhaengig vom Tab weiter.
  const termsRunning = termsJob.job?.status === 'pending' || termsJob.job?.status === 'processing'
  const imagesRunning = imagesJob.job?.status === 'pending' || imagesJob.job?.status === 'processing'
  const relinkRunning = relinkJob.job?.status === 'pending' || relinkJob.job?.status === 'processing'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Artikel-Crawl</CardTitle>
          <p className="text-sm text-muted-foreground">
            Liest veröffentlichte Artikel und findet Fachbegriffe, die noch keinen Lexikoneintrag haben.
            Lesen und Erzeugen sind getrennt: Lesen ist schnell und günstig, Erzeugen kostet pro Begriff
            etwa eine Minute und einen Modell-Aufruf.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">
                {status?.postsProcessed ?? 0} von {status?.postsTotal ?? 0} Artikeln gelesen
              </span>
              <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-secondary">
              <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* OFFEN, nicht "ausgewählt": abgewählte Namen bleiben absichtlich in
                der Liste, und bereits erzeugte stehen ebenfalls darin. Die
                Auswahl-Zahl verschwieg dadurch die echte Arbeitsmenge — am
                2026-08-06 stand hier eine zweistellige Zahl, während 301
                Kandidaten offen waren, und ein Lauf über Stunden sah aus wie ein
                Hänger. */}
            <span className="whitespace-nowrap">
              <span className="font-mono font-bold tabular-nums">{status?.openCount ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">
                offen{typeof status?.candidateCount === 'number' ? ` von ${status.candidateCount} gefunden` : ''}
              </span>
            </span>
            <span>
              <span className="font-mono font-bold tabular-nums">{status?.generatedCount ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">bereits erzeugt</span>
            </span>
            <span className="whitespace-nowrap">
              <span className="font-mono font-bold tabular-nums">{status?.missingImages ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">ohne Illustration</span>
            </span>
          </div>

          {/* Fortschritt und Protokoll kommen aus den Jobs, nicht mehr aus
              lokalem State — sie ueberleben damit ein Neuladen der Seite und
              erscheinen von selbst, wenn hier gerade ein Lauf offen ist. */}
          <JobLog job={termsJob.job} unit="Begriffe" verb="erzeugt" />
          <JobLog job={imagesJob.job} unit="Illustrationen" verb="erzeugt" />
          <JobLog job={relinkJob.job} unit="Artikel" verb="verlinkt" />

          <div className="flex flex-wrap gap-2">
            {/* Gesperrt auch waehrend termsRunning: extract/generate/reset UND der
                generate-Job teilen sich denselben ungelockten Crawl-Zustand
                (settings.glossary_crawl_state, Read-Modify-Write ueber die volle
                JSONB). Ein gleichzeitiger Klick wuerde den Job-Fortschritt
                ueberschreiben (lost update) oder an glossary_terms_slug_key
                scheitern, weil beide Seiten denselben Kandidaten fuer offen
                halten. images/relink bleiben aussen vor: images ruehrt diesen
                Zustand ueberhaupt nicht an, relink schreibt nur relinkCursor per
                eigenem Read-unmittelbar-vor-Write (bewusst so gebaut, siehe
                writeRelinkCursor) und ist damit kein Aggressor auf candidates/
                generated/excluded. */}
            <Button
              size="sm"
              onClick={() => run('extract')}
              disabled={busy !== null || termsRunning}
              title={termsRunning ? 'Gesperrt, solange der Begriffslauf läuft — beide teilen sich denselben Crawl-Zustand.' : undefined}
            >
              {busy === 'extract' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Nächste{' '}{status?.postsPerExtraction ?? 10}{' '}Artikel lesen
            </Button>
            {/* NUR NOCH EIN Erzeugen-Knopf. Daneben stand bis zum 2026-08-06 ein
                zweiter ("3 Begriffe erzeugen & veröffentlichen"), der über
                run('generate') den alten Inline-Pfad nahm — drei Begriffe in
                EINEM Request. Der Kommentar dort versprach "in einer Minute
                durch"; tatsaechlich kostet ein Begriff 45-90s, drei liegen also
                am 300s-Limit der Function. Der Request starb als 504 ohne JSON,
                und im Panel sah es aus, als passiere nichts — genau die
                Beobachtung "Prozess hakt". Seit der Umstellung auf das
                Job-Modell ist er ueberfluessig: der Cron arbeitet dieselbe
                Warteschlange ab, ohne Zeitlimit und mit sichtbarem Protokoll,
                und laesst sich jederzeit abbrechen. */}
            {termsRunning ? (
              <Button size="sm" variant="destructive" onClick={() => void stopJob('generate')}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abbrechen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={startTermsJob}
                disabled={busy !== null || (status?.openCount ?? 0) === 0}
                title="Legt einen Job an, den der Minutentakt-Cron abarbeitet. Das Fenster kann geschlossen werden."
              >
                {busy === 'generate-all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Alle{' '}{status?.openCount ?? 0}{' '}offenen erzeugen
              </Button>
            )}
            {imagesRunning ? (
              <Button size="sm" variant="destructive" onClick={() => void stopJob('images')}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abbrechen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={startImagesJob}
                disabled={busy !== null || (status?.missingImages ?? 0) === 0}
                title="Legt einen Job an, den der Minutentakt-Cron abarbeitet. Das Fenster kann geschlossen werden."
              >
                {busy === 'images' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                Alle fehlenden Illustrationen erzeugen
              </Button>
            )}
            {/* Nachverlinkung mit Startdatum. Getrennter Knopf, weil dieser Lauf
                KEINE Modell-Aufrufe macht: er ist schnell und kostenlos, ganz
                anders als die Begriffs- und Bilderzeugung daneben. */}
            {relinkRunning ? (
              <Button size="sm" variant="destructive" onClick={() => void stopJob('relink')}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abbrechen
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="date"
                  value={relinkFrom}
                  onChange={(e) => setRelinkFrom(e.target.value)}
                  disabled={busy !== null}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
                  title="Nur Artikel ab diesem Tag werden nachverlinkt. Heute heißt: nur die heutigen."
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startRelinkJob}
                  disabled={busy !== null}
                  title="Legt einen Job an, den der Minutentakt-Cron abarbeitet. Das Fenster kann geschlossen werden."
                >
                  {busy === 'relink' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Artikel nachverlinken
                </Button>
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => void fetchStatus()} disabled={busy !== null}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Neu laden
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run('reset')}
              disabled={busy !== null || termsRunning}
              title={termsRunning ? 'Gesperrt, solange der Begriffslauf läuft — ein Reset würde die laufende Warteschlange löschen.' : undefined}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Fortschritt zurücksetzen
            </Button>
          </div>

          {busy === 'generate' && (
            <p className="text-xs text-muted-foreground">
              Erzeugen läuft — pro Begriff etwa eine Minute. Fenster offen lassen.
            </p>
          )}
          {lastResult && <p className="text-sm">{lastResult}</p>}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {status && status.topCandidates.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Warteschlange</CardTitle>
            <p className="text-sm text-muted-foreground">
              Nach Fundstellen sortiert — in genau dieser Reihenfolge werden sie erzeugt. Begriffe aus
              mehreren Artikeln zuerst: sie nützen mehr Lesern und verlinken sich später dichter.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {status.topCandidates.map((c) => (
                <li key={c.name}>
                  {/* Klick wählt ab bzw. wieder zu. Abgewählte bleiben sichtbar,
                      nur durchgestrichen und blass — verschwinden wäre schlechter,
                      weil der Operator seine Entscheidung nicht mehr zurücknehmen
                      könnte und der Begriff beim nächsten Crawl wieder auftaucht. */}
                  <button
                    type="button"
                    onClick={() => toggle(c.name, !c.selected)}
                    title={c.selected ? 'Abwählen — wird nicht erzeugt' : 'Wieder auswählen'}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant={c.selected ? 'default' : 'outline'}
                      className={`font-normal ${c.selected ? '' : 'text-muted-foreground line-through opacity-60'}`}
                    >
                      {c.name}
                      <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">{c.mentions}×</span>
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Alle gefundenen Begriffe sind ausgewählt. Klick entfernt einen aus der Warteschlange —
              er bleibt sichtbar und lässt sich wieder zuschalten. Erzeugt werden immer die{' '}
              {status.termsPerGeneration} häufigsten der ausgewählten.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
