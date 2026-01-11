'use client'

import { useEffect, useState } from 'react'
import { Languages, Loader2, RefreshCw, Play, RotateCcw, X, CheckCircle, Clock, AlertCircle, PenLine } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface QueueItem {
  id: string
  content_type: string
  content_id: string
  target_language: string
  priority: number
  status: string
  attempts: number
  last_error: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  generated_posts?: {
    id: string
    title: string
    slug: string
  } | null
}

interface Stats {
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  byLanguage: Record<string, { pending: number; completed: number; failed: number }>
}

interface TranslationsData {
  stats: Stats
  queueItems: QueueItem[]
  translationsCount: number
  manuallyEditedCount: number
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  processing: <Loader2 className="h-3 w-3 animate-spin" />,
  completed: <CheckCircle className="h-3 w-3" />,
  failed: <AlertCircle className="h-3 w-3" />,
  cancelled: <X className="h-3 w-3" />,
}

export default function TranslationsPage() {
  const [data, setData] = useState<TranslationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [languageFilter, setLanguageFilter] = useState('all')

  useEffect(() => {
    fetchData()
  }, [statusFilter, languageFilter])

  async function fetchData() {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (languageFilter !== 'all') params.set('language', languageFilter)

      const res = await fetch(`/api/admin/translations?${params}`)
      const json = await res.json()
      setData(json)
    } catch (error) {
      console.error('Error fetching translations:', error)
    } finally {
      setLoading(false)
    }
  }

  async function processQueue() {
    setProcessing(true)
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process' }),
      })
      const result = await res.json()
      alert(`Verarbeitet: ${result.processed || 0} Items (${result.success || 0} erfolgreich, ${result.failed || 0} fehlgeschlagen)`)
      fetchData()
    } catch (error) {
      console.error('Error processing queue:', error)
      alert('Fehler bei der Verarbeitung')
    } finally {
      setProcessing(false)
    }
  }

  async function retryItem(id: string) {
    try {
      await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', queue_item_id: id }),
      })
      fetchData()
    } catch (error) {
      console.error('Error retrying item:', error)
    }
  }

  async function cancelItem(id: string) {
    try {
      await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', queue_item_id: id }),
      })
      fetchData()
    } catch (error) {
      console.error('Error cancelling item:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const stats = data?.stats
  const languages = Object.keys(stats?.byLanguage || {})

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
            <Languages className="h-8 w-8" />
            Übersetzungen
          </h1>
          <p className="mt-1 text-muted-foreground">
            Verwalte die Übersetzungs-Queue und sehe den Fortschritt
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
          <Button onClick={processQueue} disabled={processing || !stats?.pending}>
            {processing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Queue verarbeiten
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ausstehend</CardDescription>
            <CardTitle className="text-2xl text-yellow-600">{stats?.pending || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In Bearbeitung</CardDescription>
            <CardTitle className="text-2xl text-blue-600">{stats?.processing || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Abgeschlossen</CardDescription>
            <CardTitle className="text-2xl text-green-600">{stats?.completed || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fehlgeschlagen</CardDescription>
            <CardTitle className="text-2xl text-red-600">{stats?.failed || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Manuell bearbeitet</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <PenLine className="h-5 w-5 text-purple-600" />
              {data?.manuallyEditedCount || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* By Language Stats */}
      {languages.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nach Sprache</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {languages.map(lang => {
                const langStats = stats?.byLanguage[lang]
                return (
                  <div key={lang} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline">{lang.toUpperCase()}</Badge>
                    <span className="text-yellow-600">{langStats?.pending || 0} pending</span>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-green-600">{langStats?.completed || 0} done</span>
                    {(langStats?.failed || 0) > 0 && (
                      <>
                        <span className="text-muted-foreground">|</span>
                        <span className="text-red-600">{langStats?.failed} failed</span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="processing">In Bearbeitung</SelectItem>
            <SelectItem value="completed">Abgeschlossen</SelectItem>
            <SelectItem value="failed">Fehlgeschlagen</SelectItem>
          </SelectContent>
        </Select>

        <Select value={languageFilter} onValueChange={setLanguageFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sprache" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Sprachen</SelectItem>
            {languages.map(lang => (
              <SelectItem key={lang} value={lang}>{lang.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Queue Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue Items</CardTitle>
          <CardDescription>
            {data?.queueItems?.length || 0} Einträge
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data?.queueItems && data.queueItems.length > 0 ? (
            <div className="space-y-2">
              {data.queueItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={STATUS_COLORS[item.status] || ''}>
                        {STATUS_ICONS[item.status]}
                        <span className="ml-1">{item.status}</span>
                      </Badge>
                      <Badge variant="outline">{item.target_language.toUpperCase()}</Badge>
                      {item.priority > 0 && (
                        <Badge variant="secondary">P{item.priority}</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">
                      {item.generated_posts?.title || `${item.content_type}: ${item.content_id}`}
                    </p>
                    {item.last_error && (
                      <p className="text-xs text-red-600 mt-1 truncate max-w-md">
                        {item.last_error}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Erstellt: {new Date(item.created_at).toLocaleString('de-DE')}
                      {item.attempts > 0 && ` • ${item.attempts} Versuche`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {item.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryItem(item.id)}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                    )}
                    {(item.status === 'pending' || item.status === 'processing') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancelItem(item.id)}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Abbrechen
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              Keine Queue-Items gefunden
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
