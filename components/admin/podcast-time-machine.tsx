'use client'

import { useEffect, useState, useCallback } from 'react'
import { History, Search, Download, ChevronDown, ChevronUp, Clock, FileText, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PodcastEpisode {
  id: string
  title: string | null
  script: string | null
  audio_url: string | null
  locale: string
  duration_seconds: number | null
  created_at: string
  post_id: string
  slug: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

const LOCALE_LABELS: Record<string, string> = {
  de: 'DE',
  en: 'EN',
  cs: 'CS',
  nds: 'NDS',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PodcastTimeMachine() {
  // Filter state
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo)
  const [dateTo, setDateTo] = useState(today)
  const [search, setSearch] = useState('')
  const [localeFilter, setLocaleFilter] = useState('all')

  // Data state
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchEpisodes = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (localeFilter !== 'all') params.set('locale', localeFilter)
      if (search.trim()) params.set('search', search.trim())

      const res = await fetch(`/api/admin/podcast-history?${params}`)
      const json = await res.json()

      if (!res.ok) {
        console.error('Time Machine fetch error:', json.error)
        setEpisodes([])
        return
      }

      let episodes: PodcastEpisode[] = json.episodes ?? []

      // Client-side title search (API only searched script_content)
      if (search.trim()) {
        const lower = search.trim().toLowerCase()
        episodes = episodes.filter(ep =>
          ep.title?.toLowerCase().includes(lower) ||
          ep.script?.toLowerCase().includes(lower)
        )
      }

      setEpisodes(episodes)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, search, localeFilter])

  // Initial load + refetch on filter change
  useEffect(() => {
    fetchEpisodes()
  }, [fetchEpisodes])

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            Time Machine
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Von</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[150px] h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Bis</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[150px] h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Suche</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Titel oder Script..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-[200px] h-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Locale</label>
              <Select value={localeFilter} onValueChange={setLocaleFilter}>
                <SelectTrigger className="w-[100px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="de">DE</SelectItem>
                  <SelectItem value="en">EN</SelectItem>
                  <SelectItem value="cs">CS</SelectItem>
                  <SelectItem value="nds">NDS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Episode List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Lade Episoden...
            </div>
          ) : episodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Keine Episoden gefunden</p>
            </div>
          ) : (
            <div className="divide-y">
              {episodes.map((ep) => (
                <div key={ep.id}>
                  {/* Row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === ep.id ? null : ep.id)}
                  >
                    {expandedId === ep.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {ep.title || 'Ohne Titel'}
                      </p>
                    </div>

                    <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                      {LOCALE_LABELS[ep.locale] ?? ep.locale ?? '?'}
                    </Badge>

                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatDate(ep.created_at)} {formatTime(ep.created_at)}
                    </div>

                    <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0 w-10 text-right">
                      {formatDuration(ep.duration_seconds)}
                    </span>

                    {ep.audio_url && (
                      <a
                        href={ep.audio_url}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                        title="MP3 herunterladen"
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Download className="h-4 w-4" />
                        </Button>
                      </a>
                    )}
                  </div>

                  {/* Expanded Script */}
                  {expandedId === ep.id && ep.script && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="bg-muted/50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                          {ep.script}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
