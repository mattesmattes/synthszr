'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

export interface MentionView {
  excerpt: string | null
  mentionDate: string | null
  sourceTitle: string | null
  sourceContent: string | null
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

export function MentionList({ mentions }: { mentions: MentionView[] }) {
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const active = open !== null ? mentions[open] : null

  return (
    <>
      <ul className="space-y-1">
        {mentions.map((m, i) => (
          <li key={i}>
            <button
              onClick={() => setOpen(i)}
              className="w-full flex items-baseline gap-2 text-left rounded-md border border-gray-200 px-2.5 py-1.5 text-sm hover:border-black transition-colors"
            >
              <span className="text-black text-xs font-bold shrink-0 tabular-nums">{fmtDate(m.mentionDate)}</span>
              {m.sourceTitle && <span className="text-gray-500 text-xs shrink-0 max-w-[38%] truncate">{m.sourceTitle}</span>}
              <span className="font-semibold text-gray-900 truncate">{m.excerpt ? `„${m.excerpt}"` : ''}</span>
            </button>
          </li>
        ))}
        {mentions.length === 0 && <li className="text-gray-500 text-sm">Keine Belege.</li>}
      </ul>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="text-xs font-bold text-black tabular-nums">{fmtDate(active.mentionDate)}</div>
                <h3 className="text-lg font-bold leading-tight mt-0.5">{active.sourceTitle ?? 'Newsletter'}</h3>
              </div>
              <button onClick={() => setOpen(null)} className="shrink-0 text-gray-400 hover:text-black" aria-label="Schließen">
                <X className="w-5 h-5" />
              </button>
            </div>
            {active.excerpt && (
              <p className="text-sm font-semibold text-gray-900 border-l-2 border-[#CCFF00] pl-3 mb-4">„{active.excerpt}"</p>
            )}
            {active.sourceContent
              ? <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{active.sourceContent}</div>
              : <p className="text-sm text-gray-400">Kein Volltext verfügbar.</p>}
          </div>
        </div>
      )}
    </>
  )
}
