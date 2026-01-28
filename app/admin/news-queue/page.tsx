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
  Database,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  X
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

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
  selected_count: number
  used_count: number
  percentage_of_total: number
}

interface QueueItem {
  id: string
  title: string
  excerpt: string | null
  content: string | null
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
  email_received_at: string | null
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

interface SynthesisCandidateItem {
  id: string
  source_item_id: string
  title: string
  source_email: string | null
  source_url: string | null
  newsletter_date: string | null
  originality_score: number
  relevance_score: number
  synthesis_type: string
  reasoning: string | null
  digest_id: string
  created_at: string
}

const PAGE_SIZE = 100

export default function NewsQueuePage() {
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [distribution, setDistribution] = useState<SourceDistribution[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [balancedSelection, setBalancedSelection] = useState<BalancedSelection[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [viewingItem, setViewingItem] = useState<QueueItem | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showBalancedDialog, setShowBalancedDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importDate, setImportDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [candidateItems, setCandidateItems] = useState<SynthesisCandidateItem[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [loadingCandidates, setLoadingCandidates] = useState(false)

  // Embedding status
  const [embeddingStatus, setEmbeddingStatus] = useState<{
    total: number
    withEmbeddings: number
    missingEmbeddings: number
    percentComplete: number
  } | null>(null)
  const [embeddingLoading, setEmbeddingLoading] = useState(true)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{
    success: boolean
    message: string
    processed?: number
    remaining?: number
  } | null>(null)

  const fetchData = useCallback(async (page = currentPage) => {
    setLoading(true)
    try {
      const offset = page * PAGE_SIZE
      const [statsRes, distRes, itemsRes] = await Promise.all([
        fetch('/api/admin/news-queue?action=stats'),
        fetch('/api/admin/news-queue?action=distribution'),
        fetch(`/api/admin/news-queue?action=list&status=${statusFilter}&limit=${PAGE_SIZE}&offset=${offset}`)
      ])

      if (statsRes.ok) setStats(await statsRes.json())
      if (distRes.ok) setDistribution(await distRes.json())
      if (itemsRes.ok) {
        const data = await itemsRes.json()
        setItems(data.items || [])
        setTotalItems(data.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch queue data:', error)
    }
    setLoading(false)
  }, [statusFilter, currentPage])

  useEffect(() => {
    fetchData()
    fetchEmbeddingStatus()
  }, [fetchData])

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(0)
  }, [statusFilter])

  async function fetchEmbeddingStatus() {
    setEmbeddingLoading(true)
    try {
      const response = await fetch('/api/admin/backfill-embeddings')
      if (response.ok) {
        const data = await response.json()
        setEmbeddingStatus(data)
      }
    } catch (error) {
      console.error('Failed to fetch embedding status:', error)
    } finally {
      setEmbeddingLoading(false)
    }
  }

  async function runBackfill() {
    setBackfillRunning(true)
    setBackfillResult(null)
    try {
      const response = await fetch('/api/admin/backfill-embeddings?batchSize=200', { method: 'POST' })
      const data = await response.json()
      setBackfillResult({
        success: data.success,
        message: data.message,
        processed: data.processed,
        remaining: data.remaining,
      })
      // Refresh status after backfill
      fetchEmbeddingStatus()
    } catch (error) {
      setBackfillResult({
        success: false,
        message: 'Netzwerkfehler beim Backfill',
      })
    } finally {
      setBackfillRunning(false)
    }
  }

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

  const fetchCandidates = async (date: string) => {
    setLoadingCandidates(true)
    setSelectedCandidates(new Set())
    try {
      const res = await fetch(`/api/admin/synthesis-candidates?date=${date}`)
      if (res.ok) {
        const data = await res.json()
        setCandidateItems(data.items || [])
      } else {
        setCandidateItems([])
      }
    } catch (error) {
      console.error('Failed to fetch synthesis candidates:', error)
      setCandidateItems([])
    }
    setLoadingCandidates(false)
  }

  const handleImportToQueue = async () => {
    if (selectedCandidates.size === 0) return
    setActionLoading('import')
    try {
      // Get selected candidates with their scores
      const selected = candidateItems.filter(c => selectedCandidates.has(c.id))
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-from-synthesis',
          candidates: selected.map(c => ({
            source_item_id: c.source_item_id,
            title: c.title,
            source_identifier: c.source_email || c.source_url || 'unknown',
            source_url: c.source_url,
            originality_score: c.originality_score,
            relevance_score: c.relevance_score
          }))
        })
      })
      if (res.ok) {
        const data = await res.json()
        alert(`${data.added} Items hinzugefügt, ${data.skipped} übersprungen`)
        setShowImportDialog(false)
        setSelectedCandidates(new Set())
        fetchData()
      }
    } catch (error) {
      console.error('Import failed:', error)
    }
    setActionLoading(null)
  }

