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
  AlignLeft,
  Bot,
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
import { embedQueueItemIds } from '@/lib/utils/embed-queue-ids'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { ensureInitialEditHistory } from '@/lib/edit-learning/history'
import { verifyContentUrls, formatIssuesForDisplay } from '@/lib/utils/url-verifier'

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

interface QueueStats {
  pending: number
  selected: number
  used: number
  oldestSelectedAt: string | null
}

interface SourceDistribution {
  source: string
  count: number
  percentage: number
}

type AIModel = 'claude-opus-4' | 'claude-sonnet-4' | 'gemini-2.5-pro' | 'gemini-3-pro-preview'

const AI_MODELS: { value: AIModel; label: string; description: string }[] = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Schnell, großer Kontext (1M+ Token)' },
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Neuestes Gemini, experimentell' },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Ausgewogen, gute Qualität' },
  { value: 'claude-opus-4', label: 'Claude Opus 4', description: 'Höchste Qualität, langsamer' },
]

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
  // Queue-based state (replaces digest selection)
  const [queueStats, setQueueStats] = useState<QueueStats>({ pending: 0, selected: 0, used: 0, oldestSelectedAt: null })
  const [sourceDistribution, setSourceDistribution] = useState<SourceDistribution[]>([])
  const [usedQueueItemIds, setUsedQueueItemIds] = useState<string[]>([])
  const [maxQueueItems, setMaxQueueItems] = useState(20)

  // Keep digests for reference (image generation uses digest content)
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
  const [vocabularyIntensity, setVocabularyIntensity] = useState(10)
  const [selectedModel, setSelectedModel] = useState<AIModel>('gemini-2.5-pro')
  const [usedModel, setUsedModel] = useState<AIModel | null>(null)

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

  // Track if we just finished generating (to trigger auto-save)
  const [justFinishedGenerating, setJustFinishedGenerating] = useState(false)

  // Parse metadata when generation finishes and trigger auto-save
  useEffect(() => {
    if (!generating && articleContent) {
      const parsed = parseArticleContent(articleContent)
      if (parsed.metadata.title) {
        setMetadata(parsed.metadata)
        setJustFinishedGenerating(true)
      }
    }
  }, [generating, articleContent])

  // Auto-save when generation completes
  useEffect(() => {
    if (justFinishedGenerating && metadata.title && !saving) {
      setJustFinishedGenerating(false)
      // Small delay to ensure metadata state is updated
      const timer = setTimeout(() => {
        saveAsDraft()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [justFinishedGenerating, metadata.title, saving])

  async function loadData() {
    setLoading(true)
    try {
      // Load queue stats
      const statsRes = await fetch('/api/admin/news-queue?action=stats')
      if (statsRes.ok) {
        const stats = await statsRes.json()
        setQueueStats({
          pending: stats.pending || 0,
          selected: stats.selected || 0,
          used: stats.used || 0,
          oldestSelectedAt: stats.oldestSelectedAt || null
        })
      }

      // Load source distribution
      const distRes = await fetch('/api/admin/news-queue?action=distribution')
      if (distRes.ok) {
        const dist = await distRes.json()
        setSourceDistribution(
          (dist || []).map((d: { source_identifier: string; source_display_name: string | null; item_count: number; percentage_of_total: number }) => ({
            source: d.source_display_name || d.source_identifier,
            count: d.item_count,
            percentage: d.percentage_of_total
          }))
        )
      }

      // Load digests (still needed for image generation reference)
      const { data: digestsData } = await supabase
        .from('daily_digests')
        .select('id, digest_date, analysis_content, word_count')
        .order('digest_date', { ascending: false })
        .limit(5)

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
    // Check for selected items first (priority), then pending items (fallback)
    if (queueStats.selected === 0 && queueStats.pending === 0) {
      alert('Keine Items in der Queue. Bitte zuerst Items auswählen (News Queue → Selected) oder die Synthese-Pipeline ausführen.')
      return
    }

    setGenerating(true)
    setArticleContent('')
    setUsedModel(null)
    setUsedQueueItemIds([])

    try {
      // Use Queue-based Ghostwriter API
      // Priority: 1. Selected items, 2. Pending items (balanced selection)
      const response = await fetch('/api/ghostwriter-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          useSelected: true,  // Use manually selected items first
          maxItems: maxQueueItems,  // Fallback to balanced selection if no selected items
          vocabularyIntensity,
          model: selectedModel
        }),
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
              if (data.clear) {
                // Clear content for new version (deduplication phase)
                setArticleContent('')
              }
              if (data.phase === 'deduplication') {
                console.log('[Ghostwriter-Queue] Deduplication:', data.message)
              }
              if (data.started) {
                console.log(`[Ghostwriter-Queue] Started with ${data.itemCount} items from queue`)
                if (data.sourceDistribution) {
                  console.log('[Ghostwriter-Queue] Source distribution:', data.sourceDistribution)
                }
              }
              if (data.text) {
                setArticleContent(prev => prev + data.text)
              }
              if (data.model) {
                setUsedModel(data.model)
              }
              if (data.done) {
                // Store the queue item IDs for marking as used after save
                if (data.queueItemIds) {
                  setUsedQueueItemIds(data.queueItemIds)
                  console.log(`[Ghostwriter-Queue] Will mark ${data.queueItemIds.length} items as used after save`)
                }
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
    }
  }, [queueStats.selected, queueStats.pending, maxQueueItems, vocabularyIntensity, selectedModel])

  function copyToClipboard() {
    navigator.clipboard.writeText(articleContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Extract individual news items from digest content for image generation
  function extractNewsItems(digestContent: string): string[] {
    const items: string[] = []

    // Split by markdown headers (## or ###) to get individual sections
    const sections = digestContent.split(/(?=^#{2,3}\s)/m)

    for (const section of sections) {
      const trimmed = section.trim()
      if (trimmed.length > 100 && trimmed.length < 3000) {
        // Skip sections that are just headers or too short
        items.push(trimmed)
      }
    }

    // If no sections found, try splitting by double newlines
    if (items.length === 0) {
      const paragraphs = digestContent.split(/\n\n+/)
      for (const para of paragraphs) {
        const trimmed = para.trim()
        if (trimmed.length > 100 && trimmed.length < 2000) {
          items.push(trimmed)
        }
      }
    }

    // Limit to max 3 items for image generation
    return items.slice(0, 3)
  }

  // Trigger background image generation for a post
  async function triggerImageGeneration(postId: string, digestContent: string) {
    const newsItems = extractNewsItems(digestContent)

    if (newsItems.length === 0) {
      console.log('No news items found for image generation')
      return
    }

    console.log(`Triggering image generation for ${newsItems.length} news items`)

    // Generate images in background (fire and forget)
    for (const text of newsItems) {
      fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include auth cookies
        body: JSON.stringify({
          postId,
          newsText: text,
        }),
      })
        .then(res => {
          if (!res.ok) {
            res.json().then(data => console.error('Image generation failed:', data))
          } else {
            console.log('Image generation started successfully')
          }
        })
        .catch(err => console.error('Image generation error:', err))
    }
  }

  // Extract {Company} tags from TipTap JSON content
  function extractCompanyTags(content: string): { public: string[]; premarket: string[] } {
    const publicCompanies: string[] = []
    const premarketCompanies: string[] = []

    // Match {Company} patterns in the content
    const tagRegex = /\{([^}]+)\}/g
    let match

    while ((match = tagRegex.exec(content)) !== null) {
      const companyName = match[1].trim()

      // Check if it's a known public company (case-insensitive)
      let foundPublic = false
      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        if (displayName.toLowerCase() === companyName.toLowerCase()) {
          if (!publicCompanies.includes(apiName)) {
            publicCompanies.push(apiName)
          }
          foundPublic = true
          break
        }
      }

      // Check if it's a known premarket company (case-insensitive)
      if (!foundPublic) {
        for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
          if (displayName.toLowerCase() === companyName.toLowerCase()) {
            if (!premarketCompanies.includes(apiName)) {
              premarketCompanies.push(apiName)
            }
            break
          }
        }
      }
    }

    return { public: publicCompanies, premarket: premarketCompanies }
  }

  // Trigger Synthszr rating generation for companies mentioned in the article
  async function triggerSynthszrRatings(tiptapContent: object) {
    const contentString = JSON.stringify(tiptapContent)
    const companies = extractCompanyTags(contentString)

    const totalCompanies = companies.public.length + companies.premarket.length
    if (totalCompanies === 0) {
      console.log('[Synthszr] No company tags found in article')
      return
    }

    console.log(`[Synthszr] Found ${companies.public.length} public and ${companies.premarket.length} premarket companies`)

    // Trigger rating generation for public companies (fire and forget)
    for (const company of companies.public) {
      console.log(`[Synthszr] Triggering analysis for public company: ${company}`)
      fetch('/api/stock-synthszr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ company }),
      })
        .then(res => {
          if (res.ok) {
            console.log(`[Synthszr] Analysis started for ${company}`)
          } else {
            res.json().then(data => console.error(`[Synthszr] Failed for ${company}:`, data))
          }
        })
        .catch(err => console.error(`[Synthszr] Error for ${company}:`, err))
    }

    // For premarket companies, fetch from glitch.green API to ensure data is available
    // The premarket syntheses are generated externally, so we just trigger a cache refresh
    for (const company of companies.premarket) {
      console.log(`[Synthszr] Checking premarket company: ${company}`)
      fetch(`/api/premarket?search=${encodeURIComponent(company)}&limit=1`, {
        method: 'GET',
        credentials: 'include',
      })
        .then(res => {
          if (res.ok) {
            console.log(`[Synthszr] Premarket data fetched for ${company}`)
          }
        })
        .catch(err => console.error(`[Synthszr] Premarket error for ${company}:`, err))
    }
  }

  async function saveAsDraft() {
    if (!articleContent) return

    setSaving(true)
    try {
      // Use the body content (without frontmatter) for the actual article
      const bodyContent = parsedContent.body || articleContent

      // Use metadata from state (which can be edited) or fallback
      const title = metadata.title || `Artikel vom ${new Date().toLocaleDateString('de-DE')}`
      const slug = metadata.slug || generateSlug(title)

      // Convert markdown to TipTap JSON and stringify for TEXT column
      let tiptapContent = markdownToTiptap(bodyContent)

      // Embed queue item IDs into H2 headings for stable thumbnail matching
      // This allows thumbnails to follow H2s when users reorder articles in the editor
      if (usedQueueItemIds.length > 0) {
        // Fetch queue item titles for matching
        const { data: queueItemsData } = await supabase
          .from('news_queue')
          .select('id, title, content')
          .in('id', usedQueueItemIds)

        if (queueItemsData && queueItemsData.length > 0) {
          tiptapContent = embedQueueItemIds(tiptapContent, queueItemsData)
        }
      }

      // Verify URLs before saving
      const verification = verifyContentUrls(tiptapContent)
      if (!verification.isClean) {
        const message = formatIssuesForDisplay(verification.issues)
        alert(`⚠️ Speichern abgebrochen!\n\n${message}\n\nBitte bereinige die URLs vor dem Speichern.`)
        setSaving(false)
        return
      }

      const { data: newPost, error } = await supabase.from('generated_posts').insert({
        digest_id: selectedDigestId || null,
        prompt_id: activePrompt?.id,
        title,
        slug,
        excerpt: metadata.excerpt || null,
        category: metadata.category || 'AI & Tech',
        content: JSON.stringify(tiptapContent),
        word_count: bodyContent.split(/\s+/).length,
        status: 'draft',
        created_at: new Date().toISOString(), // Full timestamp including time
        ai_model: usedModel || selectedModel, // Store the model used for generation
        // Store queue item IDs - will be marked as "used" when post is published
        pending_queue_item_ids: usedQueueItemIds.length > 0 ? usedQueueItemIds : [],
      }).select('id').single()

      if (error) throw error

      // Note: Queue items stay as "selected" until post is published
      // They will be marked as "used" in the edit page when status changes to "published"
      if (usedQueueItemIds.length > 0) {
        console.log(`[Queue] Stored ${usedQueueItemIds.length} pending queue items with draft post ${newPost?.id}`)
        console.log('[Queue] Items will be marked as "used" when post is published')
      }

      // Trigger background image generation using digest content if available
      if (newPost?.id && selectedDigest?.analysis_content) {
        triggerImageGeneration(newPost.id, selectedDigest.analysis_content)
      }

      // Trigger Synthszr ratings for companies with {Company} tags
      triggerSynthszrRatings(tiptapContent)

      // NOTE: Translations are NOT triggered for drafts
      // They will be triggered when the post is published from the edit page
      // This prevents queue items from sitting in 'pending' status unnecessarily

      // NOTE: Thumbnails are NOT auto-generated on save
      // User must manually go to edit page → "Bilder" tab → click "Generieren"
      // This ensures robust thumbnail-to-article matching after any edits

      // Initialize edit history with original AI content (for learning from edits)
      if (newPost?.id) {
        ensureInitialEditHistory(newPost.id, tiptapContent, usedModel || selectedModel, supabase)
          .then(() => console.log('[EditLearning] Initialized edit history for new post'))
          .catch(err => console.error('[EditLearning] Failed to init history:', err))

        // Detect and store applied patterns for inline highlighting
        fetch('/api/admin/store-applied-patterns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: newPost.id, content: tiptapContent }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.matchesStored > 0) {
              console.log(`[EditLearning] Stored ${data.matchesStored} applied patterns for highlighting`)
            }
          })
          .catch(err => console.error('[EditLearning] Failed to store applied patterns:', err))
      }

      alert('Artikel als Entwurf gespeichert! Queue-Items markiert, Bilder und Übersetzungen werden im Hintergrund generiert.')

      // Reset form after successful save
      setArticleContent('')
      setMetadata({ title: '', excerpt: '', category: 'AI & Tech', slug: '' })
      setUsedQueueItemIds([])
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
          Generiere einen Blogartikel aus der News-Queue (max 30% pro Quelle)
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Settings */}
        <div className="space-y-6">
          {/* Queue Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                News-Queue
              </CardTitle>
              <CardDescription className="text-xs">
                Wird automatisch durch Synthese-Pipeline befüllt
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-2 bg-muted/50 rounded text-center">
                  <div className="text-lg font-bold text-yellow-600">{queueStats.pending}</div>
                  <div className="text-[10px] text-muted-foreground">Pending</div>
                </div>
                <div className="p-2 bg-muted/50 rounded text-center">
                  <div className="text-lg font-bold text-blue-600">{queueStats.selected}</div>
                  <div className="text-[10px] text-muted-foreground">Selected</div>
                </div>
                <div className="p-2 bg-muted/50 rounded text-center">
                  <div className="text-lg font-bold text-green-600">{queueStats.used}</div>
                  <div className="text-[10px] text-muted-foreground">Used</div>
                </div>
              </div>

              {/* Max Items Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Max. News-Items</Label>
                  <span className="text-xs font-mono text-muted-foreground">{maxQueueItems}</span>
                </div>
                <Slider
                  value={[maxQueueItems]}
                  onValueChange={([v]) => setMaxQueueItems(v)}
                  min={5}
                  max={30}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Source Distribution */}
              {sourceDistribution.length > 0 && (
                <div className="mt-4 pt-3 border-t">
                  <div className="text-xs font-medium mb-2">Quellen-Verteilung</div>
                  <div className="space-y-1.5">
                    {sourceDistribution.slice(0, 4).map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px]">
                        <span className="truncate max-w-[140px]">{d.source}</span>
                        <span className={`font-mono ${d.percentage > 30 ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                          {d.percentage}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {queueStats.selected > 0 && (
                <div className="mt-4 p-2 bg-blue-500/10 rounded text-xs text-blue-700">
                  ✓ {queueStats.selected} manuell ausgewählte Items werden verwendet.
                  {queueStats.oldestSelectedAt && (() => {
                    const oldestTime = new Date(queueStats.oldestSelectedAt).getTime()
                    const expiresAt = oldestTime + 2 * 60 * 60 * 1000 // 2 hours
                    const remaining = expiresAt - Date.now()
                    const minutesLeft = Math.floor(remaining / 60000)
                    if (minutesLeft <= 0) {
                      return <span className="block mt-1 text-red-600">⚠️ Auswahl ist abgelaufen! Bitte neu selektieren.</span>
                    } else if (minutesLeft <= 30) {
                      return <span className="block mt-1 text-orange-600">⏰ Noch {minutesLeft} Min gültig - bald generieren!</span>
                    } else {
                      return <span className="block mt-1 text-muted-foreground">⏱️ Noch {Math.floor(minutesLeft / 60)}h {minutesLeft % 60}m gültig</span>
                    }
                  })()}
                </div>
              )}
              {queueStats.selected === 0 && queueStats.pending === 0 && (
                <div className="mt-4 p-2 bg-yellow-500/10 rounded text-xs text-yellow-700">
                  Queue ist leer. Bitte Items in der News Queue auswählen oder Synthese-Pipeline ausführen.
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

          {/* AI Model Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4" />
                AI-Modell
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={selectedModel} onValueChange={(value: AIModel) => setSelectedModel(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Modell wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map(model => (
                    <SelectItem key={model.value} value={model.value}>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.label}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {usedModel && usedModel !== selectedModel && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Letzter Artikel generiert mit: <Badge variant="outline" className="text-xs">{AI_MODELS.find(m => m.value === usedModel)?.label}</Badge>
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
                    className="h-24 resize-none"
                    maxLength={800}
                  />
                  <p className="text-xs text-muted-foreground">{metadata.excerpt.length}/800 Zeichen</p>
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
