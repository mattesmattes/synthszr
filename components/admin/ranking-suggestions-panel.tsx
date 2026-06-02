// components/admin/ranking-suggestions-panel.tsx
'use client'
import { useEffect, useState } from 'react'

interface Suggestion {
  queueItemId: string
  rank: number | null
  reason: string | null
  confidence: number | null
  userAction?: string
  title: string
  source: string | null
}

export function RankingSuggestionsPanel() {
  const [runId, setRunId] = useState<string | null>(null)
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  async function loadLatest() {
    const res = await fetch('/api/admin/ranking')
    if (res.ok) {
      const data = await res.json()
      setRunId(data.runId)
      setItems(data.suggestions || [])
    }
  }
  useEffect(() => { loadLatest() }, [])

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ranking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.ok) { setRunId(data.runId); setItems(data.suggestions || []) }
    } finally { setLoading(false) }
  }

  async function feedback(queueItemId: string, action: 'accepted' | 'rejected') {
    if (!runId) return
    await fetch('/api/admin/ranking-feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, queueItemId, action }),
    })
    setItems((prev) => prev.map((s) => (s.queueItemId === queueItemId ? { ...s, userAction: action } : s)))
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Vorschläge (assistiertes Ranking)</h3>
        <button onClick={generate} disabled={loading}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {loading ? 'Generiere…' : 'Vorschläge generieren'}
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-neutral-500">Noch keine Vorschläge.</p>}
      <ol className="space-y-2">
        {items.map((s) => (
          <li key={s.queueItemId}
            className={`rounded border p-2 text-sm ${s.userAction === 'rejected' ? 'opacity-40' : ''} ${s.userAction === 'accepted' ? 'border-lime-400 bg-lime-50' : 'border-neutral-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="mr-2 font-mono text-xs text-neutral-400">#{s.rank}</span>
                <span className="font-medium">{s.title}</span>
                {s.source && <span className="ml-1 text-xs text-neutral-500">[{s.source}]</span>}
                {s.reason && <p className="mt-0.5 text-xs text-neutral-600">{s.reason}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => feedback(s.queueItemId, 'accepted')} className="rounded bg-lime-500 px-2 py-0.5 text-xs text-white">Behalten</button>
                <button onClick={() => feedback(s.queueItemId, 'rejected')} className="rounded bg-neutral-300 px-2 py-0.5 text-xs">Verwerfen</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
