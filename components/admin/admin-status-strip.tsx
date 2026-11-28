'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Inbox,
  Mail,
  MessageSquare,
} from 'lucide-react'
import type { RecentComments } from '@/lib/comments/recent'
import { cn } from '@/lib/utils'

interface FetchStatus {
  articleCount: number
  processedCount: number
  level: 'gruen' | 'gelb' | 'rot'
  lastFetchLabel: string
  lastWebcrawlLabel: string
  tz?: string
}

interface HealthStatus {
  state: 'ok' | 'fehler' | 'veraltet' | 'unbekannt'
  checked?: number
  failed?: Array<{ url: string; status: number; error?: string }>
  cache?: { healthy: boolean; error?: string } | null
  checkedAt?: string
}

const TOTAL_GMAIL_DAYS = 7

function gmailDaysLeft(updatedAt: string | null | undefined): number {
  if (!updatedAt) return TOTAL_GMAIL_DAYS
  const start = new Date(updatedAt)
  if (Number.isNaN(start.getTime())) return TOTAL_GMAIL_DAYS
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysSince = Math.round((today.getTime() - start.getTime()) / 86_400_000)
  return Math.min(TOTAL_GMAIL_DAYS, Math.max(1, TOTAL_GMAIL_DAYS - daysSince))
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'wartet auf Moderation',
  rejected: 'abgelehnt',
}
const HOLD_LABEL: Record<string, string> = {
  daily_cap: 'wartet: Tageslimit',
  relevance: 'wartet: Bezug',
  language: 'wartet: Sprache',
  section_full: 'wartet: Abschnitt voll',
}

type ExpandedKey = 'gmail' | 'fetch' | 'health' | 'comments' | null

