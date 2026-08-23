'use client'

import { useEffect, useState } from 'react'
import { Inbox, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface FetchStatus {
  articleCount: number
  processedCount: number
  level: 'gruen' | 'gelb' | 'rot'
  lastFetchLabel: string
  lastWebcrawlLabel: string
}

/**
 * Ampel fuer den News-Nachschub des Tages — direkt unter dem Gmail-Countdown.
 *
 * Am 2026-08-23 lief der Newsletter-Abruf um 03:46 ins Leere (die Newsletter
 * kamen erst gegen 07:00), galt aber als erledigt. Ohne Quellmaterial fiel die
 * Tagesanalyse aus und mit ihr der Artikel — sichtbar war davon nirgends etwas.
 * Diese Zeile haette den Ausfall auf einen Blick gezeigt.
 *
 * Schwellen und ihre Begruendung stehen in lib/admin/fetch-status.ts.
 */
const STIL = {
  gruen: {
    box: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  gelb: {
    box: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  rot: {
    box: 'border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200',
    dot: 'bg-red-500',
  },
} as const

export function FetchStatusBanner() {
  const [s, setS] = useState<FetchStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/admin/fetch-status')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setS(data)
      } catch { /* Anzeige ist Beiwerk — ein Fehler darf die Seite nicht stoeren */ }
    }
    void load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!s) return null
  const stil = STIL[s.level]
  const Icon = s.level === 'gruen' ? CheckCircle2 : s.level === 'gelb' ? Inbox : AlertTriangle

  return (
    <div className={`mb-4 flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm ${stil.box}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stil.dot}`} aria-hidden />
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">
          {s.processedCount} News verarbeitet
        </span>
        <span className="ml-2 opacity-80">
          aus {s.articleCount} eingesammelten Artikeln
        </span>
        <span className="ml-2 text-xs opacity-70">
          · Newsletter-Abruf {s.lastFetchLabel} · WebCrawl {s.lastWebcrawlLabel}
        </span>
        {s.level === 'rot' && (
          <div className="mt-0.5 text-xs opacity-90">
            {s.articleCount === 0
              ? 'Heute kam noch nichts herein — ohne Quellartikel fällt die Tagesanalyse aus und damit der Artikel.'
              : 'Auffällig wenig verarbeitet — Tagesanalyse und Artikel sind gefährdet.'}
          </div>
        )}
      </div>
    </div>
  )
}
