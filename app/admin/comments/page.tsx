'use client'

/**
 * Moderations-Seite für „Eure Takes".
 *
 * Tabs: Zur Freigabe (pending, Default), Letzte 3 Tage (recent — alle Takes
 * statusübergreifend), Veröffentlicht, Abgelehnt, Unbestätigt. Dazu eine
 * Volltextsuche über Kommentartext und Anzeigename.
 *
 * Pro Take: sichtbar machen (published) / unsichtbar machen (rejected),
 * bearbeiten (Text inline ändern), löschen (Hard-Delete, DSGVO).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, MessageSquare, Eye, EyeOff, Pencil, Trash2, Search, Check, X, Bot } from 'lucide-react'
import {
  useMultiSelect,
  MultiSelectBar,
  MultiSelectCheckbox,
  MULTI_SELECT_ROW_CLASS,
} from '@/components/admin/multi-select'
import { runBatched } from '@/lib/admin/run-batched'

interface AdminComment {
  id: string
  post_source: string
  post_id: string
  post_title: string | null
  display_name: string
  body: string
  section_headline: string | null
  status: string
  moderation_verdict: string | null
  moderation_reason: string | null
  created_at: string
  // Agenten-Takes (2026-10-25)
  author_kind?: 'reader' | 'agent' | null
  agent_name?: string | null
  agent_model?: string | null
  hold_reason?: string | null
  lang?: string | null
}

const HOLD_LABEL: Record<string, string> = {
  daily_cap: 'Tageslimit', relevance: 'Bezug', language: 'Sprache', section_full: 'Abschnitt voll',
}

const TABS = [
  { key: 'pending', label: 'Zur Freigabe' },
  { key: 'recent', label: 'Letzte 3 Tage' },
  { key: 'published', label: 'Veröffentlicht' },
  { key: 'rejected', label: 'Abgelehnt' },
  { key: 'pending_verify', label: 'Unbestätigt' },
] as const

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  published: { label: 'Sichtbar', cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' },
  pending: { label: 'Zur Freigabe', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
  rejected: { label: 'Unsichtbar', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' },
  pending_verify: { label: 'Unbestätigt', cls: 'bg-muted text-muted-foreground' },
  deleted: { label: 'Gelöscht', cls: 'bg-muted text-muted-foreground' },
}

export default function AdminCommentsPage() {
  const [tab, setTab] = useState<string>('pending')
  const [query, setQuery] = useState('')
  const [comments, setComments] = useState<AdminComment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)

  const visibleIds = useMemo(() => comments.map((c) => c.id), [comments])
  const selection = useMultiSelect(visibleIds, {
    resetKey: `${tab}|${query}`,
    disableEscape: editingId !== null,
  })
  const selectedComments = useMemo(() => {
    const byId = new Map(comments.map((c) => [c.id, c]))
    return selection.visibleSelectedIds
      .map((id) => byId.get(id))
      .filter((c): c is AdminComment => Boolean(c))
  }, [comments, selection.visibleSelectedIds])
  const approveIds = useMemo(
    () => selectedComments.filter((c) => c.status !== 'published').map((c) => c.id),
    [selectedComments],
  )
  const hideIds = useMemo(
    () => selectedComments.filter((c) => c.status === 'published').map((c) => c.id),
    [selectedComments],
  )
  const allSelectedIds = selection.visibleSelectedIds

  const load = useCallback(async (status: string, q: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ status })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/comments?${params.toString()}`, { credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setComments(data.comments ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [])

  // Tab-Wechsel lädt sofort; die Suche wird entprellt (300ms), damit nicht bei
  // jedem Tastendruck eine Abfrage losgeht.
  useEffect(() => {
    const t = setTimeout(() => { void load(tab, query) }, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [tab, query, load])

  async function act(id: string, action: 'approve' | 'hide' | 'delete' | 'edit', body?: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch('/api/admin/comments', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body !== undefined ? { id, action, body } : { id, action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
      setEditingId(null)
      // Neu laden: im „Letzte 3 Tage"-Tab bleibt der Eintrag mit neuem Status,
      // in Status-Tabs wandert er heraus — ein Reload hält beides korrekt.
      await load(tab, query)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

  async function bulkAct(ids: string[], action: 'approve' | 'hide' | 'delete') {
    if (ids.length === 0) return
    if (
      action === 'delete' &&
      !confirm(`${ids.length} Kommentar${ids.length === 1 ? '' : 'e'} endgültig löschen?`)
    ) {
      return
    }
    setBulkBusy(action)
    setError(null)
    try {
      const result = await runBatched(ids, async (id) => {
        const res = await fetch('/api/admin/comments', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, action }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? `HTTP ${res.status}`)
        }
      })
      if (result.failed.length > 0) {
        setError(`${result.failed.length} von ${ids.length} Aktionen fehlgeschlagen: ${result.failed[0].error}`)
      }
      if (result.succeeded > 0) {
        selection.clear()
        await load(tab, query)
      }
    } finally {
      setBulkBusy(null)
    }
  }

  const emptyLabel = useMemo(() => {
    if (query.trim()) return 'Keine Treffer für die Suche.'
    if (tab === 'pending') return 'Nichts zur Freigabe — die Queue ist leer.'
    if (tab === 'recent') return 'Keine Takes in den letzten 3 Tagen.'
    return 'Keine Einträge.'
  }, [tab, query])

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageSquare className="h-6 w-6" />
          Eure Takes — Moderation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leser-Kommentare unter den Artikeln. Die KI-Vorprüfung legt Grenzfälle
          hier zur Entscheidung vor; Sauberes ist bereits live.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setEditingId(null) }}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Takes durchsuchen (Text oder Name)…"
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade…
        </p>
      ) : comments.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-4">
          <MultiSelectBar
            selection={selection}
            totalVisible={comments.length}
            busy={bulkBusy !== null}
          >
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => void bulkAct(approveIds, 'approve')}
              disabled={bulkBusy !== null || approveIds.length === 0}
            >
              {bulkBusy === 'approve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              Sichtbar machen ({approveIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => void bulkAct(hideIds, 'hide')}
              disabled={bulkBusy !== null || hideIds.length === 0}
            >
              {bulkBusy === 'hide' ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
              Unsichtbar machen ({hideIds.length})
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={() => void bulkAct(allSelectedIds, 'delete')}
              disabled={bulkBusy !== null || allSelectedIds.length === 0}
            >
              {bulkBusy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Löschen ({allSelectedIds.length})
            </Button>
          </MultiSelectBar>
          {comments.map((c) => {
            const badge = STATUS_BADGE[c.status] ?? { label: c.status, cls: 'bg-muted text-muted-foreground' }
            const isPublished = c.status === 'published'
            const isEditing = editingId === c.id
            const isBusy = busyId === c.id
            const isSelected = selection.isSelected(c.id)
            return (
              <Card
                key={c.id}
                {...selection.rowSelectionProps(c.id)}
                className={isSelected ? MULTI_SELECT_ROW_CLASS : undefined}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <MultiSelectCheckbox
                      checked={isSelected}
                      onToggle={(shiftKey) => selection.toggle(c.id, shiftKey)}
                      ariaLabel={`Kommentar auswählen: ${c.agent_name ?? c.display_name}`}
                    />
                    {c.author_kind === 'agent' ? (
                      <>
                        <Bot className="h-3.5 w-3.5 translate-y-0.5 text-muted-foreground" aria-label="Agent" />
                        <span>{c.agent_name ?? c.display_name}</span>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                          Agent{c.agent_model ? ` · ${c.agent_model}` : ''}
                        </span>
                      </>
                    ) : (
                      <span>{c.display_name}</span>
                    )}
                    {c.hold_reason && (
                      <span className="rounded-full border border-amber-300 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:text-amber-200">
                        wartet: {HOLD_LABEL[c.hold_reason] ?? c.hold_reason}
                      </span>
                    )}
                    {c.lang && <span className="font-mono text-[10px] uppercase text-muted-foreground">{c.lang}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString('de-DE')}
                    </span>
                    {c.post_title && (
                      <span className="text-xs text-muted-foreground">— {c.post_title.slice(0, 60)}</span>
                    )}
                    {c.section_headline && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        zu: {c.section_headline.slice(0, 50)}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={4}
                        maxLength={4000}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => act(c.id, 'edit', editBody)} disabled={isBusy || !editBody.trim()}>
                          {isBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
                          Speichern
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={isBusy}>
                          <X className="mr-1.5 h-3 w-3" /> Abbrechen
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-line text-sm">{c.body}</p>
                  )}

                  {c.moderation_reason && !isEditing && (
                    <p className="text-xs text-muted-foreground">
                      KI-Vorprüfung ({c.moderation_verdict}): {c.moderation_reason}
                    </p>
                  )}

                  {!isEditing && (
                    <div className="flex flex-wrap gap-2">
                      {isPublished ? (
                        <Button size="sm" variant="outline" onClick={() => act(c.id, 'hide')} disabled={isBusy}>
                          <EyeOff className="mr-1.5 h-3 w-3" /> Unsichtbar machen
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => act(c.id, 'approve')} disabled={isBusy}>
                          {isBusy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Eye className="mr-1.5 h-3 w-3" />}
                          Sichtbar machen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingId(c.id); setEditBody(c.body) }}
                        disabled={isBusy}
                      >
                        <Pencil className="mr-1.5 h-3 w-3" /> Bearbeiten
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act(c.id, 'delete')} disabled={isBusy}>
                        <Trash2 className="mr-1.5 h-3 w-3" /> Löschen
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
