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
  StickyNote
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface ProgressItem {
  title: string
  from?: string
  url?: string
  status: 'pending' | 'processing' | 'success' | 'error' | 'skipped'
  error?: string
}

interface ProgressEvent {
  type: 'start' | 'newsletter' | 'article' | 'email_note' | 'complete' | 'error'
  phase: 'fetching' | 'processing' | 'extracting' | 'importing_notes' | 'done'
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
}

const statusIcons = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  processing: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  success: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  skipped: <SkipForward className="h-4 w-4 text-yellow-500" />,
}

const phaseLabels = {
  fetching: 'Emails abrufen',
  processing: 'Newsletter verarbeiten',
  importing_notes: '+dailyrepo importieren',
  extracting: 'Artikel extrahieren',
  done: 'Abgeschlossen',
  error: 'Fehler aufgetreten',
}

interface FetchProgressProps {
  onComplete?: () => void
  targetDate?: string // Optional: YYYY-MM-DD format for fetching specific date
}

export function FetchProgress({ onComplete, targetDate }: FetchProgressProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [phase, setPhase] = useState<string>('idle')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [items, setItems] = useState<ProgressItem[]>([])
  const [summary, setSummary] = useState<{ newsletters: number; articles: number; emailNotes: number; errors: number; totalCharacters: number } | null>(null)
  const [forceRefresh, setForceRefresh] = useState(false)

  // Live stats during fetch
  const [liveStats, setLiveStats] = useState({ newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 })

  const startFetch = useCallback(async () => {
    setIsRunning(true)
    setPhase('fetching')
    setProgress({ current: 0, total: 0 })
    setItems([])
    setSummary(null)
    setLiveStats({ newsletters: 0, articles: 0, emailNotes: 0, errors: 0, totalCharacters: 0 })

    try {
      const response = await fetch('/api/fetch-newsletters-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDate, force: forceRefresh }),
        credentials: 'include',
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new Error(`Fetch failed (${response.status}): ${errorText}`)
      }

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
              const event: ProgressEvent = JSON.parse(line.slice(6))

              if (event.phase) {
                setPhase(event.phase)
              }

              if (event.current !== undefined && event.total !== undefined) {
                setProgress({ current: event.current, total: event.total })
              }

              if (event.item) {
                setItems(prev => {
                  // Update existing item or add new one
                  const existing = prev.findIndex(
                    i => i.title === event.item!.title && i.from === event.item!.from && i.url === event.item!.url
                  )
                  if (existing >= 0) {
                    const updated = [...prev]
                    updated[existing] = event.item!
                    return updated
                  }
                  return [...prev, event.item!]
                })

                // Update live stats when item succeeds
                if (event.item.status === 'success') {
                  setLiveStats(prev => ({
                    ...prev,
                    newsletters: prev.newsletters + (event.type === 'newsletter' ? 1 : 0),
                    articles: prev.articles + (event.type === 'article' ? 1 : 0),
                    emailNotes: prev.emailNotes + (event.type === 'email_note' ? 1 : 0),
                    totalCharacters: prev.totalCharacters + (event.type === 'newsletter' ? 5000 : event.type === 'email_note' ? 2000 : 3000) // Estimated
                  }))
                } else if (event.item.status === 'error') {
                  setLiveStats(prev => ({ ...prev, errors: prev.errors + 1 }))
                }
              }

              if (event.type === 'complete' && event.summary) {
                setSummary(event.summary)
                onComplete?.()
              }
            } catch (e) {
              console.error('Error parsing SSE:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('Fetch error:', error)
      setPhase('error')
      // Show error in items list for visibility
      setItems(prev => [...prev, {
        title: 'Kritischer Fehler',
        status: 'error',
        error: error instanceof Error ? error.message : 'Verbindungsfehler - bitte neu einloggen'
      }])
    } finally {
      setIsRunning(false)
    }
  }, [onComplete, targetDate, forceRefresh])

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <RefreshCw className={cn("h-5 w-5", isRunning && "animate-spin")} />
            Newsletter Abruf
          </CardTitle>
          <div className="flex items-center gap-3">
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
      <CardContent className="space-y-4">
        {/* Phase indicator */}
        {phase !== 'idle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{phaseLabels[phase as keyof typeof phaseLabels] || phase}</span>
              {progress.total > 0 && (
                <span className="font-medium">{progress.current} / {progress.total}</span>
              )}
            </div>
            {progress.total > 0 && (
              <Progress value={progressPercent} className="h-2" />
            )}
          </div>
        )}

        {/* Live Stats during fetch */}
        {isRunning && (
          <div className="grid grid-cols-5 gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
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
          <div className="grid grid-cols-5 gap-3 p-4 bg-muted/50 rounded-lg">
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

        {/* Item list */}
        {items.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-1 border rounded-lg p-2">
            {items.slice(-15).map((item, i) => (
              <div
                key={`${item.title}-${i}`}
                className={cn(
                  "flex items-start gap-2 p-2 rounded text-sm",
                  item.status === 'processing' && "bg-blue-50",
                  item.status === 'error' && "bg-red-50",
                  item.status === 'success' && "bg-green-50/50",
                  item.status === 'skipped' && "bg-yellow-50/50"
                )}
              >
                {statusIcons[item.status]}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{item.title}</div>
                  {item.from && (
                    <div className="text-xs text-muted-foreground truncate">{item.from}</div>
                  )}
                  {item.url && (
                    <div className="text-xs text-muted-foreground truncate">{item.url}</div>
                  )}
                  {item.error && (
                    <div className="text-xs text-red-600">{item.error}</div>
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
            <p>Klicke auf "Jetzt abrufen" um Newsletter zu laden</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
