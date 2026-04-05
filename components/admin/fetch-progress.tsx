'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  RefreshCw,
  Mail,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  Loader2,
  Hash,
  RotateCcw,
  StickyNote,
  Download,
  AlertTriangle
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { UnfetchedEmailsDialog } from './unfetched-emails-dialog'

interface ProgressItem {
  title: string
  from?: string
  url?: string
  status: 'pending' | 'processing' | 'success' | 'error' | 'skipped'
  error?: string
  type?: 'newsletter' | 'article' | 'email_note'
}

interface UnfetchedEmail {
  email: string
  name: string
  count: number
  subjects: string[]
  latestDate: string
}

interface ArticleToExtract {
  url: string
  title: string
  newsletterTitle: string
  newsletterEmail: string
  snippetText?: string
}

interface ProgressEvent {
  type: 'start' | 'newsletter' | 'article' | 'article_urls' | 'email_note' | 'unfetched_emails' | 'embedding_backfill' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'importing_notes' | 'scanning_unfetched' | 'embedding_backfill' | 'done'
  current?: number
  total?: number
  item?: ProgressItem
  summary?: {
    newsletters: number
    articles: number
    emailNotes: number
    errors: number
    totalCharacters: number
  }
  unfetchedEmails?: UnfetchedEmail[]
  articleUrls?: ArticleToExtract[]
}

const statusIcons = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  processing: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  success: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  skipped: <SkipForward className="h-4 w-4 text-yellow-500" />,
}

const phaseLabels: Record<string, string> = {
  fetching: 'Emails abrufen',
  processing: 'Newsletter verarbeiten',
  importing_notes: '+dailyrepo importieren',
  extracting: 'Artikel extrahieren',
  scanning_unfetched: 'Scanne alle Mails',
  embedding_backfill: 'Embeddings generieren',
  done: 'Abgeschlossen',
  error: 'Fehler aufgetreten',
}

const EXTRACT_BATCH_SIZE = 100 // Articles per API request

interface FetchProgressProps {
  onComplete?: () => void
  targetDate?: string
}

