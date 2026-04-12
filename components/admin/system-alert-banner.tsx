'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface SystemAlert {
  provider: string
  message: string
  created_at: string
}

export function SystemAlertBanner() {
  const [alert, setAlert] = useState<SystemAlert | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/admin/system-alert')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setAlert(data.alert ?? null)
      } catch {
        /* ignore */
      }
    }
    load()
    const interval = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const handleDismiss = async () => {
    if (!alert) return
    setDismissedId(alert.created_at)
    try {
      await fetch('/api/admin/system-alert', { method: 'DELETE' })
    } catch {
      /* ignore */
    }
  }

  if (!alert || alert.created_at === dismissedId) return null

  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{alert.provider} — Credit-Guthaben aufgebraucht</div>
        <div className="text-sm mt-0.5 break-words">{alert.message}</div>
        <div className="text-xs text-red-700/70 mt-1">
          {new Date(alert.created_at).toLocaleString('de-DE')}
        </div>
      </div>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 hover:bg-red-100"
        aria-label="Alert schließen"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
