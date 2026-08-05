// components/admin/glossary-approval-panel.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { GlossaryCandidate } from '@/lib/glossary/types'

const ORIGIN_LABELS: Record<GlossaryCandidate['origin'], string> = {
  tag: '{lex:}-Tag',
  match: 'Erwähnung im Text',
  new: 'Neu erkannt',
}

interface GlossaryApprovalPanelProps {
  candidates: GlossaryCandidate[]
  value: string[]
  onChange: (slugs: string[]) => void
  /** Fuer den Runden-Lauf. Fehlt er, wird der Knopf nicht angeboten. */
  postId?: string
  /**
   * Zaehler, der nach jedem erfolgreichen Speichern erhoeht wird. Steigt er,
   * startet der Lauf VON SELBST — der Operator soll die Begriffe nicht per Hand
   * nachtriggern muessen. Ein Zaehler statt eines Booleans, weil auch das zweite
   * Speichern einen Lauf ausloesen soll.
   */
  runAfterSave?: number
}

/**
 * Freigabe-Panel für Lexikon-Begriffskandidaten (Task 12): der Editor listet
 * hier `pending_glossary_terms`, bestätigte Slugs gehen beim Speichern als
 * `confirmedGlossarySlugs` mit — die PATCH-Route veröffentlicht die Drafts
 * und verlinkt sie im Artikeltext (Task 11).
 *
 * Vorauswahl bewusst NICHT nur nach `origin`: ein {lex:}-Tag kann auf einen in
 * DIESEM Tick frisch generierten Begriff zeigen (`isNewlyGenerated=true`) —
 * ungeprüfter LLM-Text, den noch kein Mensch gelesen hat. Würde man den allein
 * wegen origin='tag' vorauswählen, ginge er beim nächsten normalen Speichern
 * live, ohne dass ihn je jemand kontrolliert hat. Deshalb ist nur
 * origin='tag' UND isNewlyGenerated=false vorausgewählt; ein frischer
 * Tag-Kandidat bekommt dieselbe offene Checkbox wie ein 'new'-Kandidat und
 * den „neu generiert"-Hinweis, damit sichtbar bleibt, WARUM er nicht wie ein
 * gewöhnlicher Tag vorausgewählt ist.
 */
