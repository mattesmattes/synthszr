'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Trash2, RefreshCw, Eye, EyeOff, BookOpen, Languages, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// --- Types ---

type GlossaryStatus = 'draft' | 'published' | 'hidden'
type GlossaryReviewState = 'ok' | 'flagged' | 'revision_pending'

interface GlossaryTermRow {
  id: string
  slug: string
  canonical_name: string
  status: GlossaryStatus
  review_state: GlossaryReviewState
  last_reviewed_at: string | null
}

interface GlossaryTermDetail extends GlossaryTermRow {
  summary: string
  body: unknown
  pending_body: unknown
  illustration_url: string | null
}

type PatchAction = 'accept_revision' | 'discard_revision' | 'hide' | 'publish' | 'translate'

// --- Diff-Helfer ---
//
// Kein Diff-Package im Projekt (package.json geprüft) — für einen
// Lexikoneintrag (400–700 Wörter, Design-Spec §D) ist ein einfacher
// wortweiser LCS-Diff schnell genug und braucht keine Abhängigkeit.

interface DiffToken {
  text: string
  kind: 'same' | 'added' | 'removed'
}

/** Klartext aus einem TipTap-Dokument (nur Absatz-/Überschriften-Text, keine
 *  Marks) — bewusst eine schmale lokale Kopie statt eines Imports aus
 *  lib/glossary/generate.ts: dieses Modul ist serverseitig für LLM-Prompts
 *  gedacht (großer CALIBRATION_EXAMPLES-String) und gehört nicht in den
 *  Client-Bundle dieser Admin-Seite. */
function tiptapPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const content = (doc as { content?: unknown[] }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((node) => {
      const n = node as { content?: Array<{ text?: string }> }
      return (n.content ?? []).map((t) => t.text ?? '').join('')
    })
    .join('\n\n')
}

/** Wortweiser LCS-Diff (klassisches DP), O(n·m) über Wort-Tokens inkl.
 *  Whitespace-Tokens (damit Zeilenumbrüche erhalten bleiben). */
function wordDiff(oldText: string, newText: string): DiffToken[] {
  const oldWords = oldText.split(/(\s+)/)
  const newWords = newText.split(/(\s+)/)
  const n = oldWords.length
  const m = newWords.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldWords[i] === newWords[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const tokens: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldWords[i] === newWords[j]) {
      tokens.push({ text: oldWords[i], kind: 'same' })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ text: oldWords[i], kind: 'removed' })
      i++
    } else {
      tokens.push({ text: newWords[j], kind: 'added' })
      j++
    }
  }
  while (i < n) { tokens.push({ text: oldWords[i], kind: 'removed' }); i++ }
  while (j < m) { tokens.push({ text: newWords[j], kind: 'added' }); j++ }
  return tokens
}

function RevisionDiff({ body, pendingBody }: { body: unknown; pendingBody: unknown }) {
  const tokens = wordDiff(tiptapPlainText(body), tiptapPlainText(pendingBody))
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
      {tokens.map((t, idx) => {
        if (t.kind === 'same') return <span key={idx}>{t.text}</span>
        if (t.kind === 'removed') {
          return (
            <span key={idx} className="bg-red-100 text-red-700 line-through dark:bg-red-950 dark:text-red-300">
              {t.text}
            </span>
          )
        }
        return (
          <span key={idx} className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
            {t.text}
          </span>
        )
      })}
    </div>
  )
}

// --- Badges ---

const STATUS_LABELS: Record<GlossaryStatus, string> = {
  draft: 'Entwurf',
  published: 'Veröffentlicht',
  hidden: 'Verborgen',
}

function StatusBadge({ status }: { status: GlossaryStatus }) {
  const cls = status === 'published'
    ? 'text-green-700 border-green-300 dark:text-green-400'
    : status === 'hidden'
      ? 'text-muted-foreground'
      : 'text-blue-700 border-blue-300 dark:text-blue-400'
  return <Badge variant="outline" className={cls}>{STATUS_LABELS[status]}</Badge>
}

const REVIEW_LABELS: Record<GlossaryReviewState, string> = {
  ok: 'Aktuell',
  flagged: 'Markiert',
  revision_pending: 'Revision offen',
}

