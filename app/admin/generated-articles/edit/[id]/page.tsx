'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, ImageIcon, Newspaper, X, ChevronDown, Settings2, Sparkles, CheckCircle2, AlertCircle, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { TiptapEditorWithPatterns } from '@/components/tiptap-editor-with-patterns'
import { PostImageGallery } from '@/components/post-image-gallery'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { use } from 'react'
import { ensureInitialEditHistory, recordEditVersion } from '@/lib/edit-learning/history'
import { verifyContentUrls, formatIssuesForDisplay } from '@/lib/utils/url-verifier'
import type { LearnedPattern } from '@/lib/edit-learning/retrieval'

interface QueueItem {
  id: string
  title: string
  source_display_name: string | null
  source_identifier: string
}

interface AppliedPatternData {
  id: string
  patternId: string
  from: number
  to: number
  pattern: LearnedPattern
  userAccepted: boolean | null
}

interface ArticleThumbnail {
  id: string
  article_index: number
  article_queue_item_id: string | null  // Stable link to queue item
  image_url: string
  generation_status: string
}

const CATEGORIES = ['AI & Tech', 'Marketing', 'Design', 'Business', 'Code', 'Synthese']

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

interface GeneratedPost {
  id: string
  title: string
  slug: string | null
  excerpt: string | null
  category: string | null
  content: Record<string, unknown>
  status: 'draft' | 'published' | 'archived'
  pending_queue_item_ids: string[] | null
  ai_model: string | null
  digest_id: string | null
}

