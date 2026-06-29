'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
  const stopRef = useRef(false)

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

  // Browser-getriebener Lauf: Job anlegen, dann Batch für Batch advancen bis fertig.
  const runOnce = async () => {
    setError(''); setRunning(true); stopRef.current = false
    try {
      await fetch('/api/admin/product-extract-job', { method: 'POST' }) // create (idempotent)
      while (!stopRef.current) {
        const r = await fetch('/api/admin/product-extract-job?advance=1', { method: 'POST' })
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText)
        const data = await r.json()
        setStatus(data)
        setLastResult(data.result ?? '')
        if (['extract_done', 'extract_empty', 'no_job', 'extract_budget_exhausted'].includes(data.result) || String(data.result).startsWith('claim_error')) break
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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Synthszr Rankings — Extraktion</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manueller Lauf zur Beobachtung. Vorfilter überspringt Nicht-AI-News ohne LLM-Call.
          Fenster: letzte {s?.windowDays ?? 1} Tag(e).
        </p>
      </div>

      {/* Token-Anzeige (prominent) */}
      <div className={`rounded-xl border-2 p-6 ${budgetExhausted ? 'border-red-500 bg-red-50' : 'border-black bg-[#CCFF00]/20'}`}>
        <div className="text-sm font-semibold uppercase tracking-wide text-gray-700">Verbrauchte Token (aktueller Job)</div>
        <div className="text-4xl font-bold mt-1">{fmt(tokens)} <span className="text-xl font-normal text-gray-500">/ {fmt(budget)}</span></div>
        <div className="text-sm text-gray-600 mt-1">≈ ${estCost(tokens).toFixed(2)} (grobe Schätzung, Haiku) · Budget zu {tokenPct}% genutzt</div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-2">
          <div className={`h-full ${budgetExhausted ? 'bg-red-500' : 'bg-black'}`} style={{ width: `${tokenPct}%` }} />
        </div>
        {budgetExhausted && <div className="text-sm text-red-600 font-semibold mt-2">Token-Budget erschöpft — Lauf gestoppt. Budget erhöhen (ranking_jobs.budget_extract) oder morgen fortsetzen.</div>}
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
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-black" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Job-Status */}
      <div className="text-sm text-gray-700 space-y-1">
        <div>Job: <b>{s?.job?.status ?? '—'}</b> / Phase <b>{s?.job?.phase ?? '—'}</b> / {s?.job?.run_date ?? '—'}</div>
        {lastResult && <div>Letzter Schritt: <code>{lastResult}</code></div>}
        {s?.job?.error_message && <div className="text-red-600">Fehler: {s.job.error_message}</div>}
        {error && <div className="text-red-600">Fehler: {error}</div>}
      </div>

      {/* Aktionen */}
      <div className="flex gap-3">
        {!running ? (
          <button onClick={runOnce} className="px-4 py-2 rounded-lg bg-black text-white font-semibold hover:bg-gray-800">
            Lauf starten
          </button>
        ) : (
          <button onClick={stop} className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700">
            Stoppen
          </button>
        )}
        <button onClick={loadStatus} disabled={running} className="px-4 py-2 rounded-lg border border-gray-300 font-semibold hover:bg-gray-50 disabled:opacity-50">
          Aktualisieren
        </button>
        {running && <span className="self-center text-sm text-gray-600">Läuft… (Batch für Batch)</span>}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
