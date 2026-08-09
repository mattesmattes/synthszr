'use client'

/**
 * Moderations-Queue für „Eure Takes".
 *
 * Default-Ansicht ist 'pending' — die Grenzfälle, die die KI-Vorprüfung einem
 * Menschen vorlegt. Die übrigen Tabs sind Nachschau (published) und
 * Rechenschaft (rejected: WAS wurde abgelehnt und warum — das Verdict der
 * Moderation steht dabei).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, MessageSquare, Check, X, Trash2 } from 'lucide-react'

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
}

const TABS = [
  { key: 'pending', label: 'Zur Freigabe' },
  { key: 'published', label: 'Veröffentlicht' },
  { key: 'rejected', label: 'Abgelehnt' },
  { key: 'pending_verify', label: 'Unbestätigt' },
] as const

export default function AdminCommentsPage() {
  const [tab, setTab] = useState<string>('pending')
  const [comments, setComments] = useState<AdminComment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (status: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/comments?status=${status}`, { credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setComments(data.comments ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(tab) }, [tab, load])

  async function act(id: string, action: 'approve' | 'reject' | 'delete') {
    setBusyId(id)
    try {
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
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusyId(null)
    }
  }

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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lade…
        </p>
      ) : comments.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          {tab === 'pending' ? 'Nichts zur Freigabe — die Queue ist leer.' : 'Keine Einträge.'}
        </p>
      ) : (
        <div className="space-y-4">
          {comments.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
                  <span>{c.display_name}</span>
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
                <p className="whitespace-pre-line text-sm">{c.body}</p>
                {c.moderation_reason && (
                  <p className="text-xs text-muted-foreground">
                    KI-Vorprüfung ({c.moderation_verdict}): {c.moderation_reason}
                  </p>
                )}
                <div className="flex gap-2">
                  {c.status !== 'published' && (
                    <Button size="sm" onClick={() => act(c.id, 'approve')} disabled={busyId === c.id}>
                      {busyId === c.id ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Check className="mr-1.5 h-3 w-3" />}
                      Freigeben
                    </Button>
                  )}
                  {c.status !== 'rejected' && (
                    <Button size="sm" variant="outline" onClick={() => act(c.id, 'reject')} disabled={busyId === c.id}>
                      <X className="mr-1.5 h-3 w-3" /> Ablehnen
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => act(c.id, 'delete')} disabled={busyId === c.id}>
                    <Trash2 className="mr-1.5 h-3 w-3" /> Löschen
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
