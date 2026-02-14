'use client'

import { useEffect, useState, useMemo } from 'react'
import { Database, Calendar, Mail, FileText, Link2, Loader2, ExternalLink, Eye, Trash2, Plus, RefreshCw, StickyNote, Download, PenLine } from 'lucide-react'
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
  const [showManualDialog, setShowManualDialog] = useState(false)
  const [manualFetchUrl, setManualFetchUrl] = useState('')
  const [manualFetching, setManualFetching] = useState(false)
  const [manualSource, setManualSource] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

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


  async function fetchMarkdownFromUrl() {
    const url = manualFetchUrl.trim()
    if (!url) return
    setManualFetching(true)
    try {
      const res = await fetch(`https://markdown.new/${url}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const md = await res.text()
      if (md) {
        setManualContent(md)
        setManualUrl(url)
        // Extract domain as source name
        try {
          const domain = new URL(url).hostname.replace('www.', '')
          if (!manualSource) setManualSource(domain)
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Failed to fetch markdown:', err)
      alert('Markdown konnte nicht geladen werden: ' + (err instanceof Error ? err.message : 'Unbekannter Fehler'))
    } finally {
      setManualFetching(false)
    }
  }

  async function saveManualArticle() {
    if (!manualContent.trim()) return
    setManualSaving(true)
    try {
      // Use the most recent repo date, or today if none exists
      const targetDate = repoSummaries.length > 0 ? repoSummaries[0].date : new Date().toISOString().split('T')[0]

      const title = manualSource.trim()
        ? `${manualSource.trim()} — Manueller Artikel`
        : 'Manueller Artikel'

      const { error: insertError } = await supabase
        .from('daily_repo')
        .insert({
          source_type: 'article',
          source_url: manualUrl.trim() || null,
          title,
          content: manualContent.trim(),
          newsletter_date: targetDate,
          source_email: null,
          newsletter_source_id: null,
          source_language: 'de',
        })

      if (insertError) throw insertError

      // Reset form and close
      setManualFetchUrl('')
      setManualSource('')
      setManualUrl('')
      setManualContent('')
      setShowManualDialog(false)

      // Refresh data and navigate to the target date
      setSelectedDate(targetDate)
      fetchRepoSummaries()
      fetchItemsForDate(targetDate)
    } catch (error) {
      console.error('Manual article save error:', error)
      alert('Fehler beim Speichern')
    } finally {
      setManualSaving(false)
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

  // Current selected summary (for stats in header)
  const selectedSummary = repoSummaries.find(r => r.date === selectedDate)

  return (
    <div className="p-4 md:p-6 max-w-full">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Daily Repo</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Newsletter &amp; Artikel</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Left: Date Navigation */}
        <div>
          {/* Abrufen + Date Picker */}
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" onClick={() => setShowFetchDialog(true)} className="gap-1.5 text-xs h-8 flex-1">
              <RefreshCw className="h-3.5 w-3.5" />
              Abrufen
            </Button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-md border px-2.5 py-1 text-xs h-8 bg-background"
              style={{ fontWeight: hasRepoForDate(selectedDate) ? 600 : 400 }}
            />
          </div>

          {/* Date List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : repoSummaries.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
              Noch keine Repos
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="max-h-[calc(100vh-240px)] overflow-y-auto">
                {repoSummaries.map((repo) => {
                  const isSelected = selectedDate === repo.date
                  return (
                    <button
                      key={repo.date}
                      onClick={() => setSelectedDate(repo.date)}
                      className={`group w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors relative ${
                        isSelected
                          ? 'bg-primary/5'
                          : 'hover:bg-muted/40'
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
                      )}
                      <div className="flex items-center justify-between">
                        <span className={`text-[13px] ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                          {new Date(repo.date).toLocaleDateString('de-DE', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {(repo.totalChars / 1000).toFixed(0)}k
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteRepo(repo.date)
                            }}
                            disabled={deletingId === repo.date}
                            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          >
                            {deletingId === repo.date ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Mail className="h-2.5 w-2.5" />
                          {repo.newsletters}
                        </span>
                        <span className="flex items-center gap-1">
                          <FileText className="h-2.5 w-2.5" />
                          {repo.articles}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Content Area */}
        <div className="min-w-0">
          {/* Content Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold">
                {selectedDate && new Date(selectedDate).toLocaleDateString('de-DE', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </h2>
              {selectedSummary && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {selectedSummary.newsletters} Newsletter, {selectedSummary.articles} Artikel — {(selectedSummary.totalChars / 1000).toFixed(0)}k Zeichen
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {items.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={downloadRepoAsMarkdown}
                  className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                >
                  <Download className="h-3 w-3" />
                  .md
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setShowManualDialog(true)}
                className="h-7 px-2.5 text-xs gap-1.5"
              >
                <PenLine className="h-3 w-3" />
                Manuell
              </Button>
            </div>
          </div>

          {/* Article List */}
          {loadingItems ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center">
              <Database className="h-7 w-7 mx-auto mb-2.5 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Kein Repo für dieses Datum</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 text-xs h-8"
                onClick={() => {
                  setFetchDate(selectedDate)
                  setShowFetchDialog(true)
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Repo erstellen
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto divide-y">
                {items.map((item) => {
                  const faviconUrl = getFaviconUrl(item.source_url)
                  return (
                    <div
                      key={item.id}
                      className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      {/* Source icon */}
                      <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-muted/50">
                        {faviconUrl ? (
                          <img
                            src={faviconUrl}
                            alt=""
                            width={16}
                            height={16}
                            className="rounded-sm"
                            onError={(e) => {
                              // Fall back to type icon
                              e.currentTarget.style.display = 'none'
                              const parent = e.currentTarget.parentElement
                              if (parent) parent.classList.add('favicon-fallback')
                            }}
                          />
                        ) : (
                          <span className={
                            item.source_type === 'newsletter' ? 'text-blue-500' :
                            item.source_type === 'article' ? 'text-green-600' : 'text-orange-500'
                          }>
                            {sourceTypeIcon(item.source_type)}
                          </span>
                        )}
                      </div>

                      {/* Title + meta */}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate leading-snug">{item.title}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                          <span className="tabular-nums">
                            {new Date(item.collected_at).toLocaleTimeString('de-DE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {item.source_email && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              <span className="truncate max-w-[160px]">{item.source_email}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Size badge */}
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                        {((item.content?.length || 0) / 1000).toFixed(1)}k
                      </span>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewingItem(item)}
                          className="h-7 w-7"
                          title="Inhalt anzeigen"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {item.source_url && (
                          <Button variant="ghost" size="icon" asChild className="h-7 w-7" title="Original-Quelle">
                            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
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

      {/* Manual Article Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <PenLine className="h-4 w-4" />
              Artikel manuell hinzufügen
            </DialogTitle>
            <DialogDescription className="text-xs">
              Wird dem aktuellsten Repo hinzugefügt{repoSummaries.length > 0 && ` (${new Date(repoSummaries[0].date).toLocaleDateString('de-DE')})`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">URL → Markdown importieren</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://… — Artikel-URL eingeben und als Markdown laden"
                  value={manualFetchUrl}
                  onChange={(e) => setManualFetchUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchMarkdownFromUrl()}
                  className="rounded border px-2.5 py-1.5 text-sm flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchMarkdownFromUrl}
                  disabled={manualFetching || !manualFetchUrl.trim()}
                  className="text-xs h-8 gap-1.5 shrink-0"
                >
                  {manualFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Laden
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <input
                  type="text"
                  placeholder="z.B. Reuters, Bloomberg, Handelsblatt…"
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value)}
                  className="rounded border px-2.5 py-1.5 text-sm w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Source URL</label>
                <input
                  type="url"
                  placeholder="https://…"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  className="rounded border px-2.5 py-1.5 text-sm w-full"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Content</label>
              <textarea
                placeholder="Artikeltext hier einfügen…"
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                rows={16}
                className="rounded border px-2.5 py-1.5 text-sm w-full resize-y min-h-[200px]"
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t shrink-0">
            <span className="text-[10px] text-muted-foreground">
              {manualContent.length > 0 && `${(manualContent.length / 1000).toFixed(1)}k Zeichen`}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowManualDialog(false)} className="text-xs h-8">
                Abbrechen
              </Button>
              <Button
                size="sm"
                onClick={saveManualArticle}
                disabled={manualSaving || !manualContent.trim()}
                className="text-xs h-8 gap-1.5"
              >
                {manualSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Hinzufügen
              </Button>
            </div>
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