export function FetchProgress({ onComplete, targetDate }: FetchProgressProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [phase, setPhase] = useState<string>('idle')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [items, setItems] = useState<ProgressItem[]>([])
  const [summary, setSummary] = useState<{ newsletters: number; articles: number; emailNotes: number; errors: number; totalCharacters: number } | null>(null)
  const [forceRefresh, setForceRefresh] = useState(false)
  const [hoursBack, setHoursBack] = useState(28)

  const [unfetchedEmails, setUnfetchedEmails] = useState<UnfetchedEmail[]>([])
  const [showUnfetchedDialog, setShowUnfetchedDialog] = useState(false)

  const [liveStats, setLiveStats] = useState({ newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 })
  const [errorLog, setErrorLog] = useState<Array<{ title: string; from?: string; url?: string; error: string; phase: string; timestamp: string }>>([])

  // Helper: consume an SSE stream and call handler for each event
  async function consumeSSEStream(
    response: Response,
    onEvent: (event: ProgressEvent) => void
  ) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No reader')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)))
          } catch (e) {
            console.error('Error parsing SSE:', e)
          }
        }
      }
    }
  }

  const startFetch = useCallback(async () => {
    setIsRunning(true)
    setPhase('fetching')
    setProgress({ current: 0, total: 0 })
    setItems([])
    setSummary(null)
    setUnfetchedEmails([])
    setLiveStats({ newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 })
    setErrorLog([])

    let scanSummary = { newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 }
    let receivedUnfetchedEmails: UnfetchedEmail[] = []
    let articleUrls: ArticleToExtract[] = []
    let fetchDate = targetDate || new Date().toISOString().split('T')[0]

    try {
      // ========================================
      // PHASE 1: Scan — fetch emails, parse newsletters, collect article URLs
      // ========================================
      const scanResponse = await fetch('/api/fetch-newsletters-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate, force: forceRefresh, hoursBack, mode: 'scan' }),
        credentials: 'include',
      })

      if (!scanResponse.ok) {
        const errorText = await scanResponse.text().catch(() => 'Unknown error')
        throw new Error(`Scan failed (${scanResponse.status}): ${errorText}`)
      }

      await consumeSSEStream(scanResponse, (event) => {
        if (event.phase) setPhase(event.phase)

        if (event.current !== undefined && event.total !== undefined) {
          setProgress({ current: event.current, total: event.total })
        }

        if (event.item) {
          const itemWithType: ProgressItem = {
            ...event.item,
            type: event.type === 'newsletter' || event.type === 'article' || event.type === 'email_note'
              ? event.type : undefined
          }

          setItems(prev => {
            const existing = prev.findIndex(
              i => i.title === itemWithType.title && i.from === itemWithType.from && i.url === itemWithType.url
            )
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = itemWithType
              return updated
            }
            return [...prev, itemWithType]
          })

          if (event.item.status === 'success') {
            setLiveStats(prev => ({
              ...prev,
              newsletters: prev.newsletters + (event.type === 'newsletter' ? 1 : 0),
              articles: prev.articles + (event.type === 'article' ? 1 : 0),
              emailNotes: prev.emailNotes + (event.type === 'email_note' ? 1 : 0),
              totalCharacters: prev.totalCharacters + (event.type === 'newsletter' ? 5000 : event.type === 'email_note' ? 2000 : 3000)
            }))
          } else if (event.item.status === 'error') {
            setLiveStats(prev => ({ ...prev, errors: prev.errors + 1 }))
            setErrorLog(prev => [...prev, {
              title: event.item!.title,
              from: event.item!.from,
              url: event.item!.url,
              error: event.item!.error || 'Unbekannter Fehler',
              phase: event.phase || 'scan',
              timestamp: new Date().toISOString(),
            }])
          }
        }

        // Collect article URLs from scan
        if (event.type === 'article_urls' && event.articleUrls) {
          articleUrls = event.articleUrls
          console.log(`[FetchProgress] Received ${articleUrls.length} article URLs to extract`)
        }

        if (event.type === 'unfetched_emails' && event.unfetchedEmails) {
          receivedUnfetchedEmails = event.unfetchedEmails
          setUnfetchedEmails(event.unfetchedEmails)
        }

        if (event.type === 'complete' && event.summary) {
          scanSummary = event.summary
        }
      })

      // ========================================
      // PHASE 2: Extract articles in batches
      // ========================================
      if (articleUrls.length > 0) {
        const totalArticles = articleUrls.length
        const totalBatches = Math.ceil(totalArticles / EXTRACT_BATCH_SIZE)

        setPhase('extracting')
        setProgress({ current: 0, total: totalArticles })

        let totalExtracted = 0
        let totalExtractErrors = 0
        let totalExtractChars = 0

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const batchStart = batchIdx * EXTRACT_BATCH_SIZE
          const batch = articleUrls.slice(batchStart, batchStart + EXTRACT_BATCH_SIZE)

          console.log(`[FetchProgress] Extracting batch ${batchIdx + 1}/${totalBatches} (${batch.length} articles)`)

          const extractResponse = await fetch('/api/fetch-newsletters-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'extract',
              articles: batch,
              fetchDate,
              force: forceRefresh,
              globalOffset: batchStart,
              globalTotal: totalArticles,
            }),
            credentials: 'include',
          })

          if (!extractResponse.ok) {
            console.error(`[FetchProgress] Extract batch ${batchIdx + 1} failed: ${extractResponse.status}`)
            setLiveStats(prev => ({ ...prev, errors: prev.errors + batch.length }))
            totalExtractErrors += batch.length
            continue
          }

          await consumeSSEStream(extractResponse, (event) => {
            if (event.current !== undefined && event.total !== undefined) {
              setProgress({ current: event.current, total: event.total })
            }

            if (event.item && event.type === 'article') {
              const itemWithType: ProgressItem = { ...event.item, type: 'article' }
              setItems(prev => {
                const updated = [...prev]
                if (updated.length > 50) updated.splice(0, updated.length - 50)
                return [...updated, itemWithType]
              })

              if (event.item.status === 'success') {
                totalExtracted++
                setLiveStats(prev => ({
                  ...prev,
                  articles: prev.articles + 1,
                  totalCharacters: prev.totalCharacters + 3000
                }))
              } else if (event.item.status === 'error') {
                totalExtractErrors++
                setLiveStats(prev => ({ ...prev, errors: prev.errors + 1 }))
                setErrorLog(prev => [...prev, {
                  title: event.item!.title,
                  from: event.item!.from,
                  url: event.item!.url,
                  error: event.item!.error || 'Extraction fehlgeschlagen',
                  phase: 'extract',
                  timestamp: new Date().toISOString(),
                }])
              }
            }

            if (event.type === 'complete' && event.summary) {
              totalExtractChars += event.summary.totalCharacters
            }
          })
        }

        // Merge scan + extraction summaries
        scanSummary = {
          ...scanSummary,
          articles: scanSummary.articles + totalExtracted,
          errors: scanSummary.errors + totalExtractErrors,
          totalCharacters: scanSummary.totalCharacters + totalExtractChars,
        }
      }

      // ========================================
      // DONE
      // ========================================
      setPhase('done')
      setSummary(scanSummary)

      if (receivedUnfetchedEmails.length > 0) {
        setShowUnfetchedDialog(true)
      } else if (scanSummary.errors === 0) {
        onComplete?.()
      }
      // When there are errors, don't auto-close — let user review the error log first

    } catch (error) {
      console.error('Fetch error:', error)
      setPhase('error')
      setItems(prev => [...prev, {
        title: 'Kritischer Fehler',
        status: 'error',
        error: error instanceof Error ? error.message : 'Verbindungsfehler - bitte neu einloggen'
      }])
    } finally {
      setIsRunning(false)
    }
  }, [onComplete, targetDate, forceRefresh, hoursBack])

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  function downloadErrorLog() {
    if (errorLog.length === 0) return

    const dateStr = targetDate || new Date().toISOString().split('T')[0]
    let report = `# Newsletter Import — Error Log\n`
    report += `Datum: ${dateStr}\n`
    report += `Zeitpunkt: ${new Date().toLocaleString('de-DE')}\n`
    report += `Fehler gesamt: ${errorLog.length}\n\n`
    report += `---\n\n`

    // Group by phase
    const scanErrors = errorLog.filter(e => e.phase !== 'extract')
    const extractErrors = errorLog.filter(e => e.phase === 'extract')

    if (scanErrors.length > 0) {
      report += `## Newsletter-Scan (${scanErrors.length} Fehler)\n\n`
      for (const err of scanErrors) {
        report += `### ${err.title}\n`
        if (err.from) report += `- Absender: ${err.from}\n`
        if (err.url) report += `- URL: ${err.url}\n`
        report += `- Fehler: ${err.error}\n`
        report += `- Phase: ${err.phase}\n`
        report += `- Zeit: ${new Date(err.timestamp).toLocaleTimeString('de-DE')}\n\n`
      }
    }

    if (extractErrors.length > 0) {
      report += `## Artikel-Extraktion (${extractErrors.length} Fehler)\n\n`
      for (const err of extractErrors) {
        report += `### ${err.title}\n`
        if (err.from) report += `- Newsletter: ${err.from}\n`
        if (err.url) report += `- URL: ${err.url}\n`
        report += `- Fehler: ${err.error}\n`
        report += `- Zeit: ${new Date(err.timestamp).toLocaleTimeString('de-DE')}\n\n`
      }
    }

    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import-errors-${dateStr}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="w-full max-w-full overflow-hidden min-w-0">
      <CardHeader className="pb-3 min-w-0 max-w-full overflow-hidden">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <CardTitle className="text-lg font-medium flex items-center gap-2 shrink-0">
            <RefreshCw className={cn("h-5 w-5", isRunning && "animate-spin")} />
            Newsletter Abruf
          </CardTitle>
          <div className="flex items-center gap-3 shrink-0">
            <Select value={String(hoursBack)} onValueChange={(v) => setHoursBack(Number(v))} disabled={isRunning}>
              <SelectTrigger className="w-[72px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[4, 8, 12, 24, 28, 36, 48].map(h => (
                  <SelectItem key={h} value={String(h)} className="text-xs">{h}h</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id="force-refresh"
                checked={forceRefresh}
                onCheckedChange={setForceRefresh}
                disabled={isRunning}
              />
              <Label htmlFor="force-refresh" className="text-xs text-muted-foreground cursor-pointer">
                <RotateCcw className="h-3 w-3 inline mr-1" />
                Neu laden
              </Label>
            </div>
            <Button
              onClick={startFetch}
              disabled={isRunning}
              size="sm"
              variant={forceRefresh ? "destructive" : "default"}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Läuft...
                </>
              ) : forceRefresh ? (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Neu laden
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Abrufen
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 overflow-hidden min-w-0 max-w-full">
        {/* Phase indicator */}
        {phase !== 'idle' && (
          <div className="space-y-2 w-full min-w-0 max-w-full">
            <div className="flex items-center justify-between text-sm min-w-0">
              <span className="text-muted-foreground truncate">{phaseLabels[phase] || phase}</span>
              {progress.total > 0 && (
                <span className="font-medium shrink-0 ml-2">{progress.current} / {progress.total}</span>
              )}
            </div>
            {progress.total > 0 && (
              <div className="w-full min-w-0 max-w-full">
                <Progress value={progressPercent} className="h-2 w-full" />
              </div>
            )}
          </div>
        )}

        {/* Live Stats during fetch */}
        {isRunning && (
          <div className="grid grid-cols-5 gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200 min-w-0 max-w-full overflow-hidden">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-bold text-blue-600">
                <Mail className="h-4 w-4" />
                {liveStats.newsletters}
              </div>
              <div className="text-[10px] text-muted-foreground">Newsletter</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-bold text-orange-600">
                <StickyNote className="h-4 w-4" />
                {liveStats.emailNotes}
              </div>
              <div className="text-[10px] text-muted-foreground">Notizen</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-bold text-green-600">
                <FileText className="h-4 w-4" />
                {liveStats.articles}
              </div>
              <div className="text-[10px] text-muted-foreground">Artikel</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-bold text-purple-600">
                <Hash className="h-4 w-4" />
                {(liveStats.totalCharacters / 1000).toFixed(0)}k
              </div>
              <div className="text-[10px] text-muted-foreground">Zeichen</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-lg font-bold text-red-600">
                <XCircle className="h-4 w-4" />
                {liveStats.errors}
              </div>
              <div className="text-[10px] text-muted-foreground">Fehler</div>
            </div>
          </div>
        )}

        {/* Final Summary */}
        {summary && !isRunning && (
          <div className="grid grid-cols-5 gap-2 p-3 bg-muted/50 rounded-lg min-w-0 max-w-full overflow-hidden">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xl font-bold text-blue-600">
                <Mail className="h-4 w-4" />
                {summary.newsletters}
              </div>
              <div className="text-[10px] text-muted-foreground">Newsletter</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xl font-bold text-orange-600">
                <StickyNote className="h-4 w-4" />
                {summary.emailNotes}
              </div>
              <div className="text-[10px] text-muted-foreground">Notizen</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xl font-bold text-green-600">
                <FileText className="h-4 w-4" />
                {summary.articles}
              </div>
              <div className="text-[10px] text-muted-foreground">Artikel</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xl font-bold text-purple-600">
                <Hash className="h-4 w-4" />
                {(summary.totalCharacters / 1000).toFixed(1)}k
              </div>
              <div className="text-[10px] text-muted-foreground">Zeichen</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xl font-bold text-red-600">
                <XCircle className="h-4 w-4" />
                {summary.errors}
              </div>
              <div className="text-[10px] text-muted-foreground">Fehler</div>
            </div>
          </div>
        )}

        {/* Error Log with Download */}
        {!isRunning && errorLog.length > 0 && (
          <div className="space-y-2 border border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                {errorLog.length} Fehler beim Import
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadErrorLog}
                className="h-7 px-2.5 text-xs gap-1.5 border-red-200 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                <Download className="h-3 w-3" />
                Error Log (.md)
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {errorLog.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-xs py-1.5 px-2 bg-white/60 dark:bg-black/20 rounded">
                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-red-800 dark:text-red-300">{err.title}</div>
                    {err.from && <div className="text-red-600/70 dark:text-red-400/70 truncate">Absender: {err.from}</div>}
                    {err.url && <div className="text-red-600/70 dark:text-red-400/70 truncate">URL: {err.url}</div>}
                    <div className="text-red-600 dark:text-red-400 mt-0.5">{err.error}</div>
                  </div>
                  <span className="text-[10px] text-red-400 dark:text-red-500 shrink-0 tabular-nums">
                    {new Date(err.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                variant="default"
                onClick={() => onComplete?.()}
                className="h-7 px-3 text-xs"
              >
                Schließen
              </Button>
            </div>
          </div>
        )}

        {/* Item list */}
        {items.length > 0 && (
          <div className="max-h-64 overflow-y-auto overflow-x-hidden space-y-1 border rounded-lg p-2 w-full min-w-0 max-w-full">
            {items.slice(-15).map((item, i) => (
              <div
                key={`${item.title}-${i}`}
                className={cn(
                  "flex items-start gap-2 p-2 rounded text-sm overflow-hidden",
                  item.status === 'processing' && "bg-blue-50",
                  item.status === 'error' && "bg-red-50",
                  item.status === 'success' && "bg-green-50/50",
                  item.status === 'skipped' && "bg-yellow-50/50"
                )}
              >
                <div className="shrink-0 mt-0.5">
                  {item.type === 'newsletter' && <Mail className="h-4 w-4 text-blue-500" />}
                  {item.type === 'article' && <FileText className="h-4 w-4 text-green-500" />}
                  {item.type === 'email_note' && <StickyNote className="h-4 w-4 text-orange-500" />}
                  {!item.type && <div className="w-4" />}
                </div>
                {statusIcons[item.status]}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="font-medium truncate">{item.title}</div>
                  {item.from && (
                    <div className="text-xs text-muted-foreground truncate">{item.from}</div>
                  )}
                  {item.url && (
                    <div className="text-xs text-muted-foreground truncate max-w-full">
                      {item.url.length > 50 ? item.url.slice(0, 50) + '...' : item.url}
                    </div>
                  )}
                  {item.error && (
                    <div className="text-xs text-red-600 truncate">{item.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Idle state */}
        {phase === 'idle' && items.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>Klicke auf &quot;Jetzt abrufen&quot; um Newsletter zu laden</p>
          </div>
        )}
      </CardContent>

      <UnfetchedEmailsDialog
        open={showUnfetchedDialog}
        onOpenChange={(open) => {
          setShowUnfetchedDialog(open)
          if (!open) {
            console.log('[FetchProgress] Unfetched dialog closed, calling onComplete')
            onComplete?.()
          }
        }}
        emails={unfetchedEmails}
        onComplete={(result) => {
          console.log('[FetchProgress] Sources managed:', result)
          setUnfetchedEmails([])
        }}
      />
    </Card>
  )
}
