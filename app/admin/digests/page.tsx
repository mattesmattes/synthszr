'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, Play, Calendar, Loader2, Copy, Check, Save, PenTool, FileText, Gauge, Mail, Link2, Hash, ChevronDown, BookOpen, ExternalLink, Trash2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import ReactMarkdown from 'react-markdown'
import { markdownToTiptap } from '@/lib/utils/markdown-to-tiptap'

interface SourceItem {
  id: string
  title: string
  source_type: 'newsletter' | 'article'
  source_email: string | null
  source_url: string | null
  content: string | null
}

interface SourceSummary {
  items: SourceItem[]
  newsletterCount: number
  articleCount: number
  totalCharacters: number
  loading: boolean
}

interface Digest {
  id: string
  digest_date: string
  analysis_content: string
  created_at: string
  word_count: number | null
}

export default function DigestsPage() {
  const [digests, setDigests] = useState<Digest[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sourceListOpen, setSourceListOpen] = useState(false)
  const [sourceSummary, setSourceSummary] = useState<SourceSummary>({
    items: [],
    newsletterCount: 0,
    articleCount: 0,
    totalCharacters: 0,
    loading: false,
  })

  // Digest detail view state
  const [viewingDigest, setViewingDigest] = useState<Digest | null>(null)
  const [digestSources, setDigestSources] = useState<SourceItem[]>([])
  const [loadingDigestSources, setLoadingDigestSources] = useState(false)

  // Ghostwriter state
  const [ghostwriterOpen, setGhostwriterOpen] = useState(false)
  const [ghostwriterDigest, setGhostwriterDigest] = useState<Digest | null>(null)
  const [ghostwriting, setGhostwriting] = useState(false)
  const [blogContent, setBlogContent] = useState('')
  const [blogCopied, setBlogCopied] = useState(false)
  const [vocabularyIntensity, setVocabularyIntensity] = useState(50)

  const supabase = createClient()

  useEffect(() => {
    fetchDigests()
  }, [])

  // Load source summary when date changes
  useEffect(() => {
    async function loadSourceSummary() {
      setSourceSummary(prev => ({ ...prev, loading: true }))

      const { data, error } = await supabase
        .from('daily_repo')
        .select('id, title, source_type, source_email, source_url, content')
        .eq('newsletter_date', selectedDate)
        .order('collected_at', { ascending: false })

      if (!error && data) {
        const items = data as SourceItem[]
        const newsletterCount = items.filter(i => i.source_type === 'newsletter').length
        const articleCount = items.filter(i => i.source_type === 'article').length
        const totalCharacters = items.reduce((sum, i) => sum + (i.content?.length || 0), 0)

        setSourceSummary({
          items,
          newsletterCount,
          articleCount,
          totalCharacters,
          loading: false,
        })
      } else {
        setSourceSummary({
          items: [],
          newsletterCount: 0,
          articleCount: 0,
          totalCharacters: 0,
          loading: false,
        })
      }
    }

    loadSourceSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  async function fetchDigests() {
    setLoading(true)
    const { data, error } = await supabase
      .from('daily_digests')
      .select('*')
      .order('digest_date', { ascending: false })
      .limit(10)

    if (!error && data) {
      setDigests(data)
    }
    setLoading(false)
  }

  const startAnalysis = useCallback(async () => {
    setAnalyzing(true)
    setStreamedContent('')

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Analyse fehlgeschlagen')
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
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                setStreamedContent(prev => prev + data.text)
              }
              if (data.error) {
                throw new Error(data.error)
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }
    } catch (error) {
      console.error('Analysis error:', error)
      setStreamedContent(prev => prev + `\n\n**Fehler:** ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    } finally {
      setAnalyzing(false)
    }
  }, [selectedDate])

  async function saveDigest() {
    if (!streamedContent) return

    setSaving(true)
    try {
      const wordCount = streamedContent.split(/\s+/).length

      const { error } = await supabase.from('daily_digests').insert({
        digest_date: selectedDate,
        analysis_content: streamedContent,
        word_count: wordCount,
      })

      if (error) throw error

      await fetchDigests()
      setStreamedContent('')
    } catch (error) {
      console.error('Save error:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(streamedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Digest detail functions
  async function openDigestDetail(digest: Digest) {
    setViewingDigest(digest)
    setLoadingDigestSources(true)
    setDigestSources([])

    // Load sources for this digest's date
    const { data } = await supabase
      .from('daily_repo')
      .select('id, title, source_type, source_email, source_url, content')
      .eq('newsletter_date', digest.digest_date)
      .order('collected_at', { ascending: true })

    if (data) {
      setDigestSources(data as SourceItem[])
    }
    setLoadingDigestSources(false)
  }

  // Ghostwriter functions
  function openGhostwriter(digest: Digest) {
    setGhostwriterDigest(digest)
    setBlogContent('')
    setGhostwriterOpen(true)
  }

  const startGhostwriting = useCallback(async () => {
    if (!ghostwriterDigest) return

    setGhostwriting(true)
    setBlogContent('')

    try {
      const response = await fetch('/api/ghostwriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestId: ghostwriterDigest.id, vocabularyIntensity }),
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Ghostwriter fehlgeschlagen')
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
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                setBlogContent(prev => prev + data.text)
              }
              if (data.error) {
                throw new Error(data.error)
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }
    } catch (error) {
      console.error('Ghostwriter error:', error)
      setBlogContent(prev => prev + `\n\n**Fehler:** ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    } finally {
      setGhostwriting(false)
    }
  }, [ghostwriterDigest, vocabularyIntensity])

  function copyBlogToClipboard() {
    navigator.clipboard.writeText(blogContent)
    setBlogCopied(true)
    setTimeout(() => setBlogCopied(false), 2000)
  }

  const [savingBlog, setSavingBlog] = useState(false)
  const [deletingDigestId, setDeletingDigestId] = useState<string | null>(null)

  async function deleteDigest(digestId: string) {
    if (!confirm('Digest wirklich löschen?')) return

    setDeletingDigestId(digestId)
    try {
      const { error } = await supabase
        .from('daily_digests')
        .delete()
        .eq('id', digestId)

      if (error) throw error
      await fetchDigests()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Fehler beim Löschen')
    } finally {
      setDeletingDigestId(null)
    }
  }

  async function saveBlogAsDraft() {
    if (!blogContent || !ghostwriterDigest) {
      console.warn('[Save Draft] Missing content or digest')
      return
    }

    setSavingBlog(true)
    try {
      // Extract title from first heading or create default
      const titleMatch = blogContent.match(/^#\s+(.+)$/m)
      const title = titleMatch
        ? titleMatch[1]
        : `Artikel vom ${new Date(ghostwriterDigest.digest_date).toLocaleDateString('de-DE')}`

      // Convert markdown to TipTap JSON and stringify for TEXT column
      const tiptapContent = markdownToTiptap(blogContent)
      const contentString = JSON.stringify(tiptapContent)

      console.log('[Save Draft] Saving:', { title, digestId: ghostwriterDigest.id, contentLength: contentString.length })

      const { data, error } = await supabase.from('generated_posts').insert({
        digest_id: ghostwriterDigest.id,
        title,
        content: contentString,
        word_count: blogContent.split(/\s+/).length,
        status: 'draft',
      }).select()

      if (error) {
        console.error('[Save Draft] Supabase error:', error)
        throw error
      }

      console.log('[Save Draft] Saved successfully:', data)
      alert('Artikel als Entwurf gespeichert!')
      setGhostwriterOpen(false)
    } catch (error) {
      console.error('[Save Draft] Error:', error)
      alert('Fehler beim Speichern: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'))
    } finally {
      setSavingBlog(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter">Digests</h1>
        <p className="mt-1 text-muted-foreground">
          AI-generierte Analysen aus dem Daily Repo
        </p>
      </div>

      {/* Analysis Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Neue Analyse
          </CardTitle>
          <CardDescription>
            Generiere eine AI-Analyse der Newsletter-Inhalte
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
            <Button
              onClick={startAnalysis}
              disabled={analyzing || sourceSummary.items.length === 0}
              className="gap-2"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analysiere...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Analyse starten
                </>
              )}
            </Button>
          </div>

          {/* Source Summary */}
          {sourceSummary.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lade Quellen...
            </div>
          ) : sourceSummary.items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Keine Inhalte für dieses Datum im Daily Repo.
              <br />
              <span className="text-xs">Wähle ein anderes Datum oder rufe zuerst Newsletter ab.</span>
            </div>
          ) : (
            <Collapsible open={sourceListOpen} onOpenChange={setSourceListOpen}>
              <div className="rounded-lg border bg-muted/30 p-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xl font-bold text-blue-600">
                      <Mail className="h-4 w-4" />
                      {sourceSummary.newsletterCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Newsletter</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xl font-bold text-green-600">
                      <Link2 className="h-4 w-4" />
                      {sourceSummary.articleCount}
                    </div>
                    <div className="text-xs text-muted-foreground">Artikel</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1.5 text-xl font-bold text-purple-600">
                      <Hash className="h-4 w-4" />
                      {(sourceSummary.totalCharacters / 1000).toFixed(1)}k
                    </div>
                    <div className="text-xs text-muted-foreground">Zeichen</div>
                  </div>
                </div>

                {/* Collapsible Headlines */}
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full py-2 transition-colors">
                    <ChevronDown className={`h-3 w-3 transition-transform ${sourceListOpen ? 'rotate-180' : ''}`} />
                    {sourceListOpen ? 'Headlines ausblenden' : `${sourceSummary.items.length} Headlines anzeigen`}
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="mt-3 pt-3 border-t space-y-2 max-h-64 overflow-y-auto">
                    {sourceSummary.items.map((item) => (
                      <div key={item.id} className="flex items-start gap-2 text-sm">
                        {item.source_type === 'newsletter' ? (
                          <Mail className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{item.title}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate">
                              {item.source_email || item.source_url || 'Unbekannt'}
                            </span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {((item.content?.length || 0) / 1000).toFixed(1)}k
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Streamed Output */}
          {(streamedContent || analyzing) && (
            <div className="space-y-3">
              <div className="prose prose-sm max-w-none rounded-lg border bg-muted/30 p-4 max-h-[500px] overflow-y-auto">
                {analyzing && !streamedContent && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Claude analysiert die Inhalte...
                  </div>
                )}
                <ReactMarkdown>{streamedContent}</ReactMarkdown>
                {analyzing && streamedContent && (
                  <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                )}
              </div>

              {!analyzing && streamedContent && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyToClipboard}>
                    {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    {copied ? 'Kopiert!' : 'Kopieren'}
                  </Button>
                  <Button size="sm" onClick={saveDigest} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Als Digest speichern
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Previous Digests */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Gespeicherte Digests</h2>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : digests.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Noch keine Digests gespeichert
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {digests.map((digest) => (
                  <div key={digest.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
                    {/* Date & Time */}
                    <div className="min-w-[180px]">
                      <div className="font-medium">
                        {new Date(digest.digest_date).toLocaleDateString('de-DE', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(digest.created_at).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>

                    {/* Word count */}
                    <Badge variant="secondary" className="shrink-0">
                      {digest.word_count} Wörter
                    </Badge>

                    {/* Preview */}
                    <div className="flex-1 min-w-0 text-sm text-muted-foreground truncate">
                      {digest.analysis_content.slice(0, 100).replace(/[#*_\[\]]/g, '')}...
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDigestDetail(digest)}
                        title="Digest anzeigen"
                        className="h-8 w-8"
                      >
                        <BookOpen className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openGhostwriter(digest)}
                        title="Blogpost erstellen"
                        className="h-8 w-8"
                      >
                        <PenTool className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteDigest(digest.id)}
                        disabled={deletingDigestId === digest.id}
                        title="Digest löschen"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {deletingDigestId === digest.id ? (
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
      </div>

      {/* Ghostwriter Dialog */}
      <Dialog open={ghostwriterOpen} onOpenChange={setGhostwriterOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              Ghostwriter
            </DialogTitle>
            <DialogDescription>
              {ghostwriterDigest && (
                <>
                  Blogpost aus Digest vom{' '}
                  {new Date(ghostwriterDigest.digest_date).toLocaleDateString('de-DE', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {!blogContent && !ghostwriting ? (
              <div className="space-y-6">
                {/* Vocabulary Intensity Slider */}
                <div className="p-4 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Gauge className="h-4 w-4" />
                    <Label className="font-medium">Vokabular-Intensität</Label>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {vocabularyIntensity === 0
                          ? 'Aus'
                          : vocabularyIntensity <= 25
                          ? 'Minimal'
                          : vocabularyIntensity <= 50
                          ? 'Moderat'
                          : vocabularyIntensity <= 75
                          ? 'Aktiv'
                          : 'Intensiv'}
                      </span>
                      <span className="text-sm font-medium">{vocabularyIntensity}%</span>
                    </div>
                    <Slider
                      value={[vocabularyIntensity]}
                      onValueChange={(value) => setVocabularyIntensity(value[0])}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      {vocabularyIntensity === 0
                        ? 'Keine Vokabular-Anweisungen werden verwendet.'
                        : vocabularyIntensity <= 25
                        ? 'Begriffe werden nur gelegentlich und natürlich eingesetzt.'
                        : vocabularyIntensity <= 50
                        ? 'Moderate Nutzung mit natürlichem Lesefluss.'
                        : vocabularyIntensity <= 75
                        ? 'Begriffe werden aktiv und bewusst eingebaut.'
                        : 'Maximale Nutzung - jeder Absatz enthält Vokabular.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground mb-4">
                    Klicke auf &quot;Blogpost generieren&quot;, um aus dem Digest einen Artikel zu erstellen.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Der Ghostwriter nutzt den aktiven Prompt und das Vokabular-Wörterbuch.
                  </p>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none rounded-lg border bg-muted/30 p-4">
                {ghostwriting && !blogContent && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ghostwriter schreibt...
                  </div>
                )}
                <ReactMarkdown>{blogContent}</ReactMarkdown>
                {ghostwriting && blogContent && (
                  <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            {!blogContent && !ghostwriting ? (
              <>
                <Button variant="outline" onClick={() => setGhostwriterOpen(false)}>
                  Abbrechen
                </Button>
                <Button onClick={startGhostwriting} className="gap-2">
                  <PenTool className="h-4 w-4" />
                  Blogpost generieren
                </Button>
              </>
            ) : ghostwriting ? (
              <Button disabled className="gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generiere...
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setGhostwriterOpen(false)}>
                  Schließen
                </Button>
                <Button variant="outline" onClick={copyBlogToClipboard} className="gap-2">
                  {blogCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {blogCopied ? 'Kopiert!' : 'Kopieren'}
                </Button>
                <Button variant="outline" onClick={startGhostwriting} className="gap-2">
                  <PenTool className="h-4 w-4" />
                  Neu generieren
                </Button>
                <Button onClick={saveBlogAsDraft} disabled={savingBlog} className="gap-2">
                  {savingBlog ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Als Entwurf speichern
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Digest Detail Dialog */}
      <Dialog open={!!viewingDigest} onOpenChange={() => setViewingDigest(null)}>
        <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Digest vom {viewingDigest && new Date(viewingDigest.digest_date).toLocaleDateString('de-DE', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </DialogTitle>
            <DialogDescription>
              {viewingDigest?.word_count && `${viewingDigest.word_count} Wörter`}
              {digestSources.length > 0 && ` • ${digestSources.length} Quellen`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 py-4">
            {/* Sources Section */}
            {loadingDigestSources ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lade Quellen...
              </div>
            ) : digestSources.length > 0 && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Quellen ({digestSources.length})
                </h3>
                <div className="space-y-2">
                  {digestSources.map((source) => (
                    <div key={source.id} className="flex items-start gap-3 text-sm">
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {source.source_type}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        {source.source_url ? (
                          <a
                            href={source.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {source.title || source.source_email || 'Unbenannt'}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span>{source.title || source.source_email || 'Unbenannt'}</span>
                        )}
                        {source.source_email && source.source_url && (
                          <span className="text-muted-foreground ml-2">({source.source_email})</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Digest Content */}
            {viewingDigest?.analysis_content && (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {viewingDigest.analysis_content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setViewingDigest(null)}>
              Schließen
            </Button>
            <Button onClick={() => {
              setViewingDigest(null)
              if (viewingDigest) openGhostwriter(viewingDigest)
            }} className="gap-2">
              <PenTool className="h-4 w-4" />
              Blogpost erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
