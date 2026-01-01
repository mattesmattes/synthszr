'use client'

import { useEffect, useState } from 'react'
import { Database, Calendar, Mail, FileText, Link2, Loader2, ExternalLink, Hash, Eye, Clock, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

export default function DailyRepoPage() {
  const [items, setItems] = useState<DailyRepoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  )
  const [viewingItem, setViewingItem] = useState<DailyRepoItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const supabase = createClient()

  async function deleteItem(id: string) {
    if (!confirm('Eintrag wirklich löschen?')) return
    setDeletingId(id)
    try {
      const { error } = await supabase.from('daily_repo').delete().eq('id', id)
      if (error) throw error
      await fetchItems()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Fehler beim Löschen')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [selectedDate])

  async function fetchItems() {
    setLoading(true)

    // 24-hour window: from previous day 06:00 to selected day 05:59
    // Example: For 2.1.2026, show content from 1.1.2026 06:00 to 2.1.2026 05:59
    const selectedDateObj = new Date(selectedDate)
    const startTime = new Date(selectedDateObj)
    startTime.setDate(startTime.getDate() - 1) // Previous day
    startTime.setHours(6, 0, 0, 0) // 06:00

    const endTime = new Date(selectedDateObj)
    endTime.setHours(5, 59, 59, 999) // 05:59:59 of selected day

    const { data, error } = await supabase
      .from('daily_repo')
      .select('*')
      .gte('collected_at', startTime.toISOString())
      .lte('collected_at', endTime.toISOString())
      .order('collected_at', { ascending: false })

    if (error) {
      console.error('Error fetching items:', error)
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const sourceTypeIcon = (type: string) => {
    switch (type) {
      case 'newsletter':
        return <Mail className="h-4 w-4" />
      case 'article':
        return <FileText className="h-4 w-4" />
      case 'pdf':
        return <FileText className="h-4 w-4" />
      default:
        return <Link2 className="h-4 w-4" />
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter">Daily Repo</h1>
        <p className="mt-1 text-muted-foreground">
          Alle gesammelten Inhalte aus Newslettern, Artikeln und PDFs
        </p>
      </div>

      {/* Fetch Progress Component */}
      <div className="mb-8">
        <FetchProgress onComplete={fetchItems} />
      </div>

      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          {today}
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border px-3 py-1 text-sm"
        />
      </div>

      {/* Statistics Summary */}
      {!loading && items.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-foreground">
                  <Database className="h-5 w-5" />
                  {items.length}
                </div>
                <div className="text-xs text-muted-foreground">Gesamt</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-blue-600">
                  <Mail className="h-5 w-5" />
                  {items.filter(i => i.source_type === 'newsletter').length}
                </div>
                <div className="text-xs text-muted-foreground">Newsletter</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-green-600">
                  <FileText className="h-5 w-5" />
                  {items.filter(i => i.source_type === 'article').length}
                </div>
                <div className="text-xs text-muted-foreground">Artikel</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-purple-600">
                  <Hash className="h-5 w-5" />
                  {(items.reduce((sum, i) => sum + (i.content?.length || 0), 0) / 1000).toFixed(1)}k
                </div>
                <div className="text-xs text-muted-foreground">Zeichen</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Noch keine Inhalte
            </CardTitle>
            <CardDescription>
              Für diesen Tag wurden noch keine Inhalte gesammelt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Das Daily Repo sammelt automatisch:
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
              <li>Newsletter-Inhalte von whitelisted Absendern</li>
              <li>Vollständige Artikel hinter Teaser-Links</li>
              <li>PDFs von Paywall-geschützten Quellen</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
                  {/* Type Icon */}
                  <div className="shrink-0">
                    {sourceTypeIcon(item.source_type)}
                  </div>

                  {/* Title & Source */}
                  <div className="min-w-[200px] max-w-[300px]">
                    <div className="font-medium truncate">{item.title}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(item.collected_at).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {item.source_email && (
                        <span className="ml-2 truncate">{item.source_email}</span>
                      )}
                    </div>
                  </div>

                  {/* Type Badge */}
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {item.source_type}
                  </Badge>

                  {/* Character Count */}
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {((item.content?.length || 0) / 1000).toFixed(1)}k
                  </Badge>

                  {/* Preview */}
                  <div className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
                    {item.content?.slice(0, 80).replace(/\n/g, ' ')}...
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setViewingItem(item)}
                      title="Inhalt anzeigen"
                      className="h-8 w-8"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {item.source_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        asChild
                        title="Original öffnen"
                        className="h-8 w-8"
                      >
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteItem(item.id)}
                      disabled={deletingId === item.id}
                      title="Löschen"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* View Item Dialog */}
      <Dialog open={!!viewingItem} onOpenChange={() => setViewingItem(null)}>
        <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewingItem && sourceTypeIcon(viewingItem.source_type)}
              {viewingItem?.title}
            </DialogTitle>
            <DialogDescription>
              {viewingItem?.source_email && `Von: ${viewingItem.source_email} • `}
              {viewingItem && `Gesammelt: ${new Date(viewingItem.collected_at).toLocaleString('de-DE')}`}
              {viewingItem?.content && ` • ${(viewingItem.content.length / 1000).toFixed(1)}k Zeichen`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* Source URL */}
            {viewingItem?.source_url && (
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <a
                  href={viewingItem.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline truncate"
                >
                  {viewingItem.source_url}
                </a>
              </div>
            )}

            {/* Full Content */}
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap text-sm font-sans bg-muted/30 p-4 rounded-lg overflow-auto max-h-[60vh]">
                {viewingItem?.content}
              </pre>
            </div>

            {/* Extracted Links */}
            {viewingItem?.metadata?.article_urls && viewingItem.metadata.article_urls.length > 0 && (
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Extrahierte Links ({viewingItem.metadata.article_urls.length})
                </h3>
                <ul className="space-y-1">
                  {viewingItem.metadata.article_urls.map((url, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
