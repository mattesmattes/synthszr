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
  const [open, setOpen] = useState<MentionView | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // nach Quelle gruppieren
  const groups = new Map<string, MentionView[]>()
  for (const m of mentions) {
    const src = m.sourceTitle?.trim() || 'Ohne Quelle'
    if (!groups.has(src)) groups.set(src, [])
    groups.get(src)!.push(m)
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  const toggle = (src: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src); else next.add(src)
      return next
    })

  return (
    <>
      {/* Quellen-Pills (Anzahl Artikel) */}
      <div className="flex flex-wrap gap-1.5">
        {sorted.map(([src, ms]) => (
          <button
            key={src}
            onClick={() => toggle(src)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              expanded.has(src) ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:border-black'
            }`}
          >
            {src} <span className="opacity-60">({ms.length})</span>
          </button>
        ))}
        {sorted.length === 0 && <span className="text-gray-500 text-sm">Keine Belege.</span>}
      </div>

      {/* Aufgeklappte Belege je Quelle */}
      {sorted.filter(([src]) => expanded.has(src)).map(([src, ms]) => (
        <div key={src} className="mt-3">
          <div className="text-xs font-semibold text-gray-500 mb-1">{src}</div>
          <ul className="space-y-1">
            {ms.map((m, i) => (
              <li key={i}>
                <button
                  onClick={() => setOpen(m)}
                  className="w-full flex items-baseline gap-2 text-left rounded-md border border-gray-200 px-2.5 py-1.5 text-sm hover:border-black transition-colors"
                >
                  <span className="text-black text-xs font-bold shrink-0 tabular-nums">{fmtDate(m.mentionDate)}</span>
                  <span className="font-semibold text-gray-900 truncate">{m.excerpt ? `„${m.excerpt}"` : src}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="text-xs font-bold text-black tabular-nums">{fmtDate(open.mentionDate)}</div>
                <h3 className="text-lg font-bold leading-tight mt-0.5">{open.sourceTitle ?? 'Newsletter'}</h3>
              </div>
              <button onClick={() => setOpen(null)} className="shrink-0 text-gray-400 hover:text-black" aria-label="Schließen">
                <X className="w-5 h-5" />
              </button>
            </div>
            {open.excerpt && (
              <p className="text-sm font-semibold text-gray-900 border-l-2 border-[#CCFF00] pl-3 mb-4">„{open.excerpt}"</p>
            )}
            {open.sourceContent
              ? <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{open.sourceContent}</div>
              : <p className="text-sm text-gray-400">Kein Volltext verfügbar.</p>}
          </div>
        </div>
      )}
    </>
  )
}
