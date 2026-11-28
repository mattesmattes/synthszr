'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminPage, AdminPageHeader } from '@/components/admin/admin-page'
import { Button } from '@/components/ui/button'

interface ExtractStatus {
  job: {
    id: string; mode: string; phase: string; status: string
    spend_tokens: number; run_date: string; last_advanced_at: string | null
    error_message: string | null
  } | null
  windowDays: number
  tokenBudget: number
  products: number
  mentions: number
  windowTotal: number
  windowDone: number
  windowRemaining: number
  prefilterSkips: number
}

const fmt = (n: number) => n.toLocaleString('de-DE')
// Grobe Kostenschätzung (Haiku, input-lastiger Extract): ~$2 pro 1 Mio. Token.
const estCost = (tokens: number) => (tokens / 1_000_000) * 2

export default function RankingsAdminPage() {
  const [status, setStatus] = useState<ExtractStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')
  const stopRef = useRef(false)
  const [qa, setQa] = useState<{ counts: Record<string, number>; recent: Array<{ slug: string; current_vendor: string; action: string; merged_into_slug: string | null; suggested_company: string | null; confidence: number | null; reasoning: string }> } | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/product-extract-job')
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText)
      setStatus(await r.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { fetch('/api/admin/attribution-qa').then((r) => r.json()).then(setQa).catch(() => {}) }, [])

  // Browser-getriebener Lauf: Job anlegen, dann Batch für Batch advancen bis fertig.
  const runOnce = async () => {
    setError(''); setNotice(''); setRunning(true); stopRef.current = false
    try {
      const created = await fetch('/api/admin/product-extract-job', { method: 'POST' }).then((r) => r.json()).catch(() => null) // create (idempotent)
      while (!stopRef.current) {
        const r = await fetch('/api/admin/product-extract-job?advance=1', { method: 'POST' })
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText)
        const data = await r.json()
        setStatus(data)
        setLastResult(data.result ?? '')
        if (data.result === 'no_job') {
          // Kein Abbruch: der tägliche Job ist schon gelaufen (Cron 05:00 UTC),
          // ein zweiter am selben Tag wird bewusst nicht angelegt.
          setNotice(created?.reason === 'already_created_today'
            ? `Heute schon gelaufen${data.job?.status === 'done' ? ' und abgeschlossen' : ''}. ${data.windowRemaining > 0 ? `${fmt(data.windowRemaining)} News im Fenster sind noch offen.` : 'Im Fenster ist nichts mehr offen.'}`
            : 'Kein Job zu bearbeiten.')
          break
        }
        if (['extract_done', 'extract_empty', 'extract_budget_exhausted'].includes(data.result) || String(data.result).startsWith('claim_error')) break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      loadStatus()
    }
  }

  const stop = () => { stopRef.current = true }

  const s = status
  const tokens = s?.job?.spend_tokens ?? 0
  const budget = s?.tokenBudget ?? 0
  const tokenPct = budget > 0 ? Math.min(100, Math.round((tokens / budget) * 100)) : 0
  const budgetExhausted = !!s?.job?.error_message?.includes('Token-Budget erschöpft')
  const pct = s && s.windowTotal > 0 ? Math.round((s.windowDone / s.windowTotal) * 100) : 0

  return (
    <AdminPage className="space-y-6">
      <AdminPageHeader
        title="Synthszr Rankings — Extraktion"
        description={
          <>
            Manueller Lauf zur Beobachtung. Vorfilter überspringt Nicht-AI-News ohne LLM-Call.
            Fenster: letzte {s?.windowDays ?? 1} Tag(e).
          </>
        }
        className="mb-0"
      />

      {/* Token-Anzeige (prominent) */}
      <div className={`rounded-xl border-2 p-6 ${budgetExhausted ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-foreground bg-[#CCFF00]/20 dark:bg-[#CCFF00]/10'}`}>
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Verbrauchte Token (aktueller Job)</div>
        <div className="text-4xl font-bold mt-1">{fmt(tokens)} <span className="text-xl font-normal text-muted-foreground">/ {fmt(budget)}</span></div>
        <div className="text-sm text-muted-foreground mt-1">≈ ${estCost(tokens).toFixed(2)} (grobe Schätzung, Haiku) · Budget zu {tokenPct}% genutzt</div>
        <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
          <div className={`h-full ${budgetExhausted ? 'bg-red-500' : 'bg-foreground'}`} style={{ width: `${tokenPct}%` }} />
        </div>
        {budgetExhausted && <div className="text-sm text-red-600 dark:text-red-400 font-semibold mt-2">Token-Budget erschöpft — Lauf gestoppt. Budget erhöhen (ranking_jobs.budget_extract) oder morgen fortsetzen.</div>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Produkte" value={fmt(s?.products ?? 0)} />
        <Stat label="Mentions" value={fmt(s?.mentions ?? 0)} />
        <Stat label="Vorfilter-Skips" value={fmt(s?.prefilterSkips ?? 0)} />
        <Stat label="Fenster offen" value={fmt(s?.windowRemaining ?? 0)} />
      </div>

      {/* Fenster-Fortschritt */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>Fenster-Fortschritt</span>
          <span>{fmt(s?.windowDone ?? 0)} / {fmt(s?.windowTotal ?? 0)} ({pct}%)</span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Job-Status */}
      <div className="text-sm text-muted-foreground space-y-1">
        <div>Job: <b className="text-foreground">{s?.job?.mode ?? '—'}</b> · <b className="text-foreground">{s?.job?.status ?? '—'}</b> · Phase {s?.job?.phase ?? '—'} · {s?.job?.run_date ?? '—'}</div>
        {lastResult && <div>Letzter Schritt: <code>{lastResult}</code></div>}
        {notice && <div className="text-foreground">{notice}</div>}
        {s?.job?.error_message && <div className="text-red-600 dark:text-red-400">Fehler: {s.job.error_message}</div>}
        {error && <div className="text-red-600 dark:text-red-400">Fehler: {error}</div>}
      </div>

      {qa && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold mb-2">Attribution-QS</h2>
          <p className="text-xs text-muted-foreground mb-2">Gemergt {qa.counts.merged ?? 0} · Geflaggt {qa.counts.flagged ?? 0} · Behalten {qa.counts.kept ?? 0}</p>
          <ul className="text-xs space-y-1">
            {qa.recent.filter((r) => r.action === 'flagged').map((r, i) => (
              <li key={i} className="text-muted-foreground">
                <span className="font-mono text-foreground">{r.slug}</span> ({r.current_vendor}) → Vorschlag: <strong className="text-foreground">{r.suggested_company}</strong> · {r.reasoning}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Aktionen */}
      <div className="flex gap-3">
        {!running ? (
          <Button onClick={runOnce}>
            Lauf starten
          </Button>
        ) : (
          <Button variant="destructive" onClick={stop}>
            Stoppen
          </Button>
        )}
        <Button variant="outline" onClick={loadStatus} disabled={running}>
          Aktualisieren
        </Button>
        {running && <span className="self-center text-sm text-muted-foreground">Läuft… (Batch für Batch)</span>}
      </div>
    </AdminPage>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
