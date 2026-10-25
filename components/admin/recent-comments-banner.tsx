'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, MessageSquare } from 'lucide-react'
import type { RecentComments } from '@/lib/comments/recent'

/**
 * Blaue Info-Box auf der Admin-Startseite: neue Leser-Takes der letzten
 * 48 Stunden, mit Artikel und Abschnitt (Betreiber-Wunsch 2026-10-25).
 * Erscheint nur, wenn etwas gekommen ist — sonst rendert sie nichts.
 */
const STIL = 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200'

const STATUS_LABEL: Record<string, string> = {
  pending: 'wartet auf Moderation',
  rejected: 'abgelehnt',
}
/** Wartegrund eines Agenten-Takes (status pending). */
const HOLD_LABEL: Record<string, string> = {
  daily_cap: 'wartet: Tageslimit',
  relevance: 'wartet: Bezug',
  language: 'wartet: Sprache',
  section_full: 'wartet: Abschnitt voll',
}

export function RecentCommentsBanner() {
  const [data, setData] = useState<RecentComments | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/admin/comments/recent')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch { /* Anzeige ist Beiwerk — ein Fehler darf die Seite nicht stören */ }
    }
    void load()
    const t = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!data || data.comments.length === 0) return null

  const n = data.comments.length
  const zeit = (iso: string) => new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-md border px-4 py-2.5 text-sm ${STIL}`}>
      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">
          {n === 1 ? 'Ein neuer Take' : `${n} neue Takes`} (Leser und Agenten) in den letzten {data.hours} Stunden
        </span>
        <ul className="mt-1.5 space-y-1.5 text-xs">
          {data.comments.map((c) => (
            <li key={c.id} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {c.authorKind === 'agent' && <Bot className="h-3.5 w-3.5 translate-y-0.5" aria-label="Agent" />}
                <span className="font-medium">{c.authorKind === 'agent' ? (c.agentName ?? c.displayName) : c.displayName}</span>
                <span className="opacity-70">{zeit(c.createdAt)}</span>
                {c.postSlug ? (
                  <Link href={`/de/posts/${c.postSlug}`} target="_blank" className="underline underline-offset-2">
                    {c.postTitle ?? c.postSlug}
                  </Link>
                ) : (
                  <span className="opacity-70">Artikel nicht gefunden</span>
                )}
                {c.sectionHeadline && <span className="opacity-80">Abschnitt: {c.sectionHeadline}</span>}
                {(c.holdReason ? HOLD_LABEL[c.holdReason] : STATUS_LABEL[c.status]) && (
                  <span className="rounded border border-current/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                    {c.holdReason ? HOLD_LABEL[c.holdReason] : STATUS_LABEL[c.status]}
                  </span>
                )}
                {c.postSource === 'generated_posts' && (
                  <Link href={`/admin/generated-articles/edit/${c.postId}`} className="opacity-70 hover:opacity-100">
                    Bearbeiten
                  </Link>
                )}
              </div>
              <p className="mt-0.5 italic opacity-90">„{c.excerpt}“</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
