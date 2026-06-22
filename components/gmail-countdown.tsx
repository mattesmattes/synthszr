'use client'

import { useEffect, useState } from 'react'

const TOTAL_DAYS = 7

/**
 * Resttage bis zum Gmail-Token-Ablauf.
 * Anker ist `gmail_tokens.updated_at` (wird bei jedem erfolgreichen Reconnect
 * auf NOW() gesetzt). Google-Token im Testing-Modus läuft nach 7 Tagen ab,
 * deshalb zählt der Countdown von 7 auf 1. Ohne Timestamp = frischer Start (7).
 */
function daysLeftFrom(updatedAt: string | null | undefined): number {
  if (!updatedAt) return TOTAL_DAYS

  const start = new Date(updatedAt)
  if (Number.isNaN(start.getTime())) return TOTAL_DAYS
  start.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const daysSince = Math.round((today.getTime() - start.getTime()) / 86_400_000)
  return Math.min(TOTAL_DAYS, Math.max(1, TOTAL_DAYS - daysSince))
}

/** Grün (7) → Gelb (4) → Rot (1) über den Hue-Kanal. */
function colorsFor(daysLeft: number): { background: string; color: string } {
  const hue = ((daysLeft - 1) / (TOTAL_DAYS - 1)) * 120 // 0° rot … 120° grün
  // Gelbbereich braucht dunklen Text, sonst weiß.
  const dark = hue > 45 && hue < 95
  return {
    background: `hsl(${hue}, 85%, 45%)`,
    color: dark ? '#1a1a0a' : '#ffffff',
  }
}

export function GmailCountdown() {
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/gmail/status')
        const data = await res.json()
        if (!cancelled) setUpdatedAt(data.updatedAt ?? null)
      } catch {
        // Bei Fehler: Fallback auf frischen Countdown (7).
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    // Über Mitternacht hinweg neu berechnen, ohne Reload.
    const interval = setInterval(load, 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (loading) return null

  const daysLeft = daysLeftFrom(updatedAt)
  const { background, color } = colorsFor(daysLeft)

  return (
    <div
      className="w-full rounded-lg px-6 py-4 mb-6 flex items-center gap-5 transition-colors"
      style={{ background, color }}
    >
      <span className="text-5xl font-bold tabular-nums leading-none tracking-tighter">
        {daysLeft}
      </span>
      <div className="leading-snug">
        <p className="text-lg font-semibold">
          {daysLeft === 1
            ? 'Noch 1 Tag bis zum Ablauf der Gmail-Verbindung'
            : `Noch ${daysLeft} Tage bis zum Ablauf der Gmail-Verbindung`}
        </p>
        <p className="text-sm opacity-90">
          Gmail neu verbinden, um den Countdown zurückzusetzen.
        </p>
      </div>
      <a
        href="/api/gmail/authorize"
        className="ml-auto shrink-0 rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition-colors hover:bg-white/90"
      >
        Neu verbinden
      </a>
    </div>
  )
}
