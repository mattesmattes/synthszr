'use client'

import { useEffect, useState } from 'react'
import { Inbox, AlertTriangle } from 'lucide-react'

interface FetchStatus {
  articleCount: number
  level: 'ok' | 'warn'
  lastFetchLabel: string
  lastWebcrawlLabel: string
}

/**
 * Zeigt, wie viele Quellartikel HEUTE eingesammelt wurden.
 *
 * Am 2026-08-23 lief der Newsletter-Abruf um 03:46 und fand nichts — die
 * Newsletter kamen an dem Tag erst gegen 07:00. Der Scheduler verbuchte den
 * leeren Lauf als Erfolg und sperrte damit jeden weiteren Versuch des Tages;
 * ohne Quellmaterial fiel die Tagesanalyse aus und mit ihr der Artikel. Diese
 * Zahl haette den Ausfall auf einen Blick gezeigt.
 *
 * Deshalb ist NULL hier ausdruecklich ein Warnzustand und keine unauffaellige
 * Null: „0 heute" ist die Information, auf die es ankommt.
 */
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
      } catch { /* Anzeige ist Beiwerk — Fehler duerfen die Seite nicht stoeren */ }
    }
    void load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!s) return null

  const warn = s.level === 'warn'
  return (
    <div
      className={`mb-4 flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm ${
        warn
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-border bg-muted/30 text-foreground'
      }`}
    >
      {warn
        ? <AlertTriangle className="h-4 w-4 shrink-0" />
        : <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="flex-1 min-w-0">
        <span className="font-semibold">
          {warn
            ? 'Heute noch keine News eingesammelt'
            : `${s.articleCount} News heute eingesammelt`}
        </span>
        <span className="ml-2 text-xs opacity-80">
          Newsletter-Abruf: {s.lastFetchLabel} · WebCrawl: {s.lastWebcrawlLabel}
        </span>
        {warn && (
          <div className="mt-0.5 text-xs opacity-90">
            Ohne Quellartikel fällt die Tagesanalyse aus — und damit der Artikel. Oben „Newsletter" drücken.
          </div>
        )}
      </div>
    </div>
  )
}
