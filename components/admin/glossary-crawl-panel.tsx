'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw, Search, Sparkles, RotateCcw, AlertCircle, Image as ImageIcon } from 'lucide-react'

interface CrawlStatus {
  postsProcessed: number
  postsTotal: number
  candidateCount: number
  selectedCount: number
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
 * Kein Auto-Polling: jeder Klick ist eine bewusste, kostenpflichtige Handlung.
 */
export function GlossaryCrawlPanel({ onTermsChanged }: { onTermsChanged?: () => void }) {
  const [status, setStatus] = useState<CrawlStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'extract' | 'generate' | 'generate-all' | 'reset' | 'images' | 'relink' | null>(null)
  /** Abbruchwunsch fuer die Dauerlaeufe. REF, nicht State: die laufende
   *  Schleife sieht einen State-Wert aus ihrer Closure heraus nie aktualisiert. */
  const stopRequested = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  /** Laufendes Protokoll des Batchs — ein Eintrag je Begriff, damit sichtbar
   *  ist, dass etwas passiert. Ein Zaehler allein reicht nicht: bei 90s je
   *  Begriff sieht eine unveraenderte Zahl wie ein Absturz aus. */
  const [log, setLog] = useState<Array<{ text: string; ok: boolean; at: string }>>([])
  const [current, setCurrent] = useState<string | null>(null)
  /** Startdatum der Nachverlinkung. Default heute: der Lauf geht von neu nach
   *  alt, "heute" heisst also "alles". Ein aelteres Datum ueberspringt die
   *  neueren Artikel — nuetzlich, um einen abgebrochenen Lauf gezielt dort
   *  fortzusetzen, wo er stehen geblieben ist. */
  const [relinkFrom, setRelinkFrom] = useState(() => new Date().toISOString().slice(0, 10))

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
   * Erzeugt ALLE fehlenden Illustrationen — ruft die Route so lange auf, bis
   * keine mehr offen ist.
   *
   * Der Deckel bleibt serverseitig (IMAGES_PER_RUN): gpt-image-2 braucht 10-25s
   * je Bild, 17 Bilder in EINEM Request würden das 300s-Limit reißen. Getrieben
   * wird die Schleife deshalb hier im Browser — dasselbe Muster, mit dem
   * create-article den resumable Artikel-Job vorantreibt.
   *
   * Abbruch, wenn eine Runde NICHTS mehr schafft (weder erzeugt noch
   * fehlgeschlagen): sonst liefe die Schleife bei einem dauerhaften Fehler
   * endlos und würde bei jedem Durchgang Geld verbrennen.
   */
  async function runAllImages() {
    setBusy('images')
    setError(null)
    setLastResult(null)
    let totalDone = 0
    const totalFailed: string[] = []
    try {
      for (let round = 1; ; round++) {
        const res = await fetch('/api/admin/glossary-crawl?action=images', {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || `Fehlgeschlagen (HTTP ${res.status})`)

        const done: string[] = data.done ?? []
        const failed: string[] = data.failed ?? []
        totalDone += done.length
        totalFailed.push(...failed)
        setLastResult(
          `${totalDone} Illustrationen erzeugt` +
          (data.remaining ? ` · noch ${data.remaining} offen …` : '') +
          (totalFailed.length ? ` · fehlgeschlagen: ${totalFailed.join(', ')}` : ''),
        )
        if (!data.remaining) break
        if (stopRequested.current) { setLastResult((p) => `${p ?? ''} · abgebrochen`); break }
        // Abbruch, sobald eine Runde NICHTS GESCHAFFT hat — nicht erst, wenn sie
        // auch keine Fehler meldet. Gescheiterte Einträge bleiben in `remaining`
        // und würden erneut versucht: die Schleife liefe endlos und würde bei
        // jedem Durchgang Geld verbrennen. (Fiel zunächst nicht auf, weil im
        // ersten Lauf alle Bilder gelangen.)
        if (done.length === 0) {
          setError(failed.length > 0
            ? `Kein Fortschritt — ${failed.length} Fehlschlag/Fehlschläge in Folge, abgebrochen.`
            : 'Kein Fortschritt mehr — abgebrochen, damit keine Endlosschleife entsteht.')
          break
        }
      }
      onTermsChanged?.()
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Erzeugt ALLE ausgewaehlten Begriffe — EINZELN, mit sichtbarem Protokoll.
   *
   * WARUM EINZELN (2026-08-05, nach einem Abbruch in Prod): die Route hat
   * maxDuration=300. Drei Begriffe brauchen 135-270s plus Uebersetzung und
   * Produktzuordnung; einer mit Nachforderung nach Regel 4 reisst das Limit. Der
   * Request stirbt dann als 504 OHNE JSON-Koerper — von aussen ununterscheidbar
   * von "es passiert einfach nichts mehr". Mit limit=1 bleibt jeder Aufruf bei
   * 45-90s, weit unter dem Limit.
   *
   * WARUM EIN PROTOKOLL: ein Zaehler allein reicht nicht. Bei 90s je Begriff
   * steht eine unveraenderte Zahl minutenlang still und sieht aus wie ein
   * Absturz — gerade bei einem Lauf ueber Nacht muss nachvollziehbar sein, WAS
   * wann fertig wurde und woran es ggf. haengt.
   *
   * Das Fenster muss offen bleiben; getrieben wird im Browser, wie beim
   * resumable Artikel-Job in create-article.
   */
  async function runAllTerms() {
    setBusy('generate-all')
    setError(null)
    setLastResult(null)
    setLog([])
    stopRequested.current = false
    const stamp = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    let done = 0

    try {
      for (;;) {
        // Naechsten Namen VOR dem Request anzeigen: die Route arbeitet die
        // Warteschlange in genau dieser Reihenfolge ab (nach Fundstellen
        // sortiert), also ist der erste offene Kandidat der, der jetzt drankommt.
        setCurrent(nextCandidateName())

        const res = await fetch('/api/admin/glossary-crawl?action=generate&limit=1', {
          method: 'POST',
          credentials: 'include',
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          // 504 kommt ohne JSON — den Fall ausdruecklich benennen, statt eine
          // nichtssagende Nummer zu zeigen.
          throw new Error(
            data?.error ||
            (res.status === 504
              ? 'Zeitlimit der Funktion erreicht (504). Der Begriff war zu langsam.'
              : `Fehlgeschlagen (HTTP ${res.status})`),
          )
        }

        const generated: Array<{ name: string }> = data.generated ?? []
        const failed: string[] = data.failed ?? []
        const existing: string[] = data.alreadyExisting ?? []
        const remaining: number = data.remainingCandidates ?? 0

        for (const g of generated) {
          done++
          setLog((l) => [...l, { text: `${g.name} — erzeugt und veroeffentlicht`, ok: true, at: stamp() }])
        }
        // Getrennt von den Fehlschlaegen: "gibt es schon" ist Aufraeumen, kein
        // Problem. Zusammengefasst statt einzeln — bei 40 Altlasten waere jede
        // eigene Zeile nur Rauschen im Protokoll.
        if (existing.length > 0) {
          setLog((l) => [...l, {
            text: existing.length === 1
              ? `${existing[0]} — gab es schon, aus der Liste genommen`
              : `${existing.length} Kandidaten gab es schon, aus der Liste genommen`,
            ok: true, at: stamp(),
          }])
        }
        for (const f of failed) {
          setLog((l) => [...l, { text: `${f} — fehlgeschlagen, siehe Server-Log`, ok: false, at: stamp() }])
        }
        setLastResult(`${done} erzeugt · noch ${remaining} offen`)
        onTermsChanged?.()
        await fetchStatus()

        if (remaining === 0) { setLastResult(`Fertig — ${done} Begriffe erzeugt.`); break }
        if (stopRequested.current) { setLastResult(`Abgebrochen nach ${done} Begriffen · ${remaining} bleiben offen.`); break }
        // Weder erzeugt noch uebersprungen heisst: die Warteschlange bewegt sich
        // nicht mehr. Gescheiterte Begriffe werden serverseitig als erledigt
        // markiert, ein Fehlschlag allein ist also KEIN Grund aufzuhoeren.
        if (generated.length === 0 && failed.length === 0 && existing.length === 0) {
          setError('Kein Fortschritt mehr — abgebrochen, damit keine Endlosschleife entsteht.')
          break
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fehlgeschlagen'
      setError(`${msg} — nach ${done} erzeugten Begriffen. Der Fortschritt ist gespeichert, der Knopf setzt hier fort.`)
      setLog((l) => [...l, { text: msg, ok: false, at: stamp() }])
    } finally {
      setCurrent(null)
      setBusy(null)
      stopRequested.current = false
      await fetchStatus()
    }
  }

  /** Der Kandidat, der als naechstes drankommt: erster ausgewaehlter in der
   *  nach Fundstellen sortierten Liste. Nur fuer die Anzeige. */
  function nextCandidateName(): string | null {
    return status?.topCandidates.find((c) => c.selected)?.name ?? null
  }

  /**
   * Verlinkt bestehende Artikel gegen den GANZEN Begriffsbestand, in Runden.
   *
   * WARUM ES DAS BRAUCHT: die Injektion beim Speichern greift nur fuer Begriffe,
   * die in DIESEM Moment als bestaetigter Kandidat vorlagen. Altposts haben nie
   * eine Kandidatenliste gesehen, und ein spaeter entstandener Begriff erreicht
   * keinen aelteren Artikel mehr — an Prod gemessen hatten null von 219 Posts
   * Marks. Dieser Lauf schliesst die Luecke.
   *
   * Keine Modell-Aufrufe, also schnell und ohne Kosten; der Deckel
   * (POSTS_PER_BACKFILL) haelt nur den Request klein.
   */
  async function runRelink() {
    setBusy('relink')
    setError(null)
    setLog([])
    stopRequested.current = false
    const stamp = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    let totalLinked = 0
    let totalChecked = 0
    try {
      // Nur die ERSTE Runde nimmt das Datum; danach fuehrt der serverseitige
      // Cursor weiter, sonst begaenne jede Runde wieder beim Startdatum.
      let first = true
      for (;;) {
        const url = first
          ? `/api/admin/glossary-crawl?action=relink&from=${relinkFrom}`
          : '/api/admin/glossary-crawl?action=relink'
        first = false
        const res = await fetch(url, { method: 'POST', credentials: 'include' })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || `Fehlgeschlagen (HTTP ${res.status})`)

        const linked: string[] = data.linked ?? []
        const unchanged: number = data.unchanged ?? 0
        const remaining: number = data.remaining ?? 0
        totalLinked += linked.length
        totalChecked += linked.length + unchanged

        for (const slug of linked) {
          setLog((l) => [...l, { text: `${slug} — Begriffe verlinkt`, ok: true, at: stamp() }])
        }
        setLastResult(`${totalLinked} Artikel verlinkt · ${totalChecked} geprueft · noch ${remaining} offen`)

        if (remaining === 0) {
          setLastResult(`Fertig: ${totalLinked} von ${totalChecked} geprueften Artikeln verlinkt.`)
          break
        }
        if (stopRequested.current) {
          setLastResult(`Abgebrochen · ${totalLinked} verlinkt · ${remaining} bleiben offen (Cursor gespeichert).`)
          break
        }
        // Ein Lauf ohne einen einzigen geprueften Artikel bewegt den Cursor
        // nicht — weiterzulaufen waere eine Endlosschleife.
        if (linked.length === 0 && unchanged === 0) {
          setError('Kein Fortschritt mehr — abgebrochen.')
          break
        }
      }
      onTermsChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
      stopRequested.current = false
    }
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
            <span className="whitespace-nowrap">
              <span className="font-mono font-bold tabular-nums">{status?.selectedCount ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">von {status?.candidateCount ?? 0} ausgewählt</span>
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

          {(current || log.length > 0) && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              {current && (
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-muted-foreground">In Arbeit:</span>
                  <span className="font-medium">{current}</span>
                </div>
              )}
              {/* Neueste zuerst und scrollbar: bei 177 Begriffen soll der Kasten
                  nicht die Seite sprengen, und interessant ist das Ende. */}
              <ol className="max-h-56 space-y-1 overflow-y-auto font-mono text-xs">
                {[...log].reverse().map((entry, i) => (
                  <li key={log.length - i} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground/60 tabular-nums">{entry.at}</span>
                    <span className={entry.ok ? 'text-foreground' : 'text-destructive'}>
                      {entry.ok ? '✓' : '×'} {entry.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run('extract')} disabled={busy !== null}>
              {busy === 'extract' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Nächste{' '}{status?.postsPerExtraction ?? 10}{' '}Artikel lesen
            </Button>
            {/* ZWEI Knoepfe fuer dieselbe Aktion, mit Absicht: der erste erzeugt
                eine Handvoll und ist in einer Minute durch, der zweite laeuft bei
                177 Kandidaten Stunden und kostet entsprechend. Beides hinter
                einem Knopf zu verstecken hiesse, einen dreistuendigen Lauf
                versehentlich auszuloesen. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => run('generate')}
              disabled={busy !== null || (status?.selectedCount ?? 0) === 0}
            >
              {busy === 'generate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {status?.termsPerGeneration ?? 3}{' '}Begriffe erzeugen &amp; veröffentlichen
            </Button>
            {busy === 'generate-all' ? (
              <Button size="sm" variant="destructive" onClick={() => { stopRequested.current = true }}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Nach dieser Runde stoppen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={runAllTerms}
                disabled={busy !== null || (status?.selectedCount ?? 0) === 0}
                title="Läuft in Runden, bis alle ausgewählten Begriffe erzeugt sind. Das Fenster muss offen bleiben."
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Alle{' '}{status?.selectedCount ?? 0}{' '}einzeln erzeugen
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={runAllImages}
              disabled={busy !== null || (status?.missingImages ?? 0) === 0}
            >
              {busy === 'images' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
              Alle fehlenden Illustrationen erzeugen
            </Button>
            {/* Nachverlinkung mit Startdatum. Getrennter Knopf, weil dieser Lauf
                KEINE Modell-Aufrufe macht: er ist schnell und kostenlos, ganz
                anders als die Begriffs- und Bilderzeugung daneben. */}
            {busy === 'relink' ? (
              <Button size="sm" variant="destructive" onClick={() => { stopRequested.current = true }}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Nach dieser Runde stoppen
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="date"
                  value={relinkFrom}
                  onChange={(e) => setRelinkFrom(e.target.value)}
                  disabled={busy !== null}
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
                  title="Startdatum — der Lauf geht von diesem Tag rückwärts. Heute heißt: alle Artikel."
                />
                <Button size="sm" variant="outline" onClick={runRelink} disabled={busy !== null}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Artikel nachverlinken
                </Button>
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => void fetchStatus()} disabled={busy !== null}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Neu laden
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('reset')} disabled={busy !== null}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Fortschritt zurücksetzen
            </Button>
          </div>

          {busy === 'generate' && (
            <p className="text-xs text-muted-foreground">
              Erzeugen läuft — pro Begriff etwa eine Minute. Fenster offen lassen.
            </p>
          )}
          {busy === 'images' && (
            <p className="text-xs text-muted-foreground">
              Bildgenerierung läuft in Runden, bis keine Illustration mehr fehlt — je Bild
              10-25 Sekunden. Fenster offen lassen, der Fortschritt steht unten.
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
