'use client'

import { useEffect, useState, useCallback, useRef, startTransition } from 'react'
import { Languages, Loader2, RefreshCw, Play, RotateCcw, X, CheckCircle, Clock, AlertCircle, PenLine, Square, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'

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
  static_pages?: {
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

interface ProcessResult {
  processed: number
  success: number
  failed: number
  skipped: number
  details: Array<{ id: string; status: string; error?: string }>
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
  const [processLog, setProcessLog] = useState<string[]>([])
  const [currentItem, setCurrentItem] = useState<string | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const abortRef = useRef(false)

  const fetchData = useCallback(async () => {
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
  }, [statusFilter, languageFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])


  async function processQueueContinuously() {
    if (processing) return

    setProcessing(true)
    startTransition(() => {
      setProcessLog([])
      setProgress({ current: 0, total: data?.stats?.pending || 0 })
    })
    abortRef.current = false

    let processed = 0
    let successCount = 0
    let failCount = 0

    let consecutiveErrors = 0

    while (!abortRef.current) {
      startTransition(() => setProcessLog(prev => [...prev, `🔄 Verarbeite nächstes Item...`]))

      try {
        const res = await fetch('/api/admin/translations/process-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const text = await res.text()
          let errorMsg: string
          try {
            const json = JSON.parse(text)
            errorMsg = json.error || `HTTP ${res.status}`
          } catch {
            errorMsg = `HTTP ${res.status}: ${text.slice(0, 200)}`
          }
          throw new Error(errorMsg)
        }

        const result: ProcessResult = await res.json()

        if (result.processed === 0) {
          startTransition(() => setProcessLog(prev => [...prev, '✅ Alle Items verarbeitet!']))
          break
        }

        consecutiveErrors = 0
        processed += result.processed
        successCount += result.success
        failCount += result.failed

        startTransition(() => {
          for (const detail of result.details) {
            if (detail.status === 'success') {
              setProcessLog(prev => [...prev, `✅ Erfolgreich übersetzt: ${detail.id.slice(0, 8)}...`])
            } else if (detail.status === 'skipped') {
              setProcessLog(prev => [...prev, `⏭️ Übersprungen (manuell bearbeitet)`])
            } else {
              setProcessLog(prev => [...prev, `❌ Fehlgeschlagen: ${detail.error || 'Unbekannter Fehler'}`])
            }
          }
          setProgress(prev => ({ ...prev, current: prev.current + result.processed }))
        })

        // Refresh data
        await fetchData()

        // Short delay between items to avoid rate limiting
        if (!abortRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } catch (error) {
        consecutiveErrors++
        const errorMsg = error instanceof Error ? error.message : String(error)
        startTransition(() => {
          setProcessLog(prev => [...prev, `❌ Fehler: ${errorMsg}`])
        })

        if (consecutiveErrors >= 3) {
          startTransition(() => setProcessLog(prev => [...prev, '🛑 Zu viele Fehler, stoppe Verarbeitung']))
          break
        }

        startTransition(() => setProcessLog(prev => [...prev, `⏳ Warte 5 Sekunden nach Fehler...`]))
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }

    if (abortRef.current) {
      startTransition(() => setProcessLog(prev => [...prev, '🛑 Verarbeitung abgebrochen']))
    }

    startTransition(() => setProcessLog(prev => [...prev, `📊 Ergebnis: ${successCount} erfolgreich, ${failCount} fehlgeschlagen`]))
    setProcessing(false)
    setCurrentItem(null)
    fetchData()
  }

  function stopProcessing() {
    abortRef.current = true
    startTransition(() => setProcessLog(prev => [...prev, '🛑 Stoppe Verarbeitung...']))
  }

  async function retryItem(id: string) {
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', queue_item_id: id }),
      })
      const result = await res.json()

      if (!res.ok) {
        console.error('Retry failed:', result)
        setProcessLog(prev => [...prev, `❌ Retry fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}`])
        return
      }

      console.log('Retry successful:', result)
      setProcessLog(prev => [...prev, `✅ Item zurück in Queue gestellt`])
      await fetchData()

      // Auto-start processing if not already running
      if (!processing) {
        setProcessLog(prev => [...prev, `🚀 Starte Verarbeitung...`])
        processQueueContinuously()
      }
    } catch (error) {
      console.error('Error retrying item:', error)
      setProcessLog(prev => [...prev, `❌ Netzwerkfehler beim Retry`])
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

  async function deleteItem(id: string) {
    if (!confirm('Übersetzung wirklich löschen? Dies löscht auch die zugehörige Übersetzung.')) {
      return
    }
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', queue_item_id: id }),
      })
      if (res.ok) {
        setProcessLog(prev => [...prev, `🗑️ Übersetzung gelöscht`])
      } else {
        setProcessLog(prev => [...prev, `❌ Löschen fehlgeschlagen`])
      }
      fetchData()
    } catch (error) {
      console.error('Error deleting item:', error)
      setProcessLog(prev => [...prev, `❌ Netzwerkfehler beim Löschen`])
    }
  }

  async function retryAllFailed() {
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry-all-failed' }),
      })
      const result = await res.json()

      if (!res.ok) {
        setProcessLog(prev => [...prev, `❌ Retry fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}`])
        return
      }

      setProcessLog(prev => [...prev, `✅ ${result.count || 0} Items zurück in Queue gestellt`])
      await fetchData()

      // Auto-start processing if not already running and there are items
      if (!processing && result.count > 0) {
        setProcessLog(prev => [...prev, `🚀 Starte Verarbeitung...`])
        processQueueContinuously()
      }
    } catch (error) {
      console.error('Error retrying all failed:', error)
      setProcessLog(prev => [...prev, `❌ Netzwerkfehler beim Retry`])
    }
  }

  async function retryAllCancelled() {
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry-all-cancelled' }),
      })
      const result = await res.json()

      if (!res.ok) {
        setProcessLog(prev => [...prev, `❌ Retry fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}`])
        return
      }

      setProcessLog(prev => [...prev, `✅ ${result.count || 0} abgebrochene Items zurück in Queue gestellt`])
      await fetchData()

      // Auto-start processing if not already running and there are items
      if (!processing && result.count > 0) {
        setProcessLog(prev => [...prev, `🚀 Starte Verarbeitung...`])
        processQueueContinuously()
      }
    } catch (error) {
      console.error('Error retrying all cancelled:', error)
      setProcessLog(prev => [...prev, `❌ Netzwerkfehler beim Retry`])
    }
  }

  async function cleanupOrphans() {
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup-orphans' }),
      })
      const result = await res.json()
      if (result.count > 0) {
        setProcessLog(prev => [...prev, `🧹 ${result.count} verwaiste Einträge gelöscht`])
      }
      fetchData()
    } catch (error) {
      console.error('Error cleaning up orphans:', error)
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
          <Button variant="outline" onClick={cleanupOrphans} disabled={processing}>
            <Trash2 className="h-4 w-4 mr-2" />
            Bereinigen
          </Button>
          <Button variant="outline" onClick={fetchData} disabled={processing}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
          {processing ? (
            <Button variant="destructive" onClick={stopProcessing}>
              <Square className="h-4 w-4 mr-2" />
              Stoppen
            </Button>
          ) : (
            <Button onClick={processQueueContinuously} disabled={!stats?.pending}>
              <Play className="h-4 w-4 mr-2" />
              Queue verarbeiten ({stats?.pending || 0})
            </Button>
          )}
        </div>
      </div>

      {/* Processing Progress */}
      {processing && (
        <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verarbeitung läuft...
            </CardTitle>
          </CardHeader>
          <CardContent>
            {progress.total > 0 && (
              <div className="mb-3">
                <Progress value={(progress.current / progress.total) * 100} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {progress.current} / {progress.total} Items
                </p>
              </div>
            )}
            <div className="bg-black/10 dark:bg-white/10 rounded p-3 max-h-40 overflow-y-auto font-mono text-xs">
              {processLog.slice(-10).map((log, i) => (
                <div key={i} className="py-0.5">{log}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-6">
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
        <Card className="cursor-pointer hover:border-red-300" onClick={() => stats?.failed && retryAllFailed()}>
          <CardHeader className="pb-2">
            <CardDescription>Fehlgeschlagen</CardDescription>
            <CardTitle className="text-2xl text-red-600 flex items-center gap-2">
              {stats?.failed || 0}
              {(stats?.failed || 0) > 0 && (
                <RotateCcw className="h-4 w-4 opacity-50" />
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="cursor-pointer hover:border-gray-400" onClick={() => stats?.cancelled && retryAllCancelled()}>
          <CardHeader className="pb-2">
            <CardDescription>Abgebrochen</CardDescription>
            <CardTitle className="text-2xl text-gray-600 flex items-center gap-2">
              {stats?.cancelled || 0}
              {(stats?.cancelled || 0) > 0 && (
                <RotateCcw className="h-4 w-4 opacity-50" />
              )}
            </CardTitle>
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
            <SelectItem value="cancelled">Abgebrochen</SelectItem>
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
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    currentItem === item.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : ''
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={STATUS_COLORS[item.status] || ''}>
                        {STATUS_ICONS[item.status]}
                        <span className="ml-1">{item.status}</span>
                      </Badge>
                      <Badge variant="outline">{item.target_language.toUpperCase()}</Badge>
                      <Badge variant="secondary">{item.content_type}</Badge>
                      {item.priority > 1 && (
                        <Badge variant="secondary">P{item.priority}</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">
                      {item.generated_posts?.title || item.static_pages?.title || `${item.content_type}: ${item.content_id?.slice(0, 8)}...`}
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
                    {(item.status === 'failed' || item.status === 'cancelled') && (
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
                    {(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Löschen
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
