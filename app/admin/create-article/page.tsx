'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Wand2,
  Sparkles,
  BookOpen,
  PenTool,
  Loader2,
  Copy,
  Check,
  Save,
  ChevronDown,
  FileText,
  Gauge,
  Link2,
  Tag,
  Type,
  AlignLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import ReactMarkdown from 'react-markdown'
import { markdownToTiptap } from '@/lib/utils/markdown-to-tiptap'

interface Digest {
  id: string
  digest_date: string
  analysis_content: string
  word_count: number | null
}

interface GhostwriterPrompt {
  id: string
  name: string
  prompt_text: string
  is_active: boolean
}

interface VocabularyEntry {
  id: string
  term: string
  preferred_usage: string | null
  category: string
}

interface ArticleMetadata {
  title: string
  excerpt: string
  category: string
  slug: string
}

// Generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// Parse frontmatter from generated content
function parseArticleContent(content: string): { metadata: ArticleMetadata; body: string } {
  const defaultMetadata: ArticleMetadata = {
    title: '',
    excerpt: '',
    category: 'AI & Tech',
    slug: ''
  }

  // Match frontmatter block
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    // No frontmatter, try to extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      defaultMetadata.title = titleMatch[1]
      defaultMetadata.slug = generateSlug(titleMatch[1])
    }
    return { metadata: defaultMetadata, body: content }
  }

  const [, frontmatter, body] = frontmatterMatch
  const metadata = { ...defaultMetadata }

  // Parse frontmatter fields
  const titleMatch = frontmatter.match(/TITLE:\s*(.+)/i)
  const excerptMatch = frontmatter.match(/EXCERPT:\s*(.+)/i)
  const categoryMatch = frontmatter.match(/CATEGORY:\s*(.+)/i)

  if (titleMatch) metadata.title = titleMatch[1].trim()
  if (excerptMatch) metadata.excerpt = excerptMatch[1].trim()
  if (categoryMatch) metadata.category = categoryMatch[1].trim()

  metadata.slug = generateSlug(metadata.title)

  return { metadata, body: body.trim() }
}

const CATEGORIES = ['AI & Tech', 'Marketing', 'Design', 'Business', 'Code', 'Synthese']

