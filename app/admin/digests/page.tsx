'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Sparkles, Play, Calendar, Loader2, Copy, Check, Save, PenTool, FileText, Gauge, Mail, Link2, Hash, ChevronDown, BookOpen, ExternalLink, Trash2, Clock, AlertCircle, ImageIcon, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
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
import { Progress } from '@/components/ui/progress'
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

interface DevelopedSynthesis {
  id: string
  synthesis_headline: string | null
  synthesis_content: string
  historical_reference: string | null
  core_thesis_alignment: number | null
  created_at: string
}

interface RepoDate {
  date: string
  count: number
}

interface SynthesisProgress {
  phase: 'searching' | 'scoring' | 'developing' | 'complete' | 'error'
  currentItem: number
  totalItems: number
  itemTitle: string
  syntheses: Array<{
    headline: string
    content: string
    historicalReference: string
  }>
  error?: string
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
  const [repoDates, setRepoDates] = useState<RepoDate[]>([])
  const [sourceSummary, setSourceSummary] = useState<SourceSummary>({
    items: [],
    newsletterCount: 0,
    articleCount: 0,
    totalCharacters: 0,
    loading: false,
  })

  const [viewingDigest, setViewingDigest] = useState<Digest | null>(null)
  const [digestSources, setDigestSources] = useState<SourceItem[]>([])
  // Track which item IDs are being analyzed - these will be stored as sources_used
  const [analyzedItemIds, setAnalyzedItemIds] = useState<string[]>([])
  const [loadingDigestSources, setLoadingDigestSources] = useState(false)
  const [digestSyntheses, setDigestSyntheses] = useState<DevelopedSynthesis[]>([])
  const [loadingDigestSyntheses, setLoadingDigestSyntheses] = useState(false)

  // Synthesis progress dialog state
  const [synthesisProgressOpen, setSynthesisProgressOpen] = useState(false)
  const [synthesisProgress, setSynthesisProgress] = useState<SynthesisProgress>({
    phase: 'searching',
    currentItem: 0,
    totalItems: 0,
    itemTitle: '',
    syntheses: [],
  })

  const [ghostwriterOpen, setGhostwriterOpen] = useState(false)
  const [ghostwriterDigest, setGhostwriterDigest] = useState<Digest | null>(null)
  const [ghostwriting, setGhostwriting] = useState(false)
  const [blogContent, setBlogContent] = useState('')
  const [blogCopied, setBlogCopied] = useState(false)
  const [vocabularyIntensity, setVocabularyIntensity] = useState(50)
  const [savingBlog, setSavingBlog] = useState(false)
  const [deletingDigestId, setDeletingDigestId] = useState<string | null>(null)

  const supabase = createClient()

  // Set of dates that have repos
  const repoDateSet = useMemo(() => new Set(repoDates.map(r => r.date)), [repoDates])
  const hasRepoForSelectedDate = repoDateSet.has(selectedDate)

  useEffect(() => {
    fetchDigests()
    fetchRepoDates()
  }, [])

  useEffect(() => {
    loadSourceSummary()
  }, [selectedDate])

  async function fetchRepoDates() {
    const { data } = await supabase
      .from('daily_repo')
      .select('newsletter_date')
      .order('newsletter_date', { ascending: false })

    if (data) {
      const dateMap = new Map<string, number>()
      for (const item of data) {
        if (item.newsletter_date) {
          dateMap.set(item.newsletter_date, (dateMap.get(item.newsletter_date) || 0) + 1)
        }
      }
      setRepoDates(Array.from(dateMap.entries()).map(([date, count]) => ({ date, count })))
    }
  }

  async function loadSourceSummary() {
    setSourceSummary(prev => ({ ...prev, loading: true }))

    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, title, source_type, source_email, source_url, content')
      .eq('newsletter_date', selectedDate)
      .order('collected_at', { ascending: false })

    if (!error && data) {
      const items = data as SourceItem[]
      setSourceSummary({
        items,
        newsletterCount: items.filter(i => i.source_type === 'newsletter').length,
        articleCount: items.filter(i => i.source_type === 'article').length,
        totalCharacters: items.reduce((sum, i) => sum + (i.content?.length || 0), 0),
        loading: false,
      })
    } else {
      setSourceSummary({ items: [], newsletterCount: 0, articleCount: 0, totalCharacters: 0, loading: false })
    }
  }

