'use client'

import { useEffect, useState } from 'react'
import { Users, Mail, CheckCircle, XCircle, Clock, Trash2, Loader2, Download, Search, UserCheck, Pencil, Check, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Subscriber {
  id: string
  email: string
  name: string | null
  status: 'pending' | 'active' | 'unsubscribed' | 'bounced'
  confirmed_at: string | null
  created_at: string
  unsubscribed_at: string | null
}

interface SubscribersResponse {
  subscribers: Subscriber[]
  total: number
  page: number
  limit: number
  counts: {
    all: number
    pending: number
    active: number
    unsubscribed: number
    bounced: number
  }
}

type StatusFilter = 'all' | 'pending' | 'active' | 'unsubscribed' | 'bounced'

export default function SubscribersPage() {
  const [data, setData] = useState<SubscribersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchSubscribers()
  }, [statusFilter, searchQuery])

  async function fetchSubscribers() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: statusFilter })
      if (searchQuery) params.set('search', searchQuery)
      const res = await fetch(`/api/admin/subscribers?${params}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (error) {
      console.error('Fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  async function deleteSubscriber(id: string) {
    if (!confirm('Subscriber wirklich löschen?')) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/subscribers?id=${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        fetchSubscribers()
      }
    } catch (error) {
      console.error('Delete error:', error)
    } finally {
      setDeletingId(null)
    }
  }

  async function activateSubscriber(id: string) {
    setActivatingId(id)
    try {
      const res = await fetch('/api/admin/subscribers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'active' }),
      })
      if (res.ok) {
        fetchSubscribers()
      } else {
        const error = await res.json()
        alert(error.error || 'Aktivierung fehlgeschlagen')
      }
    } catch (error) {
      console.error('Activate error:', error)
    } finally {
      setActivatingId(null)
    }
  }

  async function saveEmail(id: string) {
    const trimmed = editEmail.trim().toLowerCase()
    if (!trimmed) return
    setSavingEmail(true)
    try {
      const res = await fetch('/api/admin/subscribers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, email: trimmed }),
      })
      if (res.ok) {
        setEditingId(null)
        fetchSubscribers()
      } else {
        const error = await res.json()
        alert(error.error || 'E-Mail-Update fehlgeschlagen')
      }
    } catch (error) {
      console.error('Save email error:', error)
    } finally {
      setSavingEmail(false)
    }
  }

  function exportCSV() {
    if (!data?.subscribers) return

    const headers = ['Email', 'Name', 'Status', 'Angemeldet', 'Bestätigt']
    const rows = data.subscribers.map(s => [
      s.email,
      s.name || '',
      s.status,
      new Date(s.created_at).toLocaleString('de-DE'),
      s.confirmed_at ? new Date(s.confirmed_at).toLocaleString('de-DE') : '',
    ])

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subscribers-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusIcon = (status: Subscriber['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="h-3 w-3 text-green-500" />
      case 'pending':
        return <Clock className="h-3 w-3 text-yellow-500" />
      case 'unsubscribed':
        return <XCircle className="h-3 w-3 text-gray-500" />
      case 'bounced':
        return <XCircle className="h-3 w-3 text-red-500" />
    }
  }

  const statusLabel = (status: Subscriber['status']) => {
    switch (status) {
      case 'active': return 'Aktiv'
      case 'pending': return 'Ausstehend'
      case 'unsubscribed': return 'Abgemeldet'
      case 'bounced': return 'Bounced'
    }
  }

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'active', label: 'Aktiv' },
    { key: 'pending', label: 'Ausstehend' },
    { key: 'unsubscribed', label: 'Abgemeldet' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5" />
            Newsletter-Subscriber
          </h1>
          <p className="text-xs text-muted-foreground">
            {data?.counts.active || 0} aktive Subscriber
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5 text-xs h-7">
          <Download className="h-3 w-3" />
          Export CSV
        </Button>
      </div>

      {/* Stats */}
      {data?.counts && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{data.counts.active}</div>
              <div className="text-[10px] text-muted-foreground">Aktiv</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">{data.counts.pending}</div>
              <div className="text-[10px] text-muted-foreground">Ausstehend</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-gray-600">{data.counts.unsubscribed}</div>
              <div className="text-[10px] text-muted-foreground">Abgemeldet</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold">{data.counts.all}</div>
              <div className="text-[10px] text-muted-foreground">Gesamt</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="E-Mail suchen..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-8 text-sm"
        />
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-4">
        {filterButtons.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={statusFilter === key ? 'default' : 'outline'}
            onClick={() => setStatusFilter(key)}
            className="text-xs h-7"
          >
            {label}
            {data?.counts && key !== 'all' && (
              <span className="ml-1 opacity-70">({data.counts[key]})</span>
            )}
          </Button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.subscribers || data.subscribers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Keine Subscriber gefunden
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {data.subscribers.map((subscriber) => (
                <div
                  key={subscriber.id}
                  className="group flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="shrink-0">
                    {statusIcon(subscriber.status)}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingId === subscriber.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEmail(subscriber.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="h-6 text-sm px-2"
                          autoFocus
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => saveEmail(subscriber.id)}
                          disabled={savingEmail}
                          className="h-6 w-6 text-green-600 shrink-0"
                        >
                          {savingEmail ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingId(null)}
                          className="h-6 w-6 shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">{subscriber.email}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => { setEditingId(subscriber.id); setEditEmail(subscriber.email) }}
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      Angemeldet: {new Date(subscriber.created_at).toLocaleString('de-DE')}
                      {subscriber.confirmed_at && (
                        <> · Bestätigt: {new Date(subscriber.confirmed_at).toLocaleString('de-DE')}</>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={subscriber.status === 'active' ? 'default' : 'secondary'}
                    className="text-[10px] shrink-0"
                  >
                    {statusLabel(subscriber.status)}
                  </Badge>
                  {subscriber.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => activateSubscriber(subscriber.id)}
                      disabled={activatingId === subscriber.id}
                      className="h-6 w-6 text-green-600 hover:text-green-700 shrink-0"
                      title="Manuell aktivieren"
                    >
                      {activatingId === subscriber.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <UserCheck className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteSubscriber(subscriber.id)}
                    disabled={deletingId === subscriber.id}
                    className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                  >
                    {deletingId === subscriber.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