export default function CreateArticlePage() {
  const [digests, setDigests] = useState<Digest[]>([])
  const [selectedDigestId, setSelectedDigestId] = useState<string>('')
  const [activePrompt, setActivePrompt] = useState<GhostwriterPrompt | null>(null)
  const [vocabulary, setVocabulary] = useState<VocabularyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [articleContent, setArticleContent] = useState('')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [vocabularyIntensity, setVocabularyIntensity] = useState(50)

  // Editable metadata fields
  const [metadata, setMetadata] = useState<ArticleMetadata>({
    title: '',
    excerpt: '',
    category: 'AI & Tech',
    slug: ''
  })

  // Parse content to extract metadata whenever content changes
  const parsedContent = useMemo(() => {
    if (!articleContent) return { metadata: metadata, body: '' }
    return parseArticleContent(articleContent)
  }, [articleContent])

  // Update metadata when content is parsed (only when generation completes)
  const updateMetadataFromContent = useCallback(() => {
    if (parsedContent.metadata.title) {
      setMetadata(parsedContent.metadata)
    }
  }, [parsedContent])

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load digests
      const { data: digestsData } = await supabase
        .from('daily_digests')
        .select('id, digest_date, analysis_content, word_count')
        .order('digest_date', { ascending: false })
        .limit(20)

      if (digestsData) {
        setDigests(digestsData)
        if (digestsData.length > 0) {
          setSelectedDigestId(digestsData[0].id)
        }
      }

      // Load active ghostwriter prompt
      const { data: promptData } = await supabase
        .from('ghostwriter_prompts')
        .select('*')
        .eq('is_active', true)
        .single()

      if (promptData) {
        setActivePrompt(promptData)
      }

      // Load vocabulary
      const { data: vocabData } = await supabase
        .from('vocabulary_dictionary')
        .select('id, term, preferred_usage, category')
        .order('category')
        .order('term')

      if (vocabData) {
        setVocabulary(vocabData)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const selectedDigest = digests.find(d => d.id === selectedDigestId)

  const generateArticle = useCallback(async () => {
    if (!selectedDigestId) return

    setGenerating(true)
    setArticleContent('')

    try {
      const response = await fetch('/api/ghostwriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestId: selectedDigestId, vocabularyIntensity }),
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Generierung fehlgeschlagen')
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
                setArticleContent(prev => prev + data.text)
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
      console.error('Generation error:', error)
      setArticleContent(prev => prev + `\n\n**Fehler:** ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    } finally {
      setGenerating(false)
      // Parse metadata after generation completes
      setTimeout(() => {
        const parsed = parseArticleContent(articleContent)
        if (parsed.metadata.title) {
          setMetadata(parsed.metadata)
        }
      }, 100)
    }
  }, [selectedDigestId, vocabularyIntensity, articleContent])

  function copyToClipboard() {
    navigator.clipboard.writeText(articleContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function saveAsDraft() {
    if (!articleContent || !selectedDigest) return

    setSaving(true)
    try {
      // Use the body content (without frontmatter) for the actual article
      const bodyContent = parsedContent.body || articleContent

      // Use metadata from state (which can be edited) or fallback
      const title = metadata.title || `Artikel vom ${new Date(selectedDigest.digest_date).toLocaleDateString('de-DE')}`
      const slug = metadata.slug || generateSlug(title)

      // Convert markdown to TipTap JSON and stringify for TEXT column
      const tiptapContent = markdownToTiptap(bodyContent)

      const { error } = await supabase.from('generated_posts').insert({
        digest_id: selectedDigestId,
        prompt_id: activePrompt?.id,
        title,
        slug,
        excerpt: metadata.excerpt || null,
        category: metadata.category || 'AI & Tech',
        content: JSON.stringify(tiptapContent),
        word_count: bodyContent.split(/\s+/).length,
        status: 'draft',
      })

      if (error) throw error
      alert('Artikel als Entwurf gespeichert!')

      // Reset form after successful save
      setArticleContent('')
      setMetadata({ title: '', excerpt: '', category: 'AI & Tech', slug: '' })
    } catch (error) {
      console.error('Save error:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  const groupedVocab = vocabulary.reduce((acc, entry) => {
    if (!acc[entry.category]) acc[entry.category] = []
    acc[entry.category].push(entry)
    return acc
  }, {} as Record<string, VocabularyEntry[]>)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <Wand2 className="h-8 w-8" />
          AI Artikel erstellen
        </h1>
        <p className="mt-1 text-muted-foreground">
          Generiere einen Blogartikel aus einem Digest mit dem Ghostwriter
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Settings */}
        <div className="space-y-6">
          {/* Digest Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Digest auswählen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedDigestId} onValueChange={setSelectedDigestId}>
                <SelectTrigger>
                  <SelectValue placeholder="Digest wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {digests.map(digest => (
                    <SelectItem key={digest.id} value={digest.id}>
                      {new Date(digest.digest_date).toLocaleDateString('de-DE', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {digest.word_count && (
                        <span className="text-muted-foreground ml-2">
                          ({digest.word_count} Wörter)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDigest && (
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground line-clamp-4">
                    {selectedDigest.analysis_content.slice(0, 300)}...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Prompt */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PenTool className="h-4 w-4" />
                Ghostwriter-Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activePrompt ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{activePrompt.name}</span>
                    <Badge variant="default" className="text-xs">Aktiv</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-4">
                    {activePrompt.prompt_text.slice(0, 200)}...
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Kein aktiver Prompt. Erstelle einen unter Ghostwriter-Prompts.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Vocabulary Intensity Slider */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                Vokabular-Intensität
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">
                    {vocabularyIntensity === 0
                      ? 'Aus'
                      : vocabularyIntensity <= 25
                      ? 'Minimal'
                      : vocabularyIntensity <= 50
                      ? 'Moderat'
                      : vocabularyIntensity <= 75
                      ? 'Aktiv'
                      : 'Intensiv'}
                  </Label>
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
            </CardContent>
          </Card>

          {/* Vocabulary Summary */}
          <Collapsible open={vocabOpen} onOpenChange={setVocabOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Vokabular
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{vocabulary.length} Begriffe</Badge>
                      <ChevronDown className={`h-4 w-4 transition-transform ${vocabOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </CardTitle>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                    {Object.entries(groupedVocab).map(([category, entries]) => (
                      <div key={category}>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                          {category}
                        </h4>
                        <div className="flex flex-wrap gap-1">
                          {entries.slice(0, 10).map(entry => (
                            <Badge key={entry.id} variant="outline" className="text-xs">
                              {entry.term}
                            </Badge>
                          ))}
                          {entries.length > 10 && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              +{entries.length - 10}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Generate Button */}
          <Button
            onClick={generateArticle}
            disabled={generating || !selectedDigestId || !activePrompt}
            className="w-full gap-2"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Generiere Artikel...
              </>
            ) : (
              <>
                <Wand2 className="h-5 w-5" />
                Artikel generieren
              </>
            )}
          </Button>
        </div>

        {/* Right Column: Output */}
        <div className="lg:col-span-2 space-y-4">
          {/* Metadata Card - Shows when content is generated */}
          {articleContent && !generating && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Artikel-Metadaten
                </CardTitle>
                <CardDescription>
                  Diese Felder werden automatisch befüllt und können vor dem Speichern angepasst werden
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title" className="flex items-center gap-1.5 text-sm">
                      <Type className="h-3.5 w-3.5" />
                      Titel
                    </Label>
                    <Input
                      id="title"
                      value={metadata.title}
                      onChange={(e) => setMetadata({ ...metadata, title: e.target.value, slug: generateSlug(e.target.value) })}
                      placeholder="Artikeltitel..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slug" className="flex items-center gap-1.5 text-sm">
                      <Link2 className="h-3.5 w-3.5" />
                      Slug (URL)
                    </Label>
                    <Input
                      id="slug"
                      value={metadata.slug}
                      onChange={(e) => setMetadata({ ...metadata, slug: e.target.value })}
                      placeholder="artikel-url-slug"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="excerpt" className="flex items-center gap-1.5 text-sm">
                    <AlignLeft className="h-3.5 w-3.5" />
                    Excerpt (SEO-Beschreibung)
                  </Label>
                  <Textarea
                    id="excerpt"
                    value={metadata.excerpt}
                    onChange={(e) => setMetadata({ ...metadata, excerpt: e.target.value })}
                    placeholder="Kurze Zusammenfassung für Vorschau und SEO..."
                    className="h-20 resize-none"
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground">{metadata.excerpt.length}/200 Zeichen</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-sm">
                    <Tag className="h-3.5 w-3.5" />
                    Kategorie
                  </Label>
                  <Select value={metadata.category} onValueChange={(value) => setMetadata({ ...metadata, category: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Article Content Card */}
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Generierter Artikel
                </CardTitle>
                {articleContent && !generating && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={copyToClipboard}>
                      {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                      {copied ? 'Kopiert!' : 'Kopieren'}
                    </Button>
                    <Button size="sm" onClick={saveAsDraft} disabled={saving || !metadata.title}>
                      {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Als Entwurf speichern
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription>
                {generating
                  ? 'Der Ghostwriter schreibt deinen Artikel...'
                  : articleContent
                    ? `${parsedContent.body.split(/\s+/).length} Wörter generiert`
                    : 'Wähle einen Digest und klicke auf "Artikel generieren"'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!articleContent && !generating ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Wand2 className="h-16 w-16 text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">
                    Hier erscheint dein generierter Artikel
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Der Ghostwriter nutzt das Vokabular und den aktiven Prompt
                  </p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none rounded-lg border bg-muted/30 p-6 min-h-[400px] max-h-[600px] overflow-y-auto article-preview">
                  {generating && !articleContent && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Ghostwriter schreibt...
                    </div>
                  )}
                  <ReactMarkdown
                    components={{
                      // Custom renderer for source-links blocks
                      p: ({ children, ...props }) => {
                        const content = String(children)
                        // Check if this is a source-links block
                        if (content.includes('<source-links>') || content.includes('</source-links>')) {
                          return null // Skip the tag lines
                        }
                        return <p {...props}>{children}</p>
                      },
                      em: ({ children, ...props }) => {
                        // Check if this is a source link (italic link)
                        const childArray = Array.isArray(children) ? children : [children]
                        const hasLink = childArray.some(child =>
                          typeof child === 'object' && child !== null && 'type' in child && child.type === 'a'
                        )
                        if (hasLink) {
                          return <em className="source-link" {...props}>{children}</em>
                        }
                        return <em {...props}>{children}</em>
                      },
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="source-link-anchor">
                          {children}
                        </a>
                      )
                    }}
                  >
                    {parsedContent.body || articleContent}
                  </ReactMarkdown>
                  {generating && articleContent && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