  const toggleCandidateSelect = (id: string) => {
    const newSelected = new Set(selectedCandidates)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedCandidates(newSelected)
  }

  const selectAllCandidates = () => {
    if (selectedCandidates.size === candidateItems.length) {
      setSelectedCandidates(new Set())
    } else {
      setSelectedCandidates(new Set(candidateItems.map(i => i.id)))
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

  const handleUnselect = async (itemId: string) => {
    setActionLoading(`unselect-${itemId}`)
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-item',
          itemId
        })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        // Remove item from local state immediately for better UX
        setItems(prev => prev.filter(item => item.id !== itemId))
        // Then refresh to get accurate data
        await fetchData()
      } else {
        console.error('Unselect failed:', data.error)
        alert(`Fehler: ${data.error || 'Unbekannter Fehler'}`)
      }
    } catch (error) {
      console.error('Unselect failed:', error)
      alert('Netzwerkfehler beim Zurücksetzen')
    }
    setActionLoading(null)
  }

  // Select a single item immediately (moves from pending to selected)
  const handleSelectSingle = async (itemId: string) => {
    setActionLoading(`select-${itemId}`)
    try {
      const res = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'select',
          itemIds: [itemId]
        })
      })
      const data = await res.json()
      if (res.ok && !data.error) {
        // Remove item from local state immediately for better UX
        setItems(prev => prev.filter(item => item.id !== itemId))
        // Update stats locally
        if (stats) {
          setStats({ ...stats, pending: stats.pending - 1, selected: stats.selected + 1 })
        }
      } else {
        alert(`Fehler: ${data.error || 'Unbekannter Fehler'}`)
      }
    } catch (error) {
      console.error('Select failed:', error)
      alert('Netzwerkfehler beim Auswählen')
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

  // Get synthesis score gradient color: cyan (low) → neon yellow (mid) → neon orange (high)
  const getSynthesisScoreColor = (score: number, allScores: number[]) => {
    if (allScores.length === 0) return 'transparent'

    const minScore = Math.min(...allScores)
    const maxScore = Math.max(...allScores)

    if (minScore === maxScore) return '#CCFF00' // neon yellow if all same

    // Normalize to 0-1 range
    const normalized = (score - minScore) / (maxScore - minScore)

    // Three-stop gradient: cyan (0) → neon yellow (0.5) → neon orange (1)
    // Cyan: #00FFFF, Neon Yellow: #CCFF00, Neon Orange: #FF6B00
    if (normalized <= 0.5) {
      // Interpolate from cyan to neon yellow
      const t = normalized * 2 // 0 to 1
      const r = Math.round(0 + t * 204)    // 0 → 204
      const g = Math.round(255 - t * 0)     // 255 → 255
      const b = Math.round(255 - t * 255)   // 255 → 0
      return `rgb(${r}, ${g}, ${b})`
    } else {
      // Interpolate from neon yellow to neon orange
      const t = (normalized - 0.5) * 2 // 0 to 1
      const r = Math.round(204 + t * 51)   // 204 → 255
      const g = Math.round(255 - t * 148)  // 255 → 107
      const b = Math.round(0)              // 0 → 0
      return `rgb(${r}, ${g}, ${b})`
    }
  }

  // Extract all synthesis scores for gradient calculation (sorting is now server-side)
  const allSynthesisScores = items.map(item => item.synthesis_score)

  // Group items by import batch (items queued within 10 minutes of each other)
  // This clusters items from the same daily digest import run together
  const groupedItems = items.reduce((groups, item) => {
    const date = new Date(item.queued_at)
    // Round to 10-minute intervals to cluster import batches
    const roundedMinutes = Math.floor(date.getMinutes() / 10) * 10
    const batchDate = new Date(date)
    batchDate.setMinutes(roundedMinutes, 0, 0)

    // Format: "Mo 27.01. 14:30" (import batch timestamp)
    const batchKey = batchDate.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit'
    }) + ' ' + batchDate.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    })

    if (!groups[batchKey]) {
      groups[batchKey] = []
    }
    groups[batchKey].push(item)
    return groups
  }, {} as Record<string, QueueItem[]>)

  // Sort groups by timestamp (newest first) and items within each group by total_score
  const importBatches = Object.entries(groupedItems)
    .sort((a, b) => {
      // Parse the batch keys back to dates for sorting
      const dateA = new Date(items.find(i => {
        const d = new Date(i.queued_at)
        const rounded = Math.floor(d.getMinutes() / 10) * 10
        d.setMinutes(rounded, 0, 0)
        return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' +
               d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) === a[0]
      })?.queued_at || 0)
      const dateB = new Date(items.find(i => {
        const d = new Date(i.queued_at)
        const rounded = Math.floor(d.getMinutes() / 10) * 10
        d.setMinutes(rounded, 0, 0)
        return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' +
               d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) === b[0]
      })?.queued_at || 0)
      return dateB.getTime() - dateA.getTime()
    })
    .map(([key, groupItems]) => [
      key,
      groupItems.sort((a, b) => b.total_score - a.total_score)
    ] as [string, QueueItem[]])

  return (
    <Collapsible open={showSidebar} onOpenChange={setShowSidebar}>
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          News Queue
        </h1>
        <p className="text-xs text-muted-foreground">
          Quellen-diversifizierte News-Auswahl (max 30% pro Quelle) • Wird automatisch durch Synthese-Pipeline befüllt
        </p>
        {/* Action Buttons - horizontal row */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => {
              setShowImportDialog(true)
              fetchCandidates(importDate)
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Manuell nachimportieren
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={fetchBalancedSelection}
          >
            <Play className="h-3 w-3 mr-1" />
            Balancierte Auswahl anzeigen
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={handleExpire}
            disabled={actionLoading === 'expire'}
          >
            {actionLoading === 'expire' ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" />
            )}
            Abgelaufene Items entfernen
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => fetchData()}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Aktualisieren
          </Button>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs">
              <PieChart className="h-3 w-3 mr-1" />
              Quellen & Embeddings
              {distribution.some(d => d.percentage_of_total > 30) && (
                <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-1">!</Badge>
              )}
              <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${showSidebar ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>

      {/* Stats Cards / Tab Navigation */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'pending' ? 'ring-2 ring-yellow-500 bg-yellow-500/5' : 'hover:bg-muted/50'}`}
            onClick={() => setStatusFilter('pending')}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className={`text-xs ${statusFilter === 'pending' ? 'text-yellow-600 font-medium' : 'text-muted-foreground'}`}>Pending</div>
                <Clock className="h-4 w-4 text-yellow-500" />
              </div>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'selected' ? 'ring-2 ring-blue-500 bg-blue-500/5' : 'hover:bg-muted/50'}`}
            onClick={() => setStatusFilter('selected')}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className={`text-xs ${statusFilter === 'selected' ? 'text-blue-600 font-medium' : 'text-muted-foreground'}`}>Selected</div>
                <Play className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-2xl font-bold">{stats.selected}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'used' ? 'ring-2 ring-green-500 bg-green-500/5' : 'hover:bg-muted/50'}`}
            onClick={() => setStatusFilter('used')}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className={`text-xs ${statusFilter === 'used' ? 'text-green-600 font-medium' : 'text-muted-foreground'}`}>Used</div>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <div className="text-2xl font-bold">{stats.used}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'expired' ? 'ring-2 ring-gray-500 bg-gray-500/5' : 'hover:bg-muted/50'}`}
            onClick={() => setStatusFilter('expired')}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className={`text-xs ${statusFilter === 'expired' ? 'text-gray-600 font-medium' : 'text-muted-foreground'}`}>Expired</div>
                <XCircle className="h-4 w-4 text-gray-500" />
              </div>
              <div className="text-2xl font-bold">{stats.expired}</div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'skipped' ? 'ring-2 ring-orange-500 bg-orange-500/5' : 'hover:bg-muted/50'}`}
            onClick={() => setStatusFilter('skipped')}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className={`text-xs ${statusFilter === 'skipped' ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>Skipped</div>
                <SkipForward className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-2xl font-bold">{stats.skipped}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Collapsible Content: Source Distribution & Embeddings */}
      <CollapsibleContent className="mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Distribution */}
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
                          <span className="truncate max-w-[200px]">
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
                          <span className="text-blue-500">{source.selected_count} selected</span>
                          <span className="text-green-500">{source.used_count} used</span>
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

            {/* Synthese-Embeddings */}
            <Card>
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Synthese-Embeddings
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  Für Synthese-Pipeline benötigt
                </p>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {embeddingLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs text-muted-foreground">Lade Status...</span>
                  </div>
                ) : embeddingStatus ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Embeddings vorhanden</span>
                        <span className="font-medium">{embeddingStatus.withEmbeddings} / {embeddingStatus.total}</span>
                      </div>
                      <Progress value={embeddingStatus.percentComplete} className="h-2" />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{embeddingStatus.percentComplete}% vollständig</span>
                        <span>{embeddingStatus.missingEmbeddings} fehlend</span>
                      </div>
                    </div>

                    {embeddingStatus.missingEmbeddings > 0 && (
                      <div className="flex items-center justify-between pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          {embeddingStatus.missingEmbeddings} fehlend
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={runBackfill}
                          disabled={backfillRunning}
                        >
                          {backfillRunning ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          Backfill
                        </Button>
                      </div>
                    )}

                    {backfillResult && (
                      <div className={`flex items-center gap-2 text-xs ${backfillResult.success ? 'text-green-600' : 'text-red-600'}`}>
                        {backfillResult.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                        {backfillResult.message}
                      </div>
                    )}

                    {embeddingStatus.missingEmbeddings === 0 && (
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <CheckCircle2 className="h-3 w-3" />
                        Alle Items haben Embeddings
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Status nicht verfügbar</p>
                )}
              </CardContent>
            </Card>
          </div>
        </CollapsibleContent>

      {/* Queue Items - Full Width */}
      <div>

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
                <div className="max-h-[60vh] overflow-y-auto">
                  {importBatches.map(([batchKey, groupItems]) => (
                    <div key={batchKey}>
                      {/* Import batch header */}
                      <div className="sticky top-0 bg-zinc-800 px-3 py-1.5 border-b border-zinc-700 text-xs font-medium text-white">
                        Import: {batchKey} ({groupItems.length} Items)
                      </div>
                      {/* Items in this batch */}
                      <div className="divide-y">
                        {groupItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
                          >
                            {/* Action button on the left */}
                            {statusFilter === 'pending' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] px-2 shrink-0"
                                onClick={() => handleSelectSingle(item.id)}
                                disabled={actionLoading === `select-${item.id}`}
                              >
                                {actionLoading === `select-${item.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <Play className="h-3 w-3 mr-1" />
                                    Select
                                  </>
                                )}
                              </Button>
                            )}
                            {statusFilter === 'selected' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] px-2 shrink-0 text-muted-foreground hover:text-destructive hover:border-destructive"
                                onClick={() => handleUnselect(item.id)}
                                disabled={actionLoading === `unselect-${item.id}`}
                                title="Zurück zu Pending"
                              >
                                {actionLoading === `unselect-${item.id}` ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <X className="h-3 w-3 mr-1" />
                                    Remove
                                  </>
                                )}
                              </Button>
                            )}
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStatusColor(item.status)}`} />
                            <div
                              className="min-w-0 flex-1 cursor-pointer"
                              onClick={() => setViewingItem(item)}
                            >
                              <div className="text-xs font-medium truncate hover:text-primary">{item.title}</div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <span className="truncate max-w-[150px]">
                                  {item.source_display_name || item.source_identifier}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 h-4 font-mono font-bold border-0"
                                style={{
                                  backgroundColor: getSynthesisScoreColor(item.synthesis_score, allSynthesisScores),
                                  color: '#000'
                                }}
                                title={`Synthesis: ${item.synthesis_score.toFixed(1)} | Total: ${item.total_score.toFixed(1)}`}
                              >
                                {item.synthesis_score.toFixed(1)}
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
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pagination - always show when there are items */}
          {totalItems > 0 && (
            <div className="flex items-center justify-between mt-3 text-xs">
              <div className="text-muted-foreground">
                Zeige {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, totalItems)} von {totalItems}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setCurrentPage(p => p - 1)
                    fetchData(currentPage - 1)
                  }}
                  disabled={currentPage === 0 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-muted-foreground">
                  Seite {currentPage + 1} / {Math.ceil(totalItems / PAGE_SIZE)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setCurrentPage(p => p + 1)
                    fetchData(currentPage + 1)
                  }}
                  disabled={(currentPage + 1) * PAGE_SIZE >= totalItems || loading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

      {/* View Item Dialog */}
      <Dialog open={!!viewingItem} onOpenChange={() => setViewingItem(null)}>
        <DialogContent className="max-w-3xl">
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
              {viewingItem.content ? (
                <div>
                  <div className="text-muted-foreground mb-1">Content</div>
                  <div className="text-sm bg-muted/50 p-3 rounded max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                    {viewingItem.content}
                  </div>
                </div>
              ) : viewingItem.excerpt ? (
                <div>
                  <div className="text-muted-foreground mb-1">Excerpt</div>
                  <p className="text-sm">{viewingItem.excerpt}</p>
                </div>
              ) : (
                <div className="p-3 bg-muted/30 rounded text-center text-muted-foreground">
                  <p className="text-sm">Kein Content verfügbar</p>
                  {viewingItem.source_url && (
                    <a
                      href={viewingItem.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-xs mt-1 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Quelle öffnen
                    </a>
                  )}
                </div>
              )}
              {viewingItem.source_url && (viewingItem.content || viewingItem.excerpt) && (
                <a
                  href={viewingItem.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline block truncate flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
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

      {/* Import from Synthesis Candidates Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Manuell nachimportieren
            </DialogTitle>
            <DialogDescription className="text-xs">
              Items werden automatisch durch die Synthese-Pipeline zur Queue hinzugefügt.
              Hier kannst du ältere Synthesen nachträglich importieren.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={importDate}
              onChange={(e) => {
                setImportDate(e.target.value)
                fetchCandidates(e.target.value)
              }}
              className="rounded border px-2 py-1 text-xs"
            />
            <span className="text-xs text-muted-foreground">
              {candidateItems.length} Kandidaten gefunden
            </span>
          </div>

          <div className="flex-1 overflow-y-auto border rounded">
            {loadingCandidates ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : candidateItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Database className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-xs">Keine Synthese-Kandidaten für dieses Datum</p>
                <p className="text-[10px] mt-1">Wurde die Synthese-Pipeline für diesen Tag ausgeführt?</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 sticky top-0">
                  <input
                    type="checkbox"
                    checked={selectedCandidates.size === candidateItems.length && candidateItems.length > 0}
                    onChange={selectAllCandidates}
                    className="rounded"
                  />
                  <span className="text-xs text-muted-foreground">
                    Alle auswählen ({selectedCandidates.size}/{candidateItems.length})
                  </span>
                </div>
                <div className="divide-y">
                  {candidateItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-xs ${
                        selectedCandidates.has(item.id) ? 'bg-primary/5' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCandidates.has(item.id)}
                        onChange={() => toggleCandidateSelect(item.id)}
                        className="rounded shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{item.title}</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate max-w-[150px]">
                            {item.source_email || item.source_url || 'Unbekannte Quelle'}
                          </span>
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                            {item.synthesis_type}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 font-mono" title="Originalität">
                          O:{item.originality_score}
                        </Badge>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 font-mono" title="Relevanz">
                          R:{item.relevance_score}
                        </Badge>
                      </div>
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
              disabled={selectedCandidates.size === 0 || actionLoading === 'import'}
            >
              {actionLoading === 'import' ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-2" />
              )}
              {selectedCandidates.size} Items importieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </Collapsible>
  )
}
