'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ListTodo,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Trash2,
  Play,
  RefreshCw,
  AlertTriangle,
  Eye,
  PieChart,
  Plus,
  Calendar,
  Database
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface QueueStats {
  pending: number
  selected: number
  used: number
  expired: number
  skipped: number
  total: number
}

interface SourceDistribution {
  source_identifier: string
  source_display_name: string | null
  item_count: number
  pending_count: number
  used_count: number
  percentage_of_total: number
}

interface QueueItem {
  id: string
  title: string
  excerpt: string | null
  source_identifier: string
  source_display_name: string | null
  source_url: string | null
  synthesis_score: number
  relevance_score: number
  uniqueness_score: number
  total_score: number
  status: string
  queued_at: string
  expires_at: string
  skip_reason: string | null
}

interface BalancedSelection {
  id: string
  title: string
  source_identifier: string
  source_display_name: string | null
  total_score: number
  selection_rank: number
}

interface DailyRepoItem {
  id: string
  title: string
  source_email: string | null
  source_url: string | null
  newsletter_date: string
  collected_at: string
}

export default function NewsQueuePage() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [distribution, setDistribution] = useState<SourceDistribution[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [balancedSelection, setBalancedSelection] = useState<BalancedSelection[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [viewingItem, setViewingItem] = useState<QueueItem | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showBalancedDialog, setShowBalancedDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importDate, setImportDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [repoItems, setRepoItems] = useState<DailyRepoItem[]>([])
  const [selectedRepoItems, setSelectedRepoItems] = useState<Set<string>>(new Set())
  const [loadingRepo, setLoadingRepo] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, distRes, itemsRes] = await Promise.all([
        fetch('/api/admin/news-queue?action=stats'),
        fetch('/api/admin/news-queue?action=distribution'),
        fetch(`/api/admin/news-queue?action=list&status=${statusFilter}&limit=100`)
      ])

      if (statsRes.ok) setStats(await statsRes.json())
      if (distRes.ok) setDistribution(await distRes.json())
      if (itemsRes.ok) {
        const data = await itemsRes.json()
        setItems(data.items || [])
      }
    } catch (error) {
      console.error('Failed to fetch queue data:', error)
    }
    setLoading(false)
  }, [statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const fetchBalancedSelection = async () => {
    try {
      const res = await fetch('/api/admin/news-queue?action=balanced&max=10')
      if (res.ok) {
        const data = await res.json()
        setBalancedSelection(data)
        setShowBalancedDialog(true)
      }
    } catch (error) {
      console.error('Failed to fetch balanced selection:', error)
    }
  }

  const fetchRepoItems = async (date: string) => {
    setLoadingRepo(true)
    setSelectedRepoItems(new Set())
    try {
      const res = await fetch(`/api/admin/daily-repo?date=${date}`)
      if (res.ok) {
        const data = await res.json()
        setRepoItems(data.items || [])
      } else {
        setRepoItems([])
      }
    } catch (error) {
      console.error('Failed to fetch repo items:', error)
      setRepoItems([])
    }
    setLoadingRepo(false)
  }

  const handleImportToQueue = async () => {
    if (selectedRepoItems.size === 0) return
    setActionLoading('import')
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-from-repo',
          itemIds: Array.from(selectedRepoItems)
        })
      })
      if (res.ok) {
        const data = await res.json()
        alert(`${data.added} Items hinzugefügt, ${data.skipped} übersprungen`)
        setShowImportDialog(false)
        setSelectedRepoItems(new Set())
        fetchData()
      }
    } catch (error) {
      console.error('Import failed:', error)
    }
    setActionLoading(null)
  }

  const toggleRepoSelect = (id: string) => {
    const newSelected = new Set(selectedRepoItems)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedRepoItems(newSelected)
  }

  const selectAllRepo = () => {
    if (selectedRepoItems.size === repoItems.length) {
      setSelectedRepoItems(new Set())
    } else {
      setSelectedRepoItems(new Set(repoItems.map(i => i.id)))
    }
  }

  const handleExpire = async () => {
    setActionLoading('expire')
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'expire' })
      })
      if (res.ok) {
        const data = await res.json()
        alert(`${data.expired} Items abgelaufen`)
        fetchData()
      }
    } catch (error) {
      console.error('Expire failed:', error)
    }
    setActionLoading(null)
  }

  const handleSkip = async (reason: string) => {
    if (selectedItems.size === 0) return
    setActionLoading('skip')
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'skip',
          itemIds: Array.from(selectedItems),
          reason
        })
      })
      if (res.ok) {
        setSelectedItems(new Set())
        fetchData()
      }
    } catch (error) {
      console.error('Skip failed:', error)
    }
    setActionLoading(null)
  }

  const handleSelect = async () => {
    if (selectedItems.size === 0) return
    setActionLoading('select')
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          itemIds: Array.from(selectedItems)
        })
      })
      if (res.ok) {
        const data = await res.json()
        if (data.error) {
          alert(`Fehler: ${data.error}`)
        } else {
          setSelectedItems(new Set())
          fetchData()
        }
      }
    } catch (error) {
      console.error('Select failed:', error)
    }
    setActionLoading(null)
  }

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedItems(newSelected)
  }

  const selectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(items.map(i => i.id)))
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500'
      case 'selected': return 'bg-blue-500'
      case 'used': return 'bg-green-500'
      case 'expired': return 'bg-gray-500'
      case 'skipped': return 'bg-orange-500'
      default: return 'bg-gray-400'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending': return <Clock className="h-3 w-3" />
      case 'selected': return <Play className="h-3 w-3" />
      case 'used': return <CheckCircle2 className="h-3 w-3" />
      case 'expired': return <XCircle className="h-3 w-3" />
      case 'skipped': return <SkipForward className="h-3 w-3" />
      default: return null
    }
  }

  const formatTimeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return 'vor wenigen Minuten'
    if (hours < 24) return `vor ${hours}h`
    const days = Math.floor(hours / 24)
    return `vor ${days}d`
  }

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          News Queue
        </h1>
        <p className="text-xs text-muted-foreground">
          Quellen-diversifizierte News-Auswahl (max 30% pro Quelle)
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('pending')}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Pending</div>
                <Clock className="h-4 w-4 text-yellow-500" />
              </div>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('selected')}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Selected</div>
                <Play className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{stats.selected}</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('used')}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Used</div>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <div className="text-2xl font-bold">{stats.used}</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('expired')}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Expired</div>
                <XCircle className="h-4 w-4 text-gray-500" />
              </div>
              <div className="text-2xl font-bold">{stats.expired}</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('skipped')}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Skipped</div>
                <SkipForward className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-2xl font-bold">{stats.skipped}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Source Distribution */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                Quellen-Verteilung
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              {distribution.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Keine Daten
                </p>
              ) : (
                <div className="space-y-3">
                  {distribution.map((source) => (
                    <div key={source.source_identifier}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="truncate max-w-[150px]">
                          {source.source_display_name || source.source_identifier}
                        </span>
                        <span className={`font-mono ${source.percentage_of_total > 30 ? 'text-red-500 font-bold' : ''}`}>
                          {source.percentage_of_total}%
                        </span>
                      </div>
                      <Progress
                        value={source.percentage_of_total}
                        className={`h-2 ${source.percentage_of_total > 30 ? '[&>div]:bg-red-500' : ''}`}
                      />
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                        <span>{source.pending_count} pending</span>
                        <span>{source.used_count} used</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {distribution.some(d => d.percentage_of_total > 30) && (
                <div className="mt-4 p-2 bg-red-500/10 rounded text-xs text-red-600 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Eine oder mehrere Quellen überschreiten das 30%-Limit</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card className="mt-4">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm">Aktionen</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              <Button
                size="sm"
                variant="default"
                className="w-full justify-start text-xs"
                onClick={() => {
                  setShowImportDialog(true)
                  fetchRepoItems(importDate)
                }}
              >
                <Plus className="h-3 w-3 mr-2" />
                Aus Daily Repo importieren
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start text-xs"
                onClick={fetchBalancedSelection}
              >
                <Play className="h-3 w-3 mr-2" />
                Balancierte Auswahl anzeigen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start text-xs"
                onClick={handleExpire}
                disabled={actionLoading === 'expire'}
              >
                {actionLoading === 'expire' ? (
                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3 mr-2" />
                )}
                Abgelaufene Items entfernen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start text-xs"
                onClick={fetchData}
              >
                <RefreshCw className="h-3 w-3 mr-2" />
                Aktualisieren
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Queue Items */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge variant={statusFilter === 'pending' ? 'default' : 'outline'} className="text-xs cursor-pointer" onClick={() => setStatusFilter('pending')}>
                Pending
              </Badge>
              <Badge variant={statusFilter === 'selected' ? 'default' : 'outline'} className="text-xs cursor-pointer" onClick={() => setStatusFilter('selected')}>
                Selected
              </Badge>
              <Badge variant={statusFilter === 'used' ? 'default' : 'outline'} className="text-xs cursor-pointer" onClick={() => setStatusFilter('used')}>
                Used
              </Badge>
            </div>
            {selectedItems.size > 0 && statusFilter === 'pending' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedItems.size} ausgewählt</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleSelect}
                  disabled={actionLoading === 'select'}
                >
                  {actionLoading === 'select' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Für Artikel auswählen'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    const reason = prompt('Grund für Skip:')
                    if (reason) handleSkip(reason)
                  }}
                  disabled={actionLoading === 'skip'}
                >
                  Skip
                </Button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ListTodo className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Keine Items mit Status "{statusFilter}"</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                {statusFilter === 'pending' && (
                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                    <input
                      type="checkbox"
                      checked={selectedItems.size === items.length && items.length > 0}
                      onChange={selectAll}
                      className="rounded"
                    />
                    <span className="text-xs text-muted-foreground">Alle auswählen</span>
                  </div>
                )}
                <div className="divide-y max-h-[60vh] overflow-y-auto">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors ${
                        selectedItems.has(item.id) ? 'bg-primary/5' : ''
                      }`}
                    >
                      {statusFilter === 'pending' && (
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded shrink-0"
                        />
                      )}
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStatusColor(item.status)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{item.title}</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate max-w-[120px]">
                            {item.source_display_name || item.source_identifier}
                          </span>
                          <span>{formatTimeAgo(item.queued_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
                          {item.total_score.toFixed(1)}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setViewingItem(item)}
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* View Item Dialog */}
      <Dialog open={!!viewingItem} onOpenChange={() => setViewingItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              {viewingItem && getStatusIcon(viewingItem.status)}
              <span className="truncate">{viewingItem?.title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {viewingItem?.source_display_name || viewingItem?.source_identifier}
            </DialogDescription>
          </DialogHeader>
          {viewingItem && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-muted rounded">
                  <div className="text-muted-foreground">Synthesis</div>
                  <div className="font-mono font-bold">{viewingItem.synthesis_score.toFixed(1)}</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="text-muted-foreground">Relevance</div>
                  <div className="font-mono font-bold">{viewingItem.relevance_score.toFixed(1)}</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="text-muted-foreground">Uniqueness</div>
                  <div className="font-mono font-bold">{viewingItem.uniqueness_score.toFixed(1)}</div>
                </div>
              </div>
              <div className="p-2 bg-muted rounded">
                <div className="text-muted-foreground mb-1">Total Score</div>
                <div className="font-mono font-bold text-lg">{viewingItem.total_score.toFixed(1)}</div>
                <div className="text-[10px] text-muted-foreground">
                  = 0.4×Synthesis + 0.3×Relevance + 0.3×Uniqueness
                </div>
              </div>
              {viewingItem.excerpt && (
                <div>
                  <div className="text-muted-foreground mb-1">Excerpt</div>
                  <p className="text-sm">{viewingItem.excerpt}</p>
                </div>
              )}
              {viewingItem.source_url && (
                <a
                  href={viewingItem.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline block truncate"
                >
                  {viewingItem.source_url}
                </a>
              )}
              {viewingItem.skip_reason && (
                <div className="p-2 bg-orange-500/10 rounded">
                  <div className="text-orange-600 font-medium">Skip-Grund:</div>
                  <p>{viewingItem.skip_reason}</p>
                </div>
              )}
              <div className="text-muted-foreground">
                Queued: {new Date(viewingItem.queued_at).toLocaleString('de-DE')}
                <br />
                Expires: {new Date(viewingItem.expires_at).toLocaleString('de-DE')}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Balanced Selection Dialog */}
      <Dialog open={showBalancedDialog} onOpenChange={setShowBalancedDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Balancierte Auswahl (Top 10)</DialogTitle>
            <DialogDescription className="text-xs">
              Automatisch ausgewählt unter Beachtung des 30%-Limits
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {balancedSelection.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs">
                <span className="font-mono text-muted-foreground w-5">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.title}</div>
                  <div className="text-muted-foreground truncate">
                    {item.source_display_name || item.source_identifier}
                  </div>
                </div>
                <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                  {item.total_score.toFixed(1)}
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={async () => {
                const itemIds = balancedSelection.map(i => i.id)
                const res = await fetch('/api/admin/news-queue', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'select', itemIds })
                })
                if (res.ok) {
                  setShowBalancedDialog(false)
                  fetchData()
                } else {
                  const data = await res.json()
                  alert(data.error || 'Fehler bei Auswahl')
                }
              }}
            >
              Alle auswählen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from Daily Repo Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Aus Daily Repo importieren
            </DialogTitle>
            <DialogDescription className="text-xs">
              Wähle Items aus dem Daily Repo, die zur Queue hinzugefügt werden sollen
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={importDate}
              onChange={(e) => {
                setImportDate(e.target.value)
                fetchRepoItems(e.target.value)
              }}
              className="rounded border px-2 py-1 text-xs"
            />
            <span className="text-xs text-muted-foreground">
              {repoItems.length} Items gefunden
            </span>
          </div>

          <div className="flex-1 overflow-y-auto border rounded">
            {loadingRepo ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : repoItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Database className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-xs">Keine Items für dieses Datum</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 sticky top-0">
                  <input
                    type="checkbox"
                    checked={selectedRepoItems.size === repoItems.length && repoItems.length > 0}
                    onChange={selectAllRepo}
                    className="rounded"
                  />
                  <span className="text-xs text-muted-foreground">
                    Alle auswählen ({selectedRepoItems.size}/{repoItems.length})
                  </span>
                </div>
                <div className="divide-y">
                  {repoItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-xs ${
                        selectedRepoItems.has(item.id) ? 'bg-primary/5' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRepoItems.has(item.id)}
                        onChange={() => toggleRepoSelect(item.id)}
                        className="rounded shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{item.title}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {item.source_email || item.source_url || 'Unbekannte Quelle'}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(item.collected_at).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowImportDialog(false)}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={handleImportToQueue}
              disabled={selectedRepoItems.size === 0 || actionLoading === 'import'}
            >
              {actionLoading === 'import' ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-2" />
              )}
              {selectedRepoItems.size} Items importieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