function ReviewBadge({ state }: { state: GlossaryReviewState }) {
  if (state === 'revision_pending') return <Badge variant="destructive">{REVIEW_LABELS[state]}</Badge>
  if (state === 'flagged') return <Badge className="bg-yellow-500 text-white hover:bg-yellow-500">{REVIEW_LABELS[state]}</Badge>
  return <Badge variant="secondary">{REVIEW_LABELS[state]}</Badge>
}

function formatDate(iso: string | null): string {
  if (!iso) return 'noch nie geprüft'
  return new Date(iso).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Revisions offen zuerst (Task-17-Anforderung), danach alphabetisch.
const REVIEW_ORDER: Record<GlossaryReviewState, number> = { revision_pending: 0, flagged: 1, ok: 2 }

// --- Component ---

export default function GlossaryAdminPage() {
  const [terms, setTerms] = useState<GlossaryTermRow[]>([])
  const [details, setDetails] = useState<Record<string, GlossaryTermDetail>>({})
  // Review-Fund Important 5: ein fehlgeschlagener Detail-Fetch verschwand
  // bisher stillschweigend (Eintrag fehlte einfach in `details`) und zeigte
  // dauerhaft „Lade Revision..." ohne Fehlermeldung — mit Übernehmen/Verwerfen
  // unerreichbar, weil beide Buttons innerhalb des `detail ?`-Zweigs lagen.
  // Eigener Fehlerzustand pro Slug macht das sichtbar.
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({})
  // Draft-Preview-Fix: Vorschau-Aufklapp-Zustand + eigener Loading-Zustand
  // pro Slug fürs bedarfsweise Nachladen (nicht actionLoading, das ist für
  // schreibende PATCH/DELETE-Aktionen reserviert und würde sonst z. B. den
  // Löschen-Button während eines reinen Lesevorgangs sperren).
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({})
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  // Einzelner Detail-Fetch (body + pending_body + illustration_url) — von
  // fetchTerms (offene Revisionen, vorab) UND von loadPreview (Vorschau auf
  // Zuruf, jeder Status) gemeinsam genutzt, statt die Fetch-Logik zweimal zu
  // pflegen.
  const fetchDetail = useCallback(async (slug: string): Promise<{ detail: GlossaryTermDetail | null; error: string | null }> => {
    try {
      const res = await fetch(`/api/admin/glossary?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        return { detail: null, error: data?.error || `HTTP ${res.status}` }
      }
      const data = await res.json()
      return { detail: data.term as GlossaryTermDetail, error: null }
    } catch (err) {
      return { detail: null, error: err instanceof Error ? err.message : 'Netzwerkfehler' }
    }
  }, [])

  const fetchTerms = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary')
      if (!res.ok) throw new Error(`Laden fehlgeschlagen (HTTP ${res.status})`)
      const data = await res.json()
      const rows: GlossaryTermRow[] = data.terms ?? []
      setTerms(rows)

      // Detail-Fetch nur vorab für offene Revisionen — die Listen-Antwort
      // schickt body bewusst nicht mit (Payload-Größe). Für alle anderen
      // Begriffe lädt die Vorschau (loadPreview) bedarfsweise nach.
      const pending = rows.filter((r) => r.review_state === 'revision_pending')
      const entries = await Promise.all(
        pending.map(async (r) => ({ slug: r.slug, ...(await fetchDetail(r.slug)) })),
      )
      const newDetails: Record<string, GlossaryTermDetail> = {}
      const newDetailErrors: Record<string, string> = {}
      for (const entry of entries) {
        if (entry.detail) newDetails[entry.slug] = entry.detail
        else newDetailErrors[entry.slug] = entry.error ?? 'Unbekannter Fehler'
      }
      // Zusammenführen statt Ersetzen: sonst würden bereits bedarfsweise
      // geladene Vorschauen (loadPreview, für nicht-pending Begriffe) bei
      // jedem Neu-laden/nach jeder Aktion wieder verworfen. Für die hier neu
      // abgefragten pending-Slugs zählt IMMER der frische Stand — ein alter
      // Fehler wird daher vor dem Merge entfernt, bevor evtl. ein neuer
      // Fehler dazukommt.
      setDetails((prev) => ({ ...prev, ...newDetails }))
      setDetailErrors((prev) => {
        const next = { ...prev }
        for (const r of pending) delete next[r.slug]
        return { ...next, ...newDetailErrors }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [fetchDetail])

  useEffect(() => {
    fetchTerms()
  }, [fetchTerms])

  // Vorschau bedarfsweise nachladen (nicht-pending Begriffe haben noch
  // keinen Detail-Fetch aus fetchTerms bekommen).
  async function loadPreview(slug: string) {
    setDetailLoading((s) => ({ ...s, [slug]: true }))
    const { detail, error } = await fetchDetail(slug)
    if (detail) {
      setDetails((prev) => ({ ...prev, [slug]: detail }))
      setDetailErrors((prev) => {
        const next = { ...prev }
        delete next[slug]
        return next
      })
    } else {
      setDetailErrors((prev) => ({ ...prev, [slug]: error ?? 'Unbekannter Fehler' }))
    }
    setDetailLoading((s) => ({ ...s, [slug]: false }))
  }

  // Aufklappen lädt einmalig nach, sofern weder ein Detail noch ein Fehler
  // dazu vorliegt — Zuklappen/erneutes Aufklappen fragt nicht erneut ab,
  // "Neu laden" oben tut das für pending-Begriffe ohnehin schon.
  function togglePreview(slug: string) {
    const willOpen = !previewOpen[slug]
    setPreviewOpen((s) => ({ ...s, [slug]: willOpen }))
    if (willOpen && !details[slug] && !detailErrors[slug]) {
      loadPreview(slug)
    }
  }

  // `extra` trägt targetLang für 'translate' — die übrigen Actions brauchen
  // kein weiteres Feld, das PATCH-Handler-Payload deckt beides über dieselbe
  // Signatur ab (Task 18).
  async function runAction(slug: string, action: PatchAction, extra?: Record<string, unknown>) {
    setActionLoading((s) => ({ ...s, [slug]: true }))
    try {
      const res = await fetch('/api/admin/glossary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, action, ...extra }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Aktion fehlgeschlagen (HTTP ${res.status})`)
      }
      await fetchTerms()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setActionLoading((s) => ({ ...s, [slug]: false }))
    }
  }

  async function deleteTerm(slug: string) {
    if (!confirm(`Begriff "${slug}" wirklich löschen? Übersetzungen, Produkt- und News-Zuordnungen werden mitgelöscht.`)) return
    setActionLoading((s) => ({ ...s, [slug]: true }))
    try {
      const res = await fetch('/api/admin/glossary', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Löschen fehlgeschlagen (HTTP ${res.status})`)
      }
      await fetchTerms()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setActionLoading((s) => ({ ...s, [slug]: false }))
    }
  }

  const sortedTerms = [...terms].sort((a, b) => {
    const orderDiff = REVIEW_ORDER[a.review_state] - REVIEW_ORDER[b.review_state]
    if (orderDiff !== 0) return orderDiff
    return a.canonical_name.localeCompare(b.canonical_name)
  })

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-2">
            <BookOpen className="h-7 w-7" />
            Lexikon
          </h1>
          <p className="mt-1 text-muted-foreground">
            Fachbegriffe, Aktualitätsstatus und offene Revisionen aus der täglichen Aktualitätsprüfung
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTerms} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Neu laden
        </Button>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 text-sm text-red-600">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lade Begriffe...
        </div>
      ) : sortedTerms.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Begriffe im Lexikon.</p>
      ) : (
        <div className="space-y-4">
          {sortedTerms.map((term) => {
            const isBusy = !!actionLoading[term.slug]
            const detail = details[term.slug]
            return (
              <Card key={term.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {term.canonical_name}
                        <StatusBadge status={term.status} />
                        <ReviewBadge state={term.review_state} />
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        /{term.slug} · zuletzt geprüft: {formatDate(term.last_reviewed_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => togglePreview(term.slug)}
                        title="Aktuellen Text (und ggf. Illustration) dieses Begriffs anzeigen"
                      >
                        {previewOpen[term.slug] ? <ChevronUp className="h-4 w-4 mr-1.5" /> : <ChevronDown className="h-4 w-4 mr-1.5" />}
                        Vorschau
                      </Button>
                      {term.status === 'published' ? (
                        <Button variant="outline" size="sm" onClick={() => runAction(term.slug, 'hide')} disabled={isBusy}>
                          <EyeOff className="h-4 w-4 mr-1.5" />
                          Verbergen
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => runAction(term.slug, 'publish')} disabled={isBusy}>
                          <Eye className="h-4 w-4 mr-1.5" />
                          Veröffentlichen
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runAction(term.slug, 'translate', { targetLang: 'en' })}
                        disabled={isBusy}
                        title="Englische Übersetzung erzeugen/aktualisieren"
                      >
                        {/* Review Minor 5: anders als Verbergen/Veröffentlichen (Sub-Sekunden-
                            Updates) ist das hier ein LLM-Call — derselbe Loader2-Ternary wie
                            bei „Übernehmen" (unten), statt nur disabled. */}
                        {isBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Languages className="h-4 w-4 mr-1.5" />}
                        Übersetzen
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteTerm(term.slug)} disabled={isBusy}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {previewOpen[term.slug] && (
                  // Draft-Preview-Fix: einziger Weg, den Text eines Begriffs vor dem
                  // Veröffentlichen (oder vor Verbergen/Löschen) zu lesen — die
                  // öffentliche Detailseite liefert für status≠'published' ein
                  // notFound(). Bewusst für JEDEN Status verfügbar, nicht nur
                  // 'draft': dieselbe Notwendigkeit besteht vorm Verbergen eines
                  // veröffentlichten Begriffs. Kein Gate auf „Veröffentlichen" —
                  // anders als bei accept_revision geht es hier nicht um fehlende
                  // Daten, die Vorschau ist einfach verfügbar, wenn gewünscht.
                  <CardContent className="pt-0 pb-4 space-y-3">
                    {detailLoading[term.slug] && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Lade Vorschau...
                      </div>
                    )}
                    {!detailLoading[term.slug] && detail && (
                      <>
                        {detail.illustration_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={detail.illustration_url}
                            alt=""
                            className="h-32 w-auto rounded-md border object-cover"
                          />
                        )}
                        {tiptapPlainText(detail.body) ? (
                          <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                            {tiptapPlainText(detail.body)}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Kein Text vorhanden.</p>
                        )}
                      </>
                    )}
                    {!detailLoading[term.slug] && !detail && detailErrors[term.slug] && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <XCircle className="h-4 w-4 shrink-0" />
                        Vorschau konnte nicht geladen werden ({detailErrors[term.slug]}).
                      </div>
                    )}
                  </CardContent>
                )}

                {term.review_state === 'revision_pending' && (
                  <CardContent className="space-y-3">
                    {detail && <RevisionDiff body={detail.body} pendingBody={detail.pending_body} />}
                    {!detail && detailErrors[term.slug] && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <XCircle className="h-4 w-4 shrink-0" />
                        Vorschau konnte nicht geladen werden ({detailErrors[term.slug]}) — „Übernehmen" ist
                        deshalb gesperrt (niemand hat den Vorschlag gesehen). Oben „Neu laden" versuchen,
                        oder direkt verwerfen.
                      </div>
                    )}
                    {!detail && !detailErrors[term.slug] && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Lade Revision...
                      </div>
                    )}
                    {/* Verwerfen bleibt unabhängig vom Detail-Fetch erreichbar
                        (Review-Fund Important 5) — es braucht serverseitig nur
                        den slug und ändert den Live-Text nicht. Übernehmen
                        dagegen ist das redaktionelle Freigabe-Gate: ohne
                        geladenen Diff hat niemand den Vorschlag gesehen, also
                        bleibt es gesperrt, bis die Vorschau lädt (Review-Fund
                        Important 2 aus Fix-Runde 2) — sonst ließe sich eine nie
                        gesehene Revision live schalten. */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => runAction(term.slug, 'accept_revision')}
                        disabled={isBusy || !detail}
                        title={!detail ? 'Erst laden, um den Vorschlag vor der Freigabe zu sehen' : undefined}
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                        Übernehmen
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => runAction(term.slug, 'discard_revision')} disabled={isBusy}>
                        <XCircle className="h-4 w-4 mr-1.5" />
                        Verwerfen
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