export default function EditGeneratedArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [post, setPost] = useState<GeneratedPost | null>(null)

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [category, setCategory] = useState('AI & Tech')
  const [published, setPublished] = useState(false)
  const [content, setContent] = useState<Record<string, unknown>>({})

  // Queue items management
  const [queueItems, setQueueItems] = useState<QueueItem[]>([])
  const [queueItemIds, setQueueItemIds] = useState<string[]>([])
  const [removingItemId, setRemovingItemId] = useState<string | null>(null)

  // Pattern highlighting
  const [appliedPatterns, setAppliedPatterns] = useState<AppliedPatternData[]>([])

  // Article thumbnails
  const [articleThumbnails, setArticleThumbnails] = useState<ArticleThumbnail[]>([])
  const [articleCount, setArticleCount] = useState(0)
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false)

  // Cover images
  const [coverImageCount, setCoverImageCount] = useState(0)

  // Translation status
  const [translationStatus, setTranslationStatus] = useState<'idle' | 'queuing' | 'processing' | 'success' | 'error'>('idle')
  const [translationMessage, setTranslationMessage] = useState<string>('')

  // Metadata section collapsed state
  const [metadataOpen, setMetadataOpen] = useState(false)

  // Extract article count from TipTap content
  const countArticles = useCallback((tiptapContent: Record<string, unknown>): number => {
    let count = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traverse = (node: any) => {
      if (!node) return
      if (node.type === 'heading' && node.attrs?.level === 2) {
        const headingText = node.content?.map((c: { text?: string }) => c.text || '').join('') || ''
        const lowerText = headingText.toLowerCase()
        if (!lowerText.includes('synthszr take') && !lowerText.includes('mattes synthese')) {
          count++
        }
      }
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) traverse(child)
      }
    }
    traverse(tiptapContent)
    return count
  }, [])

  // Fetch existing article thumbnails
  const fetchArticleThumbnails = useCallback(async () => {
    try {
      const res = await fetch(`/api/generate-article-thumbnails?postId=${id}`)
      if (res.ok) {
        const data = await res.json()
        setArticleThumbnails(data.thumbnails || [])
      }
    } catch (err) {
      console.error('[Thumbnails] Failed to fetch:', err)
    }
  }, [id])

  // Generate article thumbnails
  // Uses queueItemIds to create stable links between thumbnails and articles
  const generateArticleThumbnails = useCallback(async (tiptapContent: Record<string, unknown>) => {
    setGeneratingThumbnails(true)

    // Extract articles from TipTap content
    // IMPORTANT: Read queueItemId from EACH H2's attrs, NOT from array position!
    // This ensures thumbnails stay matched even after article reordering.
    const articles: Array<{ index: number; text: string; vote: null; queueItemId?: string }> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractArticles = (node: any, currentIndex = { value: 0 }) => {
      if (!node) return
      if (node.type === 'heading' && node.attrs?.level === 2) {
        const headingText = node.content?.map((c: { text?: string }) => c.text || '').join('') || ''
        const lowerText = headingText.toLowerCase()
        if (!lowerText.includes('synthszr take') && !lowerText.includes('mattes synthese')) {
          // Get queueItemId from H2 node attrs (stable) - this travels with the article when reordered
          // Fallback to array position only for legacy posts without embedded IDs
          const nodeQueueItemId = node.attrs?.queueItemId as string | undefined
          const fallbackQueueItemId = queueItemIds[currentIndex.value]

          articles.push({
            index: currentIndex.value,
            text: headingText.slice(0, 300),
            vote: null,
            // Prefer embedded queueItemId (survives reordering), fallback to array position (legacy)
            queueItemId: nodeQueueItemId || fallbackQueueItemId || undefined,
          })
          currentIndex.value++
        }
      }
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) extractArticles(child, currentIndex)
      }
    }
    extractArticles(tiptapContent)

    if (articles.length === 0) {
      console.log('[Thumbnails] No articles found')
      setGeneratingThumbnails(false)
      return
    }

    const linkedCount = articles.filter(a => a.queueItemId).length
    console.log(`[Thumbnails] Generating ${articles.length} thumbnails for post ${id} (${linkedCount} linked to queue items)`)

    try {
      const res = await fetch('/api/generate-article-thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId: id, articles }),
      })
      const data = await res.json()
      console.log(`[Thumbnails] Generated: ${data.generated}, Failed: ${data.failed}`)

      // Refresh thumbnail list
      await fetchArticleThumbnails()
    } catch (err) {
      console.error('[Thumbnails] Generation failed:', err)
    } finally {
      setGeneratingThumbnails(false)
    }
  }, [id, fetchArticleThumbnails, queueItemIds])

  // Fetch cover images count
  const fetchCoverImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/post-images?postId=${id}`)
      if (res.ok) {
        const data = await res.json()
        const completedCovers = (data.images || []).filter(
          (img: { generation_status: string }) => img.generation_status === 'completed'
        ).length
        setCoverImageCount(completedCovers)
      }
    } catch (err) {
      console.error('[CoverImages] Failed to fetch:', err)
    }
  }, [id])

  // Trigger cover image generation (if digest available)
  const triggerCoverImageGeneration = useCallback(async (digestId: string) => {
    console.log('[CoverImages] Fetching digest content for image generation...')
    try {
      // Fetch digest content
      const { data: digest } = await supabase
        .from('daily_digests')
        .select('analysis_content')
        .eq('id', digestId)
        .single()

      if (!digest?.analysis_content) {
        console.log('[CoverImages] No digest content found, skipping')
        return
      }

      // Extract news items from digest (simple approach - take first few lines)
      const lines = digest.analysis_content.split('\n').filter((l: string) => l.trim())
      const newsItems = lines.slice(0, 3).map((line: string) => line.slice(0, 500))

      if (newsItems.length === 0) {
        console.log('[CoverImages] No news items extracted from digest')
        return
      }

      console.log(`[CoverImages] Generating ${newsItems.length} cover images...`)

      // Generate images (fire and forget)
      for (const text of newsItems) {
        fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ postId: id, newsText: text }),
        })
          .then(res => {
            if (!res.ok) {
              res.json().then(data => console.error('[CoverImages] Generation failed:', data))
            }
          })
          .catch(err => console.error('[CoverImages] Generation error:', err))
      }
    } catch (err) {
      console.error('[CoverImages] Error triggering generation:', err)
    }
  }, [id, supabase])

  // Fetch applied patterns for highlighting
  const fetchAppliedPatterns = useCallback(async () => {
    const res = await fetch(`/api/admin/pattern-feedback?postId=${id}`)
    if (res.ok) {
      const data = await res.json()
      const patterns: AppliedPatternData[] = (data.appliedPatterns || []).map(
        (ap: {
          id: string
          pattern_id: string
          char_start: number
          char_end: number
          user_accepted: boolean | null
          pattern: LearnedPattern | null
        }) => ({
          id: ap.id,
          patternId: ap.pattern_id,
          from: ap.char_start || 0,
          to: ap.char_end || 0,
          pattern: ap.pattern,
          userAccepted: ap.user_accepted,
        })
      ).filter((ap: AppliedPatternData) => ap.pattern !== null)
      setAppliedPatterns(patterns)
    }
  }, [id])

  // Handle pattern feedback
  const handlePatternFeedback = useCallback(
    async (appliedPatternId: string, action: 'accept' | 'reject' | 'deactivate') => {
      const res = await fetch('/api/admin/pattern-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedPatternId, action }),
      })

      if (res.ok) {
        // Update local state
        setAppliedPatterns((prev) =>
          prev.map((ap) =>
            ap.id === appliedPatternId
              ? { ...ap, userAccepted: action === 'accept' }
              : ap
          )
        )
      }
    },
    []
  )

  // Fetch queue item details
  const fetchQueueItems = useCallback(async (itemIds: string[]) => {
    if (itemIds.length === 0) {
      setQueueItems([])
      return
    }

    const { data } = await supabase
      .from('news_queue')
      .select('id, title, source_display_name, source_identifier')
      .in('id', itemIds)

    if (data) {
      setQueueItems(data)
    }
  }, [supabase])

  // Remove a queue item (reset to pending) and its associated thumbnail
  const removeQueueItem = async (itemId: string) => {
    setRemovingItemId(itemId)

    try {
      // Reset the item to pending in the queue
      const response = await fetch('/api/admin/news-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'reset-item',
          itemId,
        }),
      })

      if (response.ok) {
        // Delete the associated thumbnail (by queue item ID for stable reference)
        fetch(`/api/generate-article-thumbnails?postId=${id}&queueItemId=${itemId}`, {
          method: 'DELETE',
          credentials: 'include',
        })
          .then(res => {
            if (res.ok) {
              console.log(`[Thumbnails] Deleted thumbnail linked to queue item ${itemId}`)
              // Refresh thumbnail list
              fetchArticleThumbnails()
            }
          })
          .catch(err => console.error('[Thumbnails] Failed to delete:', err))

        // Update local state
        const newIds = queueItemIds.filter(qid => qid !== itemId)
        setQueueItemIds(newIds)
        setQueueItems(prev => prev.filter(item => item.id !== itemId))
        // Also remove from local thumbnail state (optimistic update)
        setArticleThumbnails(prev => prev.filter(t => t.article_queue_item_id !== itemId))

        // Update the post's pending_queue_item_ids in database
        await supabase
          .from('generated_posts')
          .update({ pending_queue_item_ids: newIds })
          .eq('id', id)

        console.log(`[Queue] Item ${itemId} removed and reset to pending`)
      } else {
        console.error('[Queue] Failed to reset item')
      }
    } catch (err) {
      console.error('[Queue] Error removing item:', err)
    } finally {
      setRemovingItemId(null)
    }
  }

  useEffect(() => {
    async function loadPost() {
      const { data } = await supabase
        .from('generated_posts')
        .select('*')
        .eq('id', id)
        .single()

      if (data) {
        const parsedContent = typeof data.content === 'string'
          ? JSON.parse(data.content)
          : data.content

        setPost(data)
        setTitle(data.title || '')
        setSlug(data.slug || '')
        setExcerpt(data.excerpt || '')
        setCategory(data.category || 'AI & Tech')
        setPublished(data.status === 'published')
        setContent(parsedContent)

        // Load queue items
        const itemIds = data.pending_queue_item_ids || []
        setQueueItemIds(itemIds)
        if (itemIds.length > 0) {
          fetchQueueItems(itemIds)
        }

        // Load applied patterns for highlighting
        fetchAppliedPatterns()

        // Load article thumbnails and count
        fetchArticleThumbnails()
        setArticleCount(countArticles(parsedContent))

        // Load cover images count
        fetchCoverImages()

        // Initialize edit history if this is the first edit
        // This preserves the original AI-generated content for learning
        ensureInitialEditHistory(id, parsedContent, data.ai_model, supabase)
          .then(({ version, isNew }) => {
            if (isNew) {
              console.log('[EditLearning] Initialized edit history, version:', version)
            }
          })
          .catch(err => console.error('[EditLearning] Failed to init history:', err))
      }

      setLoading(false)
    }

    loadPost()
  }, [id, supabase, fetchQueueItems, fetchAppliedPatterns, fetchArticleThumbnails, fetchCoverImages, countArticles])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (!post?.slug) {
      setSlug(generateSlug(value))
    }
  }

  const handleContentChange = (newContent: Record<string, unknown>) => {
    setContent(newContent)
    setArticleCount(countArticles(newContent))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Verify URLs before saving
    const verification = verifyContentUrls(content)
    if (!verification.isClean) {
      const message = formatIssuesForDisplay(verification.issues)
      alert(`⚠️ Speichern abgebrochen!\n\n${message}\n\nBitte bereinige die URLs vor dem Speichern.`)
      return
    }

    setSaving(true)

    const wasPublished = post?.status === 'published'
    const isNowPublished = published
    // Use current queueItemIds (may have been modified by user removing items)
    const currentQueueItems = queueItemIds

    // Record edit version for learning (before saving)
    // This captures the before/after diff for pattern extraction
    try {
      const result = await recordEditVersion(id, content, supabase)
      if (result?.hasChanges) {
        console.log('[EditLearning] Recorded edit version:', result.version)
      }
    } catch (err) {
      console.error('[EditLearning] Failed to record edit:', err)
    }

    // Update the post
    const updateData: Record<string, unknown> = {
      title,
      slug,
      excerpt: excerpt || null,
      category,
      content: JSON.stringify(content),
      status: published ? 'published' : 'draft',
      updated_at: new Date().toISOString(),
      // Always update with current queue item IDs
      pending_queue_item_ids: isNowPublished ? [] : currentQueueItems,
    }

    const { error } = await supabase
      .from('generated_posts')
      .update(updateData)
      .eq('id', id)

    if (error) {
      alert(`Fehler beim Speichern: ${error.message}`)
      setSaving(false)
      return
    }

    // Mark only the REMAINING queue items as "used" when publishing for the first time
    if (!wasPublished && isNowPublished && currentQueueItems.length > 0) {
      console.log(`[Queue] Publishing post ${id} - marking ${currentQueueItems.length} items as used`)
      console.log('[Queue] Item IDs to mark:', currentQueueItems)
      try {
        const response = await fetch('/api/admin/news-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action: 'use',
            itemIds: currentQueueItems,
            postId: id
          }),
        })
        const data = await response.json()
        if (response.ok) {
          console.log(`[Queue] Items marked as used successfully. Updated: ${data.updated}/${currentQueueItems.length}`)
        } else {
          console.error('[Queue] Failed to mark items as used:', data.error)
        }
      } catch (err) {
        console.error('[Queue] Error marking items as used:', err)
      }
    } else if (!wasPublished && isNowPublished) {
      console.log('[Queue] No queue items to mark as used (currentQueueItems is empty)')
    }

    // Trigger translations when publishing for the first time
    if (!wasPublished && isNowPublished) {
      console.log(`[i18n] Triggering translations for post ${id}`)
      setTranslationStatus('queuing')
      setTranslationMessage('Übersetzungen werden eingereiht...')

      // Queue translations with retry logic
      const queueWithRetry = async (retries = 3): Promise<{ queued: number; error?: string }> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const res = await fetch('/api/admin/translations/queue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                content_type: 'generated_post',
                content_id: id,
                priority: 10,
              }),
            })

            if (!res.ok) {
              const errorData = await res.json().catch(() => ({ error: 'Unknown error' }))
              throw new Error(errorData.error || `HTTP ${res.status}`)
            }

            return await res.json()
          } catch (err) {
            console.error(`[i18n] Queue attempt ${attempt}/${retries} failed:`, err)
            if (attempt === retries) {
              return { queued: 0, error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
            }
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          }
        }
        return { queued: 0, error: 'Alle Versuche fehlgeschlagen' }
      }

      // Execute queue with retry
      queueWithRetry().then(async (queueResult) => {
        if (queueResult.error) {
          console.error('[i18n] Translation queue failed:', queueResult.error)
          setTranslationStatus('error')
          setTranslationMessage(`Übersetzungen fehlgeschlagen: ${queueResult.error}`)
          alert(`⚠️ Übersetzungen konnten nicht eingereiht werden: ${queueResult.error}\n\nBitte manuell in /admin/translations starten.`)
          return
        }

        if (queueResult.queued === 0) {
          console.log('[i18n] No translations to queue (all manually edited or no languages)')
          setTranslationStatus('success')
          setTranslationMessage('Keine Übersetzungen nötig')
          return
        }

        console.log(`[i18n] Queued ${queueResult.queued} translations`)
        setTranslationStatus('processing')
        setTranslationMessage(`${queueResult.queued} Übersetzungen werden verarbeitet...`)

        // Start processing (fire-and-forget is OK here since queue is already saved)
        try {
          const processRes = await fetch('/api/admin/translations/process-queue', {
            method: 'POST',
            credentials: 'include',
          })
          const processResult = await processRes.json()
          console.log(`[i18n] Processing result:`, processResult)
          setTranslationStatus('success')
          setTranslationMessage(`${processResult.success || 0} Übersetzungen gestartet`)
        } catch (err) {
          console.error('[i18n] Process queue error:', err)
          // Queue is saved, processing can be retried manually
          setTranslationStatus('success')
          setTranslationMessage(`${queueResult.queued} Übersetzungen eingereiht (Verarbeitung läuft)`)
        }
      })
    }

    // Re-index thumbnails on EVERY save to match current article order
    // Then generate any missing thumbnails
    console.log(`[Thumbnails] Re-indexing thumbnails for post ${id}`)
    fetch('/api/admin/reindex-thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ postId: id, content }),
    })
      .then(res => res.json())
      .then(async data => {
        const actions = []
        if (data.updated > 0) actions.push(`${data.updated} updated`)
        if (data.deleted > 0) actions.push(`${data.deleted} deleted`)
        if (actions.length > 0) {
          console.log(`[Thumbnails] Re-indexed: ${actions.join(', ')}`)
        }

        // Generate missing thumbnails if any
        if (data.missingArticles && data.missingArticles.length > 0) {
          console.log(`[Thumbnails] Generating ${data.missingArticles.length} missing thumbnails...`)
          try {
            const genRes = await fetch('/api/generate-article-thumbnails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                postId: id,
                articles: data.missingArticles.map((a: { index: number; text: string; queueItemId?: string }) => ({
                  index: a.index,
                  text: a.text,
                  vote: null,
                  queueItemId: a.queueItemId
                }))
              })
            })
            if (genRes.ok) {
              const genData = await genRes.json()
              const successCount = genData.results?.filter((r: { success: boolean }) => r.success).length || 0
              console.log(`[Thumbnails] Generated ${successCount} new thumbnails`)
            } else {
              console.error('[Thumbnails] Generation failed:', await genRes.text())
            }
          } catch (genErr) {
            console.error('[Thumbnails] Generation error:', genErr)
          }
        }
      })
      .catch(err => console.error('[Thumbnails] Re-index error:', err))

    // Generate cover images if missing and digest available
    if (coverImageCount === 0 && post?.digest_id) {
      console.log(`[CoverImages] No cover images found - triggering generation`)
      triggerCoverImageGeneration(post.digest_id)
    }

    setSaving(false)
    router.push('/admin/generated-articles')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!post) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Artikel nicht gefunden</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-6xl px-4 py-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header - compact */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push('/admin/generated-articles')}
                className="gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                Zurück
              </Button>
              {/* Inline title editing */}
              <Input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Artikeltitel..."
                className="text-lg font-medium border-0 bg-transparent px-0 focus-visible:ring-0 w-[400px]"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="published"
                  checked={published}
                  onCheckedChange={setPublished}
                />
                <Label htmlFor="published" className="font-mono text-xs">
                  {published ? 'Veröffentlicht' : 'Entwurf'}
                </Label>
              </div>
              <Button type="submit" size="sm" disabled={saving || !title || !slug}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Speichern
              </Button>
              {/* Translation Status Indicator */}
              {translationStatus !== 'idle' && (
                <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
                  translationStatus === 'error' ? 'bg-red-100 text-red-700' :
                  translationStatus === 'success' ? 'bg-green-100 text-green-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {translationStatus === 'queuing' && <Loader2 className="h-3 w-3 animate-spin" />}
                  {translationStatus === 'processing' && <Languages className="h-3 w-3 animate-pulse" />}
                  {translationStatus === 'success' && <CheckCircle2 className="h-3 w-3" />}
                  {translationStatus === 'error' && <AlertCircle className="h-3 w-3" />}
                  <span>{translationMessage}</span>
                </div>
              )}
            </div>
          </div>

          {/* Collapsible Metadata Section */}
          <Collapsible open={metadataOpen} onOpenChange={setMetadataOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
                <Settings2 className="h-4 w-4" />
                <span>Metadaten</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${metadataOpen ? 'rotate-180' : ''}`} />
                {!metadataOpen && (
                  <span className="text-xs ml-2">
                    {category} · /{slug}
                  </span>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-4 md:grid-cols-3 pt-3 pb-2">
                <div className="space-y-1.5">
                  <Label htmlFor="slug" className="font-mono text-xs">Slug (URL)</Label>
                  <Input
                    id="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="artikel-slug"
                    className="font-mono text-sm h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono text-xs">Kategorie</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="excerpt" className="font-mono text-xs">
                    Excerpt <span className="text-muted-foreground">({excerpt.length}/200)</span>
                  </Label>
                  <Textarea
                    id="excerpt"
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value)}
                    placeholder="Kurze Zusammenfassung..."
                    rows={2}
                    maxLength={200}
                    className="text-sm resize-none"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Main Content Area - Full Height */}
          <Tabs defaultValue="content" className="space-y-2">
            <TabsList className="h-9">
              <TabsTrigger value="content" className="text-sm">Inhalt</TabsTrigger>
              <TabsTrigger value="images" className="flex items-center gap-1.5 text-sm">
                <ImageIcon className="h-3.5 w-3.5" />
                Bilder
                {articleCount > 0 && (
                  <Badge
                    variant={articleThumbnails.filter(t => t.generation_status === 'completed').length === articleCount ? 'secondary' : 'outline'}
                    className="ml-1 text-[10px] px-1.5"
                  >
                    {articleThumbnails.filter(t => t.generation_status === 'completed').length}/{articleCount}
                  </Badge>
                )}
              </TabsTrigger>
              {queueItems.length > 0 && (
                <TabsTrigger value="sources" className="flex items-center gap-1.5 text-sm">
                  <Newspaper className="h-3.5 w-3.5" />
                  Quellen
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                    {queueItems.length}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="content" className="mt-2">
              <TiptapEditorWithPatterns
                content={content}
                onChange={handleContentChange}
                appliedPatterns={appliedPatterns}
                onPatternFeedback={handlePatternFeedback}
              />
            </TabsContent>

            <TabsContent value="images" className="mt-2">
              <div className="border rounded-lg p-4 space-y-4">
                {/* Article Thumbnails Section */}
                {articleCount > 0 && (
                  <div className="flex items-center justify-between pb-3 border-b">
                    <div>
                      <h3 className="font-medium text-sm">Artikel-Thumbnails</h3>
                      <p className="text-xs text-muted-foreground">
                        {articleThumbnails.filter(t => t.generation_status === 'completed').length} von {articleCount} generiert
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => generateArticleThumbnails(content)}
                      disabled={generatingThumbnails}
                      className="gap-1.5"
                    >
                      {generatingThumbnails ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Generiere...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          {articleThumbnails.length > 0 ? 'Neu generieren' : 'Generieren'}
                        </>
                      )}
                    </Button>
                  </div>
                )}

                <PostImageGallery postId={id} />
              </div>
            </TabsContent>

            <TabsContent value="sources" className="mt-2">
              <div className="border rounded-lg p-4 space-y-3">
                <div>
                  <h3 className="font-medium text-sm">Verknüpfte News-Quellen</h3>
                  <p className="text-xs text-muted-foreground">
                    Entfernte Items werden zurück in die Queue gestellt.
                  </p>
                </div>

                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {queueItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 p-2 bg-muted/50 rounded"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.source_display_name || item.source_identifier}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQueueItem(item.id)}
                        disabled={removingItemId === item.id || published}
                        className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        title={published ? 'Bereits veröffentlicht' : 'Entfernen'}
                      >
                        {removingItemId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>

                {published && (
                  <p className="text-xs text-muted-foreground italic">
                    Bereits veröffentlicht – Quellen können nicht entfernt werden.
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </form>
      </main>
    </div>
  )
}