  async function fetchDigests() {
    setLoading(true)
    const { data, error } = await supabase
      .from('daily_digests')
      .select('*')
      .order('digest_date', { ascending: false })
      .limit(20)

    if (!error && data) {
      setDigests(data)
    }
    setLoading(false)
  }

  const startAnalysis = useCallback(async () => {
    setAnalyzing(true)
    setStreamedContent('')
    setAnalyzedItemIds([]) // Reset the analyzed item IDs

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
              // Capture the item IDs from the first event
              if (data.type === 'sources' && data.itemIds) {
                console.log(`[Analyze] Received ${data.itemIds.length} source item IDs`)
                setAnalyzedItemIds(data.itemIds)
              }
              if (data.text) setStreamedContent(prev => prev + data.text)
              if (data.error) throw new Error(data.error)
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
      // Use the analyzedItemIds captured during the analysis phase
      // These are the ACTUAL items that were sent to Gemini, not title-matched
      // Title matching fails because Gemini rewrites everything
      const sourcesUsed = analyzedItemIds.length > 0 ? analyzedItemIds : null

      console.log(`[Digest] Using ${analyzedItemIds.length} analyzed item IDs as sources_used`)

      const { data, error } = await supabase.from('daily_digests').insert({
        digest_date: selectedDate,
        analysis_content: streamedContent,
        word_count: streamedContent.split(/\s+/).length,
        sources_used: sourcesUsed,
      }).select('id').single()
      if (error) throw error

      await fetchDigests()
      setStreamedContent('')
      setSaving(false)

      // Start streaming synthesis pipeline with progress dialog
      if (data?.id) {
        startSynthesisWithProgress(data.id)
      }
    } catch (error) {
      console.error('Save error:', error)
      alert('Fehler beim Speichern')
      setSaving(false)
    }
  }

