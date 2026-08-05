// components/admin/glossary-approval-panel.tsx
'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { useJob, JobLog } from '@/components/admin/glossary-job-shared'
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
  /** Fuer den Lauf. Fehlt er, wird der Knopf nicht angeboten. */
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
 * Die Erzeugung der noch fehlenden Begriffe lief bis 2026-08-05 in einer
 * for(;;)-Schleife im Browser (glossary_jobs-Umbau, s. Modul-Kommentar von
 * app/api/admin/glossary-pending/route.ts): Tab-Wechsel oder Drosselung
 * brachen den Lauf ab, bereits bezahlte Begriffe blieben unveröffentlicht
 * liegen (49 Fälle in Prod). Jetzt legt ein Klick nur noch einen Job an
 * (kind='pending', s. lib/glossary/jobs) — abgearbeitet wird er vom
 * Minutentakt-Cron, unabhängig vom Editor-Tab; das Panel pollt nur noch den
 * Status (useJob, dasselbe Muster wie glossary-crawl-panel.tsx).
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
  const pendingJob = useJob('pending')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Wie viele bestaetigte Kandidaten muessen noch erzeugt werden? Nur die kostet
  // der Lauf; bereits vorhandene Begriffe werden beim Speichern nur verlinkt.
  const openCount = candidates.filter((c) => value.includes(c.slug) && c.needsGeneration).length

  const job = pendingJob.job
  const jobOpen = job?.status === 'pending' || job?.status === 'processing'
  // Der Unique-Index glossary_jobs_one_open_per_kind laesst nur EINEN offenen
  // 'pending'-Job systemweit zu — anders als bei generate/images/relink ist
  // 'pending' aber artikelbezogen (params.postId). Ohne diesen Abgleich wuerde
  // die Anzeige den Fortschritt eines FREMDEN Artikels als den eigenen
  // ausgeben, wenn der Operator zwischen zwei Artikeln mit offenen Kandidaten
  // wechselt.
  const jobIsForThisPost = jobOpen && job?.params?.postId === postId
  const lockedByOtherPost = jobOpen && !jobIsForThisPost

  if (candidates.length === 0) return null

  function toggle(slug: string, checked: boolean) {
    onChange(checked ? [...value, slug] : value.filter((s) => s !== slug))
  }

  /** Legt den Job an — oder liefert den bereits offenen (idempotent, s. createOrGetJob). */
  async function startJob() {
    if (!postId) return
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'pending', postId, confirmedSlugs: value }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await pendingJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setStarting(false)
    }
  }

  /** Abbruchwunsch; der naechste Cron-Tick wertet ihn aus. */
  async function stopJob() {
    await fetch('/api/admin/glossary-jobs', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'pending' }),
    })
    await pendingJob.reload()
  }

  /**
   * Startet den Lauf nach dem Speichern automatisch.
   *
   * BLOCKIERT NICHTS: der Job laeuft serverseitig, der Operator kann sofort
   * weiterschreiben. Die einzige Kopplung ist der Artikeltext, und die ist
   * entschaerft — die Verlinkung am Ende ist idempotent und wird beim
   * naechsten Speichern ohnehin erneut angewandt.
   *
   * Absichtlich ohne startJob in den Dependencies: die Funktion wird bei jedem
   * Render neu erzeugt, sie dort zu fuehren wuerde den Lauf bei jedem Tastendruck
   * neu starten.
   */
  useEffect(() => {
    if (!runAfterSave || !postId || starting) return
    if (openCount === 0) return
    if (lockedByOtherPost) return
    void startJob()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAfterSave])

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">Lexikon-Begriffe zur Freigabe</h3>
        <p className="text-xs text-muted-foreground">
          Bestätigte Begriffe werden beim Speichern veröffentlicht und im Artikeltext verlinkt.
          Die fehlenden Erklärtexte erzeugt danach ein Hintergrund-Job — er läuft serverseitig
          weiter, auch wenn dieses Fenster geschlossen wird, und verlinkt am Ende automatisch.
        </p>
      </div>

      {postId && openCount > 0 && (
        <div className="space-y-2">
          {lockedByOtherPost ? (
            <p className="text-xs text-muted-foreground">
              Ein Begriffslauf für einen anderen Artikel läuft gerade — bitte warten, bis er fertig ist.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {jobOpen ? (
                <Button size="sm" variant="destructive" onClick={() => void stopJob()}>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Abbrechen
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startJob}
                  disabled={starting}
                  title="Legt einen Job an, den der Minutentakt-Cron abarbeitet. Das Fenster kann geschlossen werden."
                >
                  {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Alle{' '}{openCount}{' '}jetzt erzeugen
                </Button>
              )}
            </div>
          )}

          {!lockedByOtherPost && <JobLog job={job ?? null} unit="Begriffe" verb="erzeugt" />}
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
