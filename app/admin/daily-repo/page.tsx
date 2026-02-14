'use client'

import { useEffect, useState, useMemo } from 'react'
import { Database, Calendar, Mail, FileText, Link2, Loader2, ExternalLink, Hash, Eye, Clock, Trash2, Plus, RefreshCw, StickyNote, Download, Globe } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { FetchProgress } from '@/components/admin/fetch-progress'

interface DailyRepoItem {
  id: string
  source_type: string
  source_email: string | null
  source_url: string | null
  title: string
  content: string
  newsletter_date: string
  collected_at: string
  metadata: {
    links?: Array<{ url: string; text: string; type: string }>
    article_urls?: string[]
  } | null
}

interface RepoSummary {
  date: string
  count: number
  newsletters: number
  articles: number
  totalChars: number
}

export default function DailyRepoPage() {
  const [repoSummaries, setRepoSummaries] = useState<RepoSummary[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [items, setItems] = useState<DailyRepoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [viewingItem, setViewingItem] = useState<DailyRepoItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showFetchDialog, setShowFetchDialog] = useState(false)
  const [fetchDate, setFetchDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [urlInput, setUrlInput] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [crawlError, setCrawlError] = useState<string | null>(null)

  const supabase = createClient()

  // Dates that have repos
  const repoDates = useMemo(() => new Set(repoSummaries.map(r => r.date)), [repoSummaries])

  useEffect(() => {
    fetchRepoSummaries()
  }, [])

  useEffect(() => {
    if (selectedDate) {
      fetchItemsForDate(selectedDate)
    }
  }, [selectedDate])

  async function fetchRepoSummaries() {
    setLoading(true)

    // Get all unique newsletter_dates with counts
    const { data, error } = await supabase
      .from('daily_repo')
      .select('newsletter_date, source_type, content')
      .order('newsletter_date', { ascending: false })

    if (!error && data) {
      // Group by date
      const summaryMap = new Map<string, RepoSummary>()

      for (const item of data) {
        const date = item.newsletter_date
        if (!date) continue

        const existing = summaryMap.get(date) || {
          date,
          count: 0,
          newsletters: 0,
          articles: 0,
          totalChars: 0,
        }

        existing.count++
        if (item.source_type === 'newsletter') existing.newsletters++
        if (item.source_type === 'article') existing.articles++
        existing.totalChars += item.content?.length || 0

        summaryMap.set(date, existing)
      }

      setRepoSummaries(Array.from(summaryMap.values()))
    }
    setLoading(false)
  }

  async function fetchItemsForDate(date: string) {
    setLoadingItems(true)

    const { data, error } = await supabase
      .from('daily_repo')
      .select('*')
      .eq('newsletter_date', date)
      .order('collected_at', { ascending: false })

    if (!error && data) {
      setItems(data)
    } else {
      setItems([])
    }
    setLoadingItems(false)
  }

  async function deleteRepo(date: string) {
    if (!confirm(`Alle Einträge für ${new Date(date).toLocaleDateString('de-DE')} wirklich löschen?`)) return
    setDeletingId(date)
    try {
      const { error } = await supabase.from('daily_repo').delete().eq('newsletter_date', date)
      if (error) throw error
      await fetchRepoSummaries()
      if (selectedDate === date) {
        setItems([])
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('Fehler beim Löschen')
    } finally {
      setDeletingId(null)
    }
  }

  async function crawlUrl() {
    if (!urlInput.trim()) return
    setCrawling(true)
    setCrawlError(null)
    try {
      const res = await fetch('/api/admin/crawl-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim(), newsletter_date: selectedDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCrawlError(data.error || 'Fehler beim Crawlen')
        return
      }
      setUrlInput('')
      fetchItemsForDate(selectedDate)
      fetchRepoSummaries()
    } catch {
      setCrawlError('Netzwerkfehler')
    } finally {
      setCrawling(false)
    }
  }

  const sourceTypeIcon = (type: string) => {
    switch (type) {
      case 'newsletter': return <Mail className="h-3 w-3" />
      case 'article': return <FileText className="h-3 w-3" />
      case 'email_note': return <StickyNote className="h-3 w-3 text-orange-500" />
      default: return <Link2 className="h-3 w-3" />
    }
  }

  // Extract domain from URL and return favicon URL
  const getFaviconUrl = (url: string | null) => {
    if (!url) return null
    try {
      const domain = new URL(url).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
    } catch {
      return null
    }
  }

  // Check if date has a repo (for date picker styling)
  const hasRepoForDate = (dateStr: string) => repoDates.has(dateStr)

  // Download all content as markdown file
  function downloadRepoAsMarkdown() {
    if (items.length === 0) return

    const dateFormatted = new Date(selectedDate).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    // Group items by source_type
    const newsletters = items.filter(i => i.source_type === 'newsletter')
    const articles = items.filter(i => i.source_type === 'article')
    const emailNotes = items.filter(i => i.source_type === 'email_note')

    // Build markdown content
    let markdown = `# Daily Repo - ${dateFormatted}\n\n`
    markdown += `**Gesamt:** ${items.length} Einträge | ${newsletters.length} Newsletter | ${articles.length} Artikel | ${emailNotes.length} Notizen\n`
    markdown += `**Zeichen:** ${items.reduce((s, i) => s + (i.content?.length || 0), 0).toLocaleString('de-DE')}\n\n`
    markdown += `---\n\n`

    // Newsletters section
    if (newsletters.length > 0) {
      markdown += `## 📧 Newsletter (${newsletters.length})\n\n`
      for (const item of newsletters) {
        markdown += `### ${item.title}\n\n`
        markdown += `**Quelle:** ${item.source_email || 'Unbekannt'}\n`
        if (item.source_url) markdown += `**URL:** ${item.source_url}\n`
        markdown += `**Gesammelt:** ${new Date(item.collected_at).toLocaleString('de-DE')}\n\n`
        markdown += `${item.content || '*Kein Inhalt*'}\n\n`
        markdown += `---\n\n`
      }
    }

    // Articles section
    if (articles.length > 0) {
      markdown += `## 📄 Artikel (${articles.length})\n\n`
      for (const item of articles) {
        markdown += `### ${item.title}\n\n`
        if (item.source_email) markdown += `**Aus Newsletter:** ${item.source_email}\n`
        if (item.source_url) markdown += `**URL:** ${item.source_url}\n`
        markdown += `**Gesammelt:** ${new Date(item.collected_at).toLocaleString('de-DE')}\n\n`
        markdown += `${item.content || '*Kein Inhalt*'}\n\n`
        markdown += `---\n\n`
      }
    }

    // Email notes section
    if (emailNotes.length > 0) {
      markdown += `## 📝 E-Mail Notizen (${emailNotes.length})\n\n`
      for (const item of emailNotes) {
        markdown += `### ${item.title}\n\n`
        markdown += `**Von:** ${item.source_email || 'Unbekannt'}\n`
        markdown += `**Gesammelt:** ${new Date(item.collected_at).toLocaleString('de-DE')}\n\n`
        markdown += `${item.content || '*Kein Inhalt*'}\n\n`
        markdown += `---\n\n`
      }
    }

    // Create and trigger download
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-repo-${selectedDate}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">Daily Repo</h1>
        <p className="text-xs text-muted-foreground">Gesammelte Inhalte aus Newslettern und Artikeln</p>
      </div>

      {/* Actions Bar */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setShowFetchDialog(true)} className="gap-1.5 text-xs h-7">
          <Plus className="h-3 w-3" />
          Neues Repo
        </Button>
        <div className="flex items-center gap-1 flex-1 min-w-[200px] max-w-md">
          <div className="relative flex-1">
            <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              type="url"
              placeholder="URL hinzufügen…"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); setCrawlError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') crawlUrl() }}
              disabled={crawling}
              className="rounded border pl-7 pr-2 py-0.5 text-xs h-7 w-full"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={crawlUrl}
            disabled={crawling || !urlInput.trim()}
            className="text-xs h-7 px-2 shrink-0"
          >
            {crawling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded border px-2 py-0.5 text-xs h-7"
            style={{
              fontWeight: hasRepoForDate(selectedDate) ? 600 : 400,
            }}
          />
        </div>
      </div>
      {crawlError && (
        <div className="mb-3 text-xs text-destructive bg-destructive/10 rounded px-3 py-1.5">
          {crawlError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Repo List by Date */}
        <div className="lg:col-span-1">
          <div className="text-xs font-medium text-muted-foreground mb-2">Vorhandene Repos</div>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : repoSummaries.length === 0 ? (
            <Card>
              <CardContent className="py-4 text-center text-xs text-muted-foreground">
                Noch keine Repos vorhanden
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y max-h-[60vh] overflow-y-auto">
                  {repoSummaries.map((repo) => (
                    <div
                      key={repo.date}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors ${
                        selectedDate === repo.date ? 'bg-primary/10' : ''
                      }`}
                    >
                      <button
                        onClick={() => setSelectedDate(repo.date)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="text-xs font-medium">
                          {new Date(repo.date).toLocaleDateString('de-DE', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </div>
                      </button>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Mail className="h-2.5 w-2.5 text-blue-500" />
                          {repo.newsletters}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <FileText className="h-2.5 w-2.5 text-green-500" />
                          {repo.articles}
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                          {(repo.totalChars / 1000).toFixed(0)}k
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteRepo(repo.date)
                          }}
                          disabled={deletingId === repo.date}
                          className="h-5 w-5 text-destructive hover:text-destructive ml-1"
                        >
                          {deletingId === repo.date ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Items for Selected Date */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-muted-foreground">
              {selectedDate && new Date(selectedDate).toLocaleDateString('de-DE', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
            {items.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    {items.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {(items.reduce((s, i) => s + (i.content?.length || 0), 0) / 1000).toFixed(0)}k
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadRepoAsMarkdown}
                  className="h-6 px-2 text-[10px] gap-1"
                >
                  <Download className="h-3 w-3" />
                  .md
                </Button>
              </div>
            )}
          </div>

          {loadingItems ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <Database className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">Kein Repo für dieses Datum</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 text-xs h-7"
                  onClick={() => {
                    setFetchDate(selectedDate)
                    setShowFetchDialog(true)
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Repo erstellen
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y max-h-[60vh] overflow-y-auto">
                  {items.map((item) => {
                    const faviconUrl = getFaviconUrl(item.source_url)
                    return (
                    <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors text-xs">
                      <div className="shrink-0 flex items-center gap-1">
                        {/* Always show source type icon for clarity */}
                        <span className={item.source_type === 'newsletter' ? 'text-blue-500' : item.source_type === 'article' ? 'text-green-500' : 'text-orange-500'}>
                          {sourceTypeIcon(item.source_type)}
                        </span>
                        {faviconUrl && (
                          <img
                            src={faviconUrl}
                            alt=""
                            width={14}
                            height={14}
                            className="rounded-sm"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate text-xs">{item.title}</div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(item.collected_at).toLocaleTimeString('de-DE', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {item.source_email && (
                            <span className="ml-1 truncate max-w-[120px]">{item.source_email}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 h-4">
                        {((item.content?.length || 0) / 1000).toFixed(1)}k
                      </Badge>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewingItem(item)}
                          className="h-6 w-6"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        {item.source_url && (
                          <Button variant="ghost" size="icon" asChild className="h-6 w-6">
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Fetch Dialog */}
      <Dialog open={showFetchDialog} onOpenChange={setShowFetchDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />
              Newsletter abrufen
            </DialogTitle>
            <DialogDescription className="text-xs">
              Rufe Newsletter und Artikel für ein bestimmtes Datum ab
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="date"
                value={fetchDate}
                onChange={(e) => setFetchDate(e.target.value)}
                className="rounded border px-2 py-1 text-xs"
              />
            </div>
            <FetchProgress
              targetDate={fetchDate}
              onComplete={() => {
                fetchRepoSummaries()
                fetchItemsForDate(fetchDate)
                setSelectedDate(fetchDate)
                setShowFetchDialog(false)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* View Item Dialog */}
      <Dialog open={!!viewingItem} onOpenChange={() => setViewingItem(null)}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {viewingItem && sourceTypeIcon(viewingItem.source_type)}
              <span className="truncate">{viewingItem?.title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {viewingItem?.source_email && `Von: ${viewingItem.source_email} • `}
              {viewingItem && new Date(viewingItem.collected_at).toLocaleString('de-DE')}
              {viewingItem?.content && ` • ${(viewingItem.content.length / 1000).toFixed(1)}k Zeichen`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 py-3">
            {viewingItem?.source_url && (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-xs">
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                <a
                  href={viewingItem.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {viewingItem.source_url}
                </a>
              </div>
            )}
            <pre className="whitespace-pre-wrap text-xs font-sans bg-muted/30 p-3 rounded overflow-auto max-h-[55vh]">
              {viewingItem?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