  async function startSynthesisWithProgress(digestId: string) {
    // Reset and open progress dialog
    setSynthesisProgress({
      phase: 'searching',
      currentItem: 0,
      totalItems: 0,
      itemTitle: '',
      syntheses: [],
    })
    setSynthesisProgressOpen(true)

    try {
      const response = await fetch('/api/synthesis-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestId }),
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Synthese fehlgeschlagen')
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
              const event = JSON.parse(line.slice(6))

              if (event.type === 'init') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  totalItems: event.totalItems,
                }))
              } else if (event.type === 'searching' || event.type === 'scoring') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  phase: event.type,
                  currentItem: event.currentItem,
                  totalItems: event.totalItems,
                  itemTitle: event.itemTitle,
                }))
              } else if (event.type === 'developing') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  phase: 'developing',
                  currentItem: event.currentItem,
                  totalItems: event.totalItems,
                  itemTitle: event.itemTitle,
                }))
              } else if (event.type === 'developed') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  currentItem: event.currentItem,
                  syntheses: [...prev.syntheses, event.synthesis],
                }))
              } else if (event.type === 'complete') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  phase: 'complete',
                }))
              } else if (event.type === 'error') {
                setSynthesisProgress(prev => ({
                  ...prev,
                  phase: 'error',
                  error: event.error,
                }))
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }
    } catch (error) {
      console.error('Synthesis stream error:', error)
      setSynthesisProgress(prev => ({
        ...prev,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      }))
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(streamedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function openDigestDetail(digest: Digest) {
    setViewingDigest(digest)
    setLoadingDigestSources(true)
    setLoadingDigestSyntheses(true)
    setDigestSources([])
    setDigestSyntheses([])

    // Fetch sources and syntheses in parallel
    const [sourcesResult, synthesesResult] = await Promise.all([
      supabase
        .from('daily_repo')
        .select('id, title, source_type, source_email, source_url, content')
        .eq('newsletter_date', digest.digest_date)
        .order('collected_at', { ascending: true }),
      supabase
        .from('developed_syntheses')
        .select('id, synthesis_headline, synthesis_content, historical_reference, core_thesis_alignment, created_at')
        .eq('digest_id', digest.id)
        .order('core_thesis_alignment', { ascending: false })
    ])

    if (sourcesResult.data) setDigestSources(sourcesResult.data as SourceItem[])
    if (synthesesResult.data) setDigestSyntheses(synthesesResult.data as DevelopedSynthesis[])

    setLoadingDigestSources(false)
    setLoadingDigestSyntheses(false)
  }

  async function triggerSynthesis(digest: Digest) {
    // Close detail dialog and open progress dialog
    setViewingDigest(null)
    startSynthesisWithProgress(digest.id)
  }

  function openGhostwriter(digest: Digest) {
    setGhostwriterDigest(digest)
    setBlogContent('')
    setGhostwriterOpen(true)
  }

  function copyBlogToClipboard() {
    navigator.clipboard.writeText(blogContent)
    setBlogCopied(true)
    setTimeout(() => setBlogCopied(false), 2000)
  }

  async function deleteDigest(digestId: string) {
    if (!confirm('Digest wirklich löschen?')) return
    setDeletingDigestId(digestId)
    try {
      const { error } = await supabase.from('daily_digests').delete().eq('id', digestId)
      if (error) throw error
      await fetchDigests()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Fehler beim Löschen')
    } finally {
      setDeletingDigestId(null)
    }
  }

  // Core save logic - reused by both auto-save and manual save
  const savePostAsDraft = useCallback(async (content: string, digest: Digest, showAlert: boolean = true): Promise<boolean> => {
    try {
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch
        ? titleMatch[1]
        : `Artikel vom ${new Date(digest.digest_date).toLocaleDateString('de-DE')}`

      const tiptapContent = markdownToTiptap(content)
      const { data: newPost, error } = await supabase.from('generated_posts').insert({
        digest_id: digest.id,
        title,
        content: JSON.stringify(tiptapContent),
        word_count: content.split(/\s+/).length,
        status: 'draft',
      }).select().single()

      if (error) throw error

      // Trigger background image generation from blog content sections
      if (newPost && content) {
        // Split blog content into sections by # or ## headings
        const sections: Array<{ title: string; content: string }> = []

        // Match all headings (# or ##) and their content
        const headingRegex = /^(#{1,2})\s+(.+)$/gm
        const matches = [...content.matchAll(headingRegex)]

        for (let i = 0; i < matches.length; i++) {
          const match = matches[i]
          const sectionTitle = match[2].trim()
          const startIndex = match.index! + match[0].length
          const endIndex = matches[i + 1]?.index ?? content.length
          const sectionContent = content.slice(startIndex, endIndex).trim()

          // Skip very short sections but be more lenient (> 50 chars)
          if (sectionContent.length > 50) {
            sections.push({ title: sectionTitle, content: sectionContent })
          }
        }

        // Take up to 3 sections for image generation
        const sectionsToProcess = sections.slice(0, 3)

        console.log(`[ImageGen] Found ${sections.length} sections, processing ${sectionsToProcess.length}`)

        if (sectionsToProcess.length > 0) {
          console.log(`[ImageGen] Triggering image generation for post ${newPost.id}`)
          fetch('/api/generate-image', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: newPost.id,
              newsItems: sectionsToProcess.map(s => ({
                text: `${s.title}\n\n${s.content.slice(0, 2000)}`,
              })),
            }),
          })
            .then(res => {
              if (!res.ok) {
                console.error('[ImageGen] API returned error:', res.status)
              } else {
                console.log('[ImageGen] Image generation request sent successfully')
              }
            })
            .catch(err => console.error('[ImageGen] Fetch error:', err))
        } else {
          console.log('[ImageGen] No sections found to process')
        }
      }

      if (showAlert) {
        alert('Artikel als Entwurf gespeichert! Bilder werden im Hintergrund generiert.')
      }
      return true
    } catch (error) {
      console.error('Save error:', error)
      if (showAlert) {
        alert('Fehler beim Speichern')
      }
      return false
    }
  }, [supabase])

  // Manual save button handler
  async function saveBlogAsDraft() {
    if (!blogContent || !ghostwriterDigest) return
    setSavingBlog(true)
    const success = await savePostAsDraft(blogContent, ghostwriterDigest, true)
    if (success) {
      setGhostwriterOpen(false)
    }
    setSavingBlog(false)
  }

  const startGhostwriting = useCallback(async () => {
    if (!ghostwriterDigest) return
    setGhostwriting(true)
    setBlogContent('')

    let finalContent = ''

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
                finalContent += data.text
                setBlogContent(prev => prev + data.text)
              }
              if (data.error) throw new Error(data.error)
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }

      // Auto-save as draft after successful generation
      if (finalContent && !finalContent.includes('**Fehler:**')) {
        console.log('[AutoSave] Saving draft automatically...')
        const success = await savePostAsDraft(finalContent, ghostwriterDigest, false)
        if (success) {
          console.log('[AutoSave] Draft saved successfully')
          setGhostwriterOpen(false)
        }
      }
    } catch (error) {
      console.error('Ghostwriter error:', error)
      setBlogContent(prev => prev + `\n\n**Fehler:** ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    } finally {
      setGhostwriting(false)
    }
  }, [ghostwriterDigest, vocabularyIntensity, savePostAsDraft])

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">News und Synthese</h1>
        <p className="text-xs text-muted-foreground">AI-generierte Analysen aus dem Daily Repo</p>
      </div>

      {/* Analysis Section */}
      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded border px-2 py-0.5 text-xs h-7 bg-background"
              >
                {repoDates.map((rd) => (
                  <option key={rd.date} value={rd.date}>
                    {new Date(rd.date).toLocaleDateString('de-DE', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })} ({rd.count} Einträge)
                  </option>
                ))}
                {!repoDateSet.has(selectedDate) && (
                  <option value={selectedDate}>
                    {new Date(selectedDate).toLocaleDateString('de-DE')} (kein Repo)
                  </option>
                )}
              </select>
            </div>
            <Button
              size="sm"
              onClick={startAnalysis}
              disabled={analyzing || !hasRepoForSelectedDate}
              className="gap-1.5 text-xs h-7"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analysiere...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Analyse starten
                </>
              )}
            </Button>
          </div>

          {/* No Repo Warning */}
          {!hasRepoForSelectedDate && !sourceSummary.loading && (
            <div className="flex items-center gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Kein Repo für dieses Datum. Erstelle zuerst ein Repo unter &quot;Daily Repo&quot;.</span>
            </div>
          )}

          {/* Source Summary */}
          {sourceSummary.loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Lade Quellen...
            </div>
          ) : sourceSummary.items.length > 0 && (
            <Collapsible open={sourceListOpen} onOpenChange={setSourceListOpen}>
              <div className="rounded border bg-muted/30 p-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="flex items-center justify-center gap-1 text-base font-bold text-blue-600">
                      <Mail className="h-3 w-3" />
                      {sourceSummary.newsletterCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Newsletter</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-base font-bold text-green-600">
                      <Link2 className="h-3 w-3" />
                      {sourceSummary.articleCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Artikel</div>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-1 text-base font-bold text-purple-600">
                      <Hash className="h-3 w-3" />
                      {(sourceSummary.totalCharacters / 1000).toFixed(0)}k
                    </div>
                    <div className="text-[10px] text-muted-foreground">Zeichen</div>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground w-full py-1.5 transition-colors">
                    <ChevronDown className={`h-2.5 w-2.5 transition-transform ${sourceListOpen ? 'rotate-180' : ''}`} />
                    {sourceListOpen ? 'Ausblenden' : `${sourceSummary.items.length} Headlines`}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 pt-2 border-t space-y-1 max-h-48 overflow-y-auto">
                    {sourceSummary.items.map((item) => (
                      <div key={item.id} className="flex items-start gap-1.5 text-[11px]">
                        {item.source_type === 'newsletter' ? (
                          <Mail className="h-2.5 w-2.5 text-blue-500 mt-0.5 shrink-0" />
                        ) : (
                          <Link2 className="h-2.5 w-2.5 text-green-500 mt-0.5 shrink-0" />
                        )}
                        <span className="truncate">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Streamed Output */}
          {(streamedContent || analyzing) && (
            <div className="space-y-2">
              <div className="prose prose-sm max-w-none rounded border bg-muted/30 p-3 max-h-[300px] overflow-y-auto text-xs">
                {analyzing && !streamedContent && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Claude analysiert...
                  </div>
                )}
                <ReactMarkdown>{streamedContent}</ReactMarkdown>
                {analyzing && streamedContent && (
                  <span className="inline-block w-1.5 h-3 bg-primary animate-pulse ml-0.5" />
                )}
              </div>
              {!analyzing && streamedContent && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyToClipboard} className="text-xs h-7">
                    {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                    {copied ? 'Kopiert!' : 'Kopieren'}
                  </Button>
                  <Button size="sm" onClick={saveDigest} disabled={saving} className="text-xs h-7">
                    {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                    Speichern
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Digests List */}
      <div className="text-xs font-medium text-muted-foreground mb-2">Gespeicherte Digests</div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : digests.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-xs text-muted-foreground">
            Noch keine Digests gespeichert
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[50vh] overflow-y-auto">
              {digests.map((digest) => (
                <div key={digest.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors">
                  <div className="min-w-[100px]">
                    <div className="text-xs font-medium">
                      {new Date(digest.digest_date).toLocaleDateString('de-DE', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(digest.created_at).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 h-4">
                    {digest.word_count} W
                  </Badge>
                  <div className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
                    {digest.analysis_content.slice(0, 80).replace(/[#*_\[\]]/g, '')}...
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openDigestDetail(digest)} className="h-6 w-6">
                      <BookOpen className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteDigest(digest.id)}
                      disabled={deletingDigestId === digest.id}
                      className="h-6 w-6 text-destructive hover:text-destructive"
                    >
                      {deletingDigestId === digest.id ? (
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

      {/* Ghostwriter Dialog */}
      <Dialog open={ghostwriterOpen} onOpenChange={setGhostwriterOpen}>
        <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <PenTool className="h-4 w-4" />
              Ghostwriter
            </DialogTitle>
            <DialogDescription className="text-xs">
              {ghostwriterDigest && `Blogpost aus Digest vom ${new Date(ghostwriterDigest.digest_date).toLocaleDateString('de-DE')}`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {!blogContent && !ghostwriting ? (
              <div className="space-y-4">
                <div className="p-3 border rounded bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge className="h-3 w-3" />
                    <Label className="text-xs font-medium">Vokabular-Intensität</Label>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">
                        {vocabularyIntensity === 0 ? 'Aus' : vocabularyIntensity <= 25 ? 'Minimal' : vocabularyIntensity <= 50 ? 'Moderat' : vocabularyIntensity <= 75 ? 'Aktiv' : 'Intensiv'}
                      </span>
                      <span className="font-medium">{vocabularyIntensity}%</span>
                    </div>
                    <Slider value={[vocabularyIntensity]} onValueChange={(v) => setVocabularyIntensity(v[0])} max={100} step={5} />
                  </div>
                </div>

                <div className="p-3 border rounded bg-muted/30">
                  <div className="flex items-center gap-2 mb-1">
                    <ImageIcon className="h-3 w-3" />
                    <Label className="text-xs font-medium">Bildverarbeitung</Label>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Dithering-Einstellungen werden aus dem aktiven Bild-Prompt geladen.
                  </p>
                </div>
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-xs text-muted-foreground">Klicke auf &quot;Blogpost generieren&quot;</p>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none rounded border bg-muted/30 p-3 text-xs">
                {ghostwriting && !blogContent && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Ghostwriter schreibt...
                  </div>
                )}
                <ReactMarkdown>{blogContent}</ReactMarkdown>
                {ghostwriting && blogContent && (
                  <span className="inline-block w-1.5 h-3 bg-primary animate-pulse ml-0.5" />
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-3">
            {!blogContent && !ghostwriting ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setGhostwriterOpen(false)} className="text-xs h-7">
                  Abbrechen
                </Button>
                <Button size="sm" onClick={startGhostwriting} className="gap-1.5 text-xs h-7">
                  <PenTool className="h-3 w-3" />
                  Blogpost generieren
                </Button>
              </>
            ) : ghostwriting ? (
              <Button disabled size="sm" className="text-xs h-7">
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Generiere...
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setGhostwriterOpen(false)} className="text-xs h-7">
                  Schließen
                </Button>
                <Button variant="outline" size="sm" onClick={copyBlogToClipboard} className="text-xs h-7">
                  {blogCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {blogCopied ? 'Kopiert!' : 'Kopieren'}
                </Button>
                <Button variant="outline" size="sm" onClick={startGhostwriting} className="text-xs h-7">
                  <PenTool className="h-3 w-3 mr-1" />
                  Neu
                </Button>
                <Button size="sm" onClick={saveBlogAsDraft} disabled={savingBlog} className="text-xs h-7">
                  {savingBlog ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                  Speichern
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Digest Detail Dialog */}
      <Dialog open={!!viewingDigest} onOpenChange={() => setViewingDigest(null)}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4" />
              Digest vom {viewingDigest && new Date(viewingDigest.digest_date).toLocaleDateString('de-DE')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {viewingDigest?.word_count && `${viewingDigest.word_count} Wörter`}
              {digestSources.length > 0 && ` • ${digestSources.length} Quellen`}
              {digestSyntheses.length > 0 && ` • ${digestSyntheses.length} Synthesen`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-3">
            {loadingDigestSources ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Lade Quellen...
              </div>
            ) : digestSources.length > 0 && (
              <div className="border rounded p-3 bg-muted/30">
                <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                  <Link2 className="h-3 w-3" />
                  Quellen ({digestSources.length})
                </h3>
                <div className="space-y-1">
                  {digestSources.map((source) => (
                    <div key={source.id} className="flex items-start gap-2 text-[11px]">
                      <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 h-4">
                        {source.source_type}
                      </Badge>
                      {source.source_url ? (
                        <a href={source.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1 truncate">
                          {source.title}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="truncate">{source.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Syntheses Section */}
            {loadingDigestSyntheses ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Lade Synthesen...
              </div>
            ) : digestSyntheses.length > 0 && (
              <div className="border rounded p-3 bg-[#E8FF00]/10 border-[#E8FF00]/30">
                <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
                  <Lightbulb className="h-3 w-3 text-[#E8FF00]" />
                  <span>Mattes Synthese ({digestSyntheses.length})</span>
                </h3>
                <div className="space-y-3">
                  {digestSyntheses.map((synthesis) => (
                    <div key={synthesis.id} className="border-l-2 border-[#E8FF00] pl-3 py-1">
                      {synthesis.synthesis_headline && (
                        <h4 className="text-xs font-medium mb-1">{synthesis.synthesis_headline}</h4>
                      )}
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {synthesis.synthesis_content}
                      </p>
                      {synthesis.historical_reference && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1.5 italic">
                          ↩ {synthesis.historical_reference}
                        </p>
                      )}
                      {synthesis.core_thesis_alignment !== null && (
                        <Badge variant="outline" className="mt-1.5 text-[9px] px-1.5 py-0 h-4 bg-[#E8FF00]/20 border-[#E8FF00]/40">
                          Relevanz: {synthesis.core_thesis_alignment}/10
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewingDigest?.analysis_content && (
              <div className="prose prose-sm max-w-none dark:prose-invert text-xs">
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

          <DialogFooter className="border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setViewingDigest(null)} className="text-xs h-7">
              Schließen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => viewingDigest && triggerSynthesis(viewingDigest)}
              className="gap-1.5 text-xs h-7"
            >
              <Lightbulb className="h-3 w-3" />
              Synthese starten
            </Button>
            <Button size="sm" onClick={() => {
              setViewingDigest(null)
              if (viewingDigest) openGhostwriter(viewingDigest)
            }} className="gap-1.5 text-xs h-7">
              <PenTool className="h-3 w-3" />
              Blogpost erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Synthesis Progress Dialog */}
      <Dialog open={synthesisProgressOpen} onOpenChange={setSynthesisProgressOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4 text-[#E8FF00]" />
              Synthese-Generierung
            </DialogTitle>
            <DialogDescription className="text-xs">
              {synthesisProgress.phase === 'complete'
                ? `${synthesisProgress.syntheses.length} Synthesen erstellt`
                : synthesisProgress.phase === 'error'
                ? 'Fehler bei der Synthese'
                : 'Historische Verbindungen werden analysiert...'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-3">
            {/* Progress Section */}
            {synthesisProgress.phase !== 'complete' && synthesisProgress.phase !== 'error' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {synthesisProgress.phase === 'searching' && '🔍 Suche ähnliche Artikel...'}
                    {synthesisProgress.phase === 'scoring' && '📊 Bewerte Kandidaten...'}
                    {synthesisProgress.phase === 'developing' && '✨ Generiere Synthese...'}
                  </span>
                  <span className="font-medium">
                    {synthesisProgress.currentItem} / {synthesisProgress.totalItems}
                  </span>
                </div>
                <Progress
                  value={
                    synthesisProgress.totalItems > 0
                      ? (synthesisProgress.currentItem / synthesisProgress.totalItems) * 100
                      : 0
                  }
                  className="h-2"
                />
                {synthesisProgress.itemTitle && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {synthesisProgress.itemTitle}
                  </p>
                )}
              </div>
            )}

            {/* Error Message */}
            {synthesisProgress.phase === 'error' && (
              <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{synthesisProgress.error}</span>
              </div>
            )}

            {/* Generated Syntheses */}
            {synthesisProgress.syntheses.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold flex items-center gap-1.5">
                  <Lightbulb className="h-3 w-3 text-[#E8FF00]" />
                  Generierte Synthesen ({synthesisProgress.syntheses.length})
                </h3>
                <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                  {synthesisProgress.syntheses.map((synthesis, index) => (
                    <div
                      key={index}
                      className="border-l-2 border-[#E8FF00] pl-3 py-2 bg-[#E8FF00]/5 rounded-r"
                    >
                      <h4 className="text-xs font-medium mb-1">{synthesis.headline}</h4>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {synthesis.content}
                      </p>
                      {synthesis.historicalReference && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1.5 italic">
                          ↩ {synthesis.historicalReference}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {synthesisProgress.phase !== 'error' &&
              synthesisProgress.syntheses.length === 0 &&
              synthesisProgress.phase !== 'complete' && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#E8FF00] mb-3" />
                  <p className="text-xs text-muted-foreground">
                    Analysiere historische Verbindungen...
                  </p>
                </div>
              )}

            {/* Complete State */}
            {synthesisProgress.phase === 'complete' && synthesisProgress.syntheses.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-xs text-muted-foreground">
                  Keine passenden historischen Verbindungen gefunden.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSynthesisProgressOpen(false)}
              className="text-xs h-7"
            >
              {synthesisProgress.phase === 'complete' || synthesisProgress.phase === 'error'
                ? 'Schließen'
                : 'Im Hintergrund fortsetzen'}
            </Button>
            {synthesisProgress.phase === 'complete' && synthesisProgress.syntheses.length > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  setSynthesisProgressOpen(false)
                  // Could open ghostwriter here if desired
                }}
                className="gap-1.5 text-xs h-7"
              >
                <Check className="h-3 w-3" />
                Fertig
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
