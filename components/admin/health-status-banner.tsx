'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react'

interface Status {
  state: 'ok' | 'fehler' | 'veraltet' | 'unbekannt'
  checked?: number
  failed?: Array<{ url: string; status: number; error?: string }>
  checkedAt?: string
}

/**
 * Zeigt, ob die öffentlichen Seiten beim letzten Lauf erreichbar waren.
 *
 * Sitzt unter dem Gmail-Countdown und dem News-Banner. Anlass war der Ausfall
 * am 2026-08-25: alle Artikelseiten lieferten 500, und es fiel nur zufällig auf.
 */
const STIL = {
  ok:        'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  fehler:    'border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200',
  veraltet:  'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  unbekannt: 'border-border bg-muted/30 text-muted-foreground',
} as const

export function HealthStatusBanner() {
  const [s, setS] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/admin/health-status')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setS(data)
      } catch { /* Anzeige ist Beiwerk — ein Fehler darf die Seite nicht stören */ }
    }
    void load()
    const t = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!s) return null

  const Icon = s.state === 'ok' ? CheckCircle2 : s.state === 'unbekannt' ? HelpCircle : AlertTriangle
  const zeit = s.checkedAt
    ? new Date(s.checkedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : null

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-md border px-4 py-2.5 text-sm ${STIL[s.state]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        {s.state === 'ok' && (
          <span><span className="font-semibold">Alle Seiten erreichbar</span>
            <span className="ml-2 text-xs opacity-80">{s.checked} geprüft · zuletzt {zeit}</span></span>
        )}
        {s.state === 'fehler' && (
          <>
            <span className="font-semibold">
              {s.failed?.length} von {s.checked} Seiten nicht erreichbar
            </span>
            <span className="ml-2 text-xs opacity-80">zuletzt geprüft {zeit}</span>
            <ul className="mt-1 space-y-0.5 text-xs">
              {s.failed?.slice(0, 5).map((f) => (
                <li key={f.url} className="truncate">
                  <code>{f.url.replace(/^https?:\/\/[^/]+/, '')}</code>
                  {' — '}{f.error ? `Netzwerkfehler` : `HTTP ${f.status}`}
                </li>
              ))}
              {(s.failed?.length ?? 0) > 5 && <li>und {(s.failed?.length ?? 0) - 5} weitere</li>}
            </ul>
          </>
        )}
        {s.state === 'veraltet' && (
          <span><span className="font-semibold">Verfügbarkeitsprüfung veraltet</span>
            <span className="ml-2 text-xs opacity-90">
              Letzter Lauf {zeit}. Die Prüfung läuft alle vier Stunden — kommt sie nicht durch,
              sagt auch ein grünes Ergebnis nichts mehr.
            </span></span>
        )}
        {s.state === 'unbekannt' && (
          <span className="text-xs">Verfügbarkeitsprüfung hat noch nicht gelaufen.</span>
        )}
      </div>
    </div>
  )
}
