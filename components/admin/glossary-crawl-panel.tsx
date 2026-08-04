'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, RefreshCw, Search, Sparkles, RotateCcw, AlertCircle } from 'lucide-react'

interface CrawlStatus {
  postsProcessed: number
  postsTotal: number
  candidateCount: number
  generatedCount: number
  updatedAt: string | null
  topCandidates: Array<{ name: string; mentions: number }>
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
  const [busy, setBusy] = useState<'extract' | 'generate' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

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

  async function run(action: 'extract' | 'generate' | 'reset') {
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
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              <span className="font-mono font-bold tabular-nums">{status?.candidateCount ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">Begriffe gefunden, noch nicht erzeugt</span>
            </span>
            <span>
              <span className="font-mono font-bold tabular-nums">{status?.generatedCount ?? 0}</span>
              <span className="ml-1.5 text-muted-foreground">bereits erzeugt</span>
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run('extract')} disabled={busy !== null}>
              {busy === 'extract' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Nächste {status?.postsPerExtraction ?? 10} Artikel lesen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run('generate')}
              disabled={busy !== null || (status?.candidateCount ?? 0) === 0}
            >
              {busy === 'generate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {status?.termsPerGeneration ?? 3} Begriffe erzeugen &amp; veröffentlichen
            </Button>
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
              {status.topCandidates.map((c, i) => (
                <li key={c.name}>
                  <Badge
                    variant={i < (status.termsPerGeneration ?? 3) ? 'default' : 'outline'}
                    className="font-normal"
                  >
                    {c.name}
                    <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">{c.mentions}×</span>
                  </Badge>
                </li>
              ))}
            </ul>
            {status.candidateCount > status.topCandidates.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                … und {status.candidateCount - status.topCandidates.length} weitere.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