export function AdminStatusStrip() {
  const [gmailUpdatedAt, setGmailUpdatedAt] = useState<string | null | undefined>(undefined)
  const [fetchStatus, setFetchStatus] = useState<FetchStatus | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)
  const [commentsData, setCommentsData] = useState<RecentComments | null>(null)
  const [expanded, setExpanded] = useState<ExpandedKey>(null)

  useEffect(() => {
    let cancelled = false

    const loadFast = async () => {
      try {
        const res = await fetch('/api/admin/fetch-status')
        if (res.ok && !cancelled) setFetchStatus(await res.json())
      } catch { /* ignore */ }
    }

    const loadSlow = async () => {
      try {
        const [g, h, c] = await Promise.all([
          fetch('/api/gmail/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/admin/health-status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/admin/comments/recent').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ])
        if (cancelled) return
        setGmailUpdatedAt(g?.updatedAt ?? null)
        if (h) setHealthStatus(h)
        if (c) setCommentsData(c)
      } catch { /* ignore */ }
    }

    void loadFast()
    void loadSlow()
    const fastTimer = window.setInterval(loadFast, 60_000)
    const slowTimer = window.setInterval(loadSlow, 5 * 60_000)
    return () => {
      cancelled = true
      window.clearInterval(fastTimer)
      window.clearInterval(slowTimer)
    }
  }, [])

  const daysLeft = gmailUpdatedAt === undefined ? null : gmailDaysLeft(gmailUpdatedAt)
  const gmailCritical = daysLeft !== null && daysLeft <= 2
  const gmailWarning = daysLeft !== null && daysLeft > 2 && daysLeft <= 4

  const fetchCritical = fetchStatus?.level === 'rot'
  const healthCritical = healthStatus?.state === 'fehler' || healthStatus?.state === 'veraltet'

  const toggle = (key: Exclude<ExpandedKey, null>) => {
    setExpanded((prev) => (prev === key ? null : key))
  }

  const healthTime = healthStatus?.checkedAt
    ? new Date(healthStatus.checkedAt).toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      })
    : null

  const commentTime = (iso: string) =>
    new Date(iso).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  if (daysLeft === null && !fetchStatus && !healthStatus && !commentsData) {
    return null
  }

  const commentCount = commentsData?.comments.length ?? 0

  return (
    <div className="mb-5 space-y-2.5">
      {/* Kompakte 1-zeilige Instrumentenleiste */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-2 shadow-xs">
        {daysLeft !== null && (
          <button
            type="button"
            onClick={() => toggle('gmail')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
              gmailCritical
                ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200'
                : gmailWarning
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-border/70 bg-muted/40 text-foreground hover:bg-muted/80',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                gmailCritical ? 'bg-red-500' : gmailWarning ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              aria-hidden="true"
            />
            <Mail className="h-3.5 w-3.5 shrink-0 opacity-75" />
            <span>Gmail: {daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'}</span>
            <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', expanded === 'gmail' && 'rotate-180')} />
          </button>
        )}

        {fetchStatus && (
          <button
            type="button"
            onClick={() => toggle('fetch')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
              fetchStatus.level === 'rot'
                ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200'
                : fetchStatus.level === 'gelb'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-border/70 bg-muted/40 text-foreground hover:bg-muted/80',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                fetchStatus.level === 'rot' ? 'bg-red-500' : fetchStatus.level === 'gelb' ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              aria-hidden="true"
            />
            {fetchStatus.level === 'gruen' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
            ) : fetchStatus.level === 'gelb' ? (
              <Inbox className="h-3.5 w-3.5 shrink-0 opacity-85" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              News: {fetchStatus.processedCount}/{fetchStatus.articleCount}
            </span>
            <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', expanded === 'fetch' && 'rotate-180')} />
          </button>
        )}

        {healthStatus && (
          <button
            type="button"
            onClick={() => toggle('health')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
              healthStatus.state === 'ok'
                ? 'border-border/70 bg-muted/40 text-foreground hover:bg-muted/80'
                : healthStatus.state === 'unbekannt'
                ? 'border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                : healthStatus.state === 'veraltet'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                : 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                healthStatus.state === 'ok'
                  ? 'bg-emerald-500'
                  : healthStatus.state === 'unbekannt'
                  ? 'bg-muted-foreground/50'
                  : healthStatus.state === 'veraltet'
                  ? 'bg-amber-500'
                  : 'bg-red-500',
              )}
              aria-hidden="true"
            />
            {healthStatus.state === 'ok' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
            ) : healthStatus.state === 'unbekannt' ? (
              <HelpCircle className="h-3.5 w-3.5 shrink-0 opacity-75" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {healthStatus.state === 'ok'
                ? `Health: OK (${healthStatus.checked ?? 0})`
                : healthStatus.state === 'fehler'
                ? 'Health: Störung'
                : healthStatus.state === 'veraltet'
                ? 'Health: Veraltet'
                : 'Health: Unbekannt'}
            </span>
            <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', expanded === 'health' && 'rotate-180')} />
          </button>
        )}

        {commentCount > 0 && commentsData && (
          <button
            type="button"
            onClick={() => toggle('comments')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300/80 bg-blue-50/90 px-2.5 py-1 text-xs font-medium tabular-nums text-blue-900 transition-colors hover:bg-blue-100/80 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-200 dark:hover:bg-blue-500/25"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-hidden="true" />
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span>
              {commentCount} {commentCount === 1 ? 'neuer Take' : 'neue Takes'} ({commentsData.hours}h)
            </span>
            <ChevronDown className={cn('h-3 w-3 opacity-60 transition-transform', expanded === 'comments' && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Gmail Detail / Eskalation bei ≤ 2 Tagen */}
      {(gmailCritical || expanded === 'gmail') && daysLeft !== null && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-xs',
            gmailCritical
              ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200'
              : 'border-border/80 bg-card text-foreground',
          )}
        >
          <div>
            <span className="font-semibold">
              {daysLeft === 1
                ? 'Noch 1 Tag bis zum Ablauf der Gmail-Verbindung'
                : `Noch ${daysLeft} Tage bis zum Ablauf der Gmail-Verbindung`}
            </span>
            <span className="ml-2 text-xs opacity-80">
              Gmail neu verbinden, um den 7-Tage-Countdown zurückzusetzen.
            </span>
          </div>
          <a
            href="/api/gmail/authorize"
            className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs hover:bg-accent transition-colors"
          >
            Gmail neu verbinden
          </a>
        </div>
      )}

      {/* Fetch Detail / Eskalation bei Rot */}
      {(fetchCritical || expanded === 'fetch') && fetchStatus && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xs',
            fetchCritical
              ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200'
              : 'border-border/80 bg-card text-foreground',
          )}
        >
          <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0 text-xs sm:text-sm">
            <span className="font-semibold">{fetchStatus.processedCount} News verarbeitet</span>
            <span className="ml-2 opacity-80">aus {fetchStatus.articleCount} eingesammelten Artikeln</span>
            <span className="ml-2 text-xs opacity-75">
              · Newsletter-Abruf {fetchStatus.lastFetchLabel} · WebCrawl {fetchStatus.lastWebcrawlLabel}
              {fetchStatus.tz && fetchStatus.tz !== 'Europe/Berlin' ? ` · Tag nach ${fetchStatus.tz}` : ''}
            </span>
            {fetchCritical && (
              <div className="mt-1 text-xs opacity-90">
                {fetchStatus.articleCount === 0
                  ? 'Heute kam noch nichts herein — ohne Quellartikel fällt die Tagesanalyse aus und damit der Artikel.'
                  : 'Auffällig wenig verarbeitet — Tagesanalyse und Artikel sind gefährdet.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Health Detail / Eskalation bei Fehler oder Veraltet */}
      {(healthCritical || expanded === 'health') && healthStatus && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xs',
            healthStatus.state === 'fehler'
              ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200'
              : healthStatus.state === 'veraltet'
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
              : 'border-border/80 bg-card text-foreground',
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 min-w-0 text-xs sm:text-sm">
            {healthStatus.state === 'ok' && (
              <span>
                <span className="font-semibold">Alle Seiten erreichbar</span>
                <span className="ml-2 text-xs opacity-80">
                  {healthStatus.checked} geprüft · zuletzt {healthTime}
                </span>
              </span>
            )}
            {healthStatus.state === 'fehler' && (
              <>
                <span className="font-semibold">
                  {(healthStatus.failed?.length ?? 0) === 0 && healthStatus.cache && !healthStatus.cache.healthy
                    ? 'Geteilter Cache gestört — Seiten laufen, Egress steigt'
                    : `${healthStatus.failed?.length} von ${healthStatus.checked} Seiten nicht erreichbar`}
                </span>
                <span className="ml-2 text-xs opacity-80">zuletzt geprüft {healthTime}</span>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {healthStatus.failed?.slice(0, 5).map((f) => (
                    <li key={f.url} className="truncate">
                      <code>{f.url.replace(/^https?:\/\/[^/]+/, '')}</code>
                      {' — '}{f.error ? 'Netzwerkfehler' : `HTTP ${f.status}`}
                    </li>
                  ))}
                  {(healthStatus.failed?.length ?? 0) > 5 && (
                    <li>und {(healthStatus.failed?.length ?? 0) - 5} weitere</li>
                  )}
                  {healthStatus.cache && !healthStatus.cache.healthy && (
                    <li className="mt-1">Cache: {healthStatus.cache.error ?? 'antwortet nicht'}</li>
                  )}
                </ul>
              </>
            )}
            {healthStatus.state === 'veraltet' && (
              <span>
                <span className="font-semibold">Verfügbarkeitsprüfung veraltet</span>
                <span className="ml-2 text-xs opacity-90">
                  Letzter Lauf {healthTime}. Die Prüfung läuft alle vier Stunden.
                </span>
              </span>
            )}
            {healthStatus.state === 'unbekannt' && (
              <span className="text-xs">Verfügbarkeitsprüfung ist noch nicht gelaufen.</span>
            )}
          </div>
        </div>
      )}

      {/* Recent Comments Detail */}
      {expanded === 'comments' && commentsData && commentCount > 0 && (
        <div className="rounded-xl border border-blue-300/80 bg-blue-50/90 px-4 py-3 text-sm text-blue-900 shadow-xs dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-semibold text-xs sm:text-sm">
              {commentCount === 1 ? 'Ein neuer Take' : `${commentCount} neue Takes`} (Leser und Agenten) in den letzten {commentsData.hours} Stunden
            </span>
            <Link href="/admin/comments" className="text-xs font-medium underline underline-offset-2">
              Zur Moderation →
            </Link>
          </div>
          <ul className="space-y-1.5 text-xs">
            {commentsData.comments.map((c) => (
              <li key={c.id} className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {c.authorKind === 'agent' && <Bot className="h-3.5 w-3.5 translate-y-0.5" aria-label="Agent" />}
                  <span className="font-medium">
                    {c.authorKind === 'agent' ? (c.agentName ?? c.displayName) : c.displayName}
                  </span>
                  <span className="opacity-70">{commentTime(c.createdAt)}</span>
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
      )}
    </div>
  )
}