export function GlossaryApprovalPanel({ candidates, value, onChange, postId, runAfterSave }: GlossaryApprovalPanelProps) {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<Array<{ text: string; ok: boolean; at: string }>>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stopRequested = useRef(false)

  // Wie viele bestaetigte Kandidaten muessen noch erzeugt werden? Nur die kostet
  // der Lauf; bereits vorhandene Begriffe werden beim Speichern nur verlinkt.
  const openCount = candidates.filter((c) => value.includes(c.slug) && c.needsGeneration).length

  if (candidates.length === 0) return null

  function toggle(slug: string, checked: boolean) {
    onChange(checked ? [...value, slug] : value.filter((s) => s !== slug))
  }

  /**
   * Erzeugt ALLE bestaetigten Begriffe, einzeln und in Runden.
   *
   * Der Deckel im Speicherpfad (MAX_GENERATE_PER_SAVE) bleibt richtig: dort ist
   * die Erzeugung eine Zugabe und darf den Artikel nicht ins Zeitlimit ziehen.
   * Hier ist sie die Hauptsache, also laeuft sie mit limit=1 je Aufruf — 45-90s,
   * weit unter maxDuration — und der Browser wiederholt, bis nichts offen ist.
   *
   * Protokoll statt Zaehler, aus demselben Grund wie im Artikel-Crawl: bei 90s je
   * Begriff sieht eine unveraenderte Zahl aus wie ein Absturz.
   */
  async function runAll() {
    if (!postId) return
    setBusy(true)
    setError(null)
    setLog([])
    stopRequested.current = false
    const stamp = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    let done = 0
    try {
      for (;;) {
        const next = candidates.find((c) => value.includes(c.slug) && c.needsGeneration)
        setCurrent(next?.name ?? null)
        const res = await fetch('/api/admin/glossary-pending', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, confirmedSlugs: value, limit: 1 }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(data?.error || (res.status === 504
            ? 'Zeitlimit erreicht (504) — der Begriff war zu langsam.'
            : `Fehlgeschlagen (HTTP ${res.status})`))
        }
        const generated: string[] = data.generated ?? []
        const remaining: number = data.remaining ?? 0
        for (const slug of generated) {
          done++
          const name = candidates.find((c) => c.slug === slug)?.name ?? slug
          setLog((l) => [...l, { text: `${name} — Text erzeugt`, ok: true, at: stamp() }])
        }
        if (generated.length === 0) {
          setLog((l) => [...l, { text: `${next?.name ?? 'Begriff'} — fehlgeschlagen, siehe Server-Log`, ok: false, at: stamp() }])
        }
        if (remaining === 0) break
        if (stopRequested.current) { setLog((l) => [...l, { text: `Abgebrochen, ${remaining} bleiben offen`, ok: false, at: stamp() }]); break }
        // Kein Fortschritt heisst hier: der Server konnte den naechsten Begriff
        // nicht erzeugen UND hat ihn nicht aus der Vormerkliste genommen. Weiter
        // zu laufen wuerde denselben Fehlschlag endlos wiederholen.
        if (generated.length === 0) {
          setError('Kein Fortschritt — abgebrochen. Der Rest bleibt vorgemerkt.')
          break
        }
      }
      setLog((l) => [...l, { text: `Fertig: ${done} Begriffe erzeugt. Zum Verlinken im Artikel jetzt speichern.`, ok: true, at: stamp() }])
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Fehlgeschlagen'} — nach ${done} Begriffen. Der Rest bleibt vorgemerkt.`)
    } finally {
      setCurrent(null)
      setBusy(false)
      stopRequested.current = false
    }
  }

  /**
   * Startet den Lauf nach dem Speichern automatisch.
   *
   * BLOCKIERT NICHTS: die Schleife laeuft asynchron neben der Oberflaeche, der
   * Operator kann sofort weiterschreiben. Die einzige Kopplung ist der
   * Artikeltext, und die ist entschaerft — die Verlinkung am Ende ist idempotent
   * und wird beim naechsten Speichern ohnehin erneut angewandt.
   *
   * Absichtlich ohne runAll in den Dependencies: die Funktion wird bei jedem
   * Render neu erzeugt, sie dort zu fuehren wuerde den Lauf bei jedem Tastendruck
   * neu starten.
   */
  useEffect(() => {
    if (!runAfterSave || !postId || busy) return
    if (openCount === 0) return
    void runAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAfterSave])

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">Lexikon-Begriffe zur Freigabe</h3>
        <p className="text-xs text-muted-foreground">
          Bestätigte Begriffe werden beim Speichern veröffentlicht und im Artikeltext verlinkt.
          Nach dem Speichern laufen die fehlenden Erklärtexte automatisch im Hintergrund
          durch — einzeln, mit Protokoll. Weiterschreiben ist währenddessen möglich; die
          Verlinkung im Artikeltext passiert am Ende des Laufs.
        </p>
      </div>

      {postId && openCount > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Button size="sm" variant="destructive" onClick={() => { stopRequested.current = true }}>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Nach diesem Begriff stoppen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={runAll}
                title="Erzeugt die Erklärtexte einzeln, bis alle bestätigten fertig sind. Rund eine Minute je Begriff — das Fenster muss offen bleiben."
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Alle{' '}{openCount}{' '}jetzt erzeugen
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              rund eine Minute je Begriff · Fenster offen lassen
            </span>
          </div>

          {(current || log.length > 0) && (
            <div className="rounded-md border bg-muted/30 p-2.5">
              {current && (
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-muted-foreground">In Arbeit:</span>
                  <span className="font-medium">{current}</span>
                </div>
              )}
              <ol className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px]">
                {[...log].reverse().map((e, i) => (
                  <li key={log.length - i} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground/60 tabular-nums">{e.at}</span>
                    <span className={e.ok ? '' : 'text-destructive'}>{e.ok ? '✓' : '×'} {e.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        {candidates.map((c) => (
          <div key={c.slug} className="flex items-start gap-3 p-2 bg-muted/50 rounded">
            <Checkbox
              id={`glossary-${c.slug}`}
              checked={value.includes(c.slug)}
              onCheckedChange={(checked) => toggle(c.slug, checked === true)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Label htmlFor={`glossary-${c.slug}`} className="font-medium text-sm cursor-pointer">
                  {c.name}
                </Label>
                <Badge variant="outline" className="text-[10px] px-1.5">
                  {ORIGIN_LABELS[c.origin]}
                </Badge>
                {c.isNewlyGenerated && (
                  <Badge className="text-[10px] px-1.5 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
                    neu generiert · ungeprüft
                  </Badge>
                )}
                {c.needsGeneration && (
                  <Badge variant="secondary" className="text-[10px] px-1.5">
                    Text wird beim Speichern erzeugt
                  </Badge>
                )}
              </div>
              {c.matchedText && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  gefunden als „{c.matchedText}"
                </p>
              )}
              {c.summary && (
                <p className="text-xs text-muted-foreground mt-0.5">{c.summary}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
