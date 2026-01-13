'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, ImageIcon, Newspaper, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { TiptapEditor } from '@/components/tiptap-editor'
import { PostImageGallery } from '@/components/post-image-gallery'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { use } from 'react'

interface QueueItem {
  id: string
  title: string
  source_display_name: string | null
  source_identifier: string
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

  // Remove a queue item (reset to pending)
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
        // Update local state
        const newIds = queueItemIds.filter(id => id !== itemId)
        setQueueItemIds(newIds)
        setQueueItems(prev => prev.filter(item => item.id !== itemId))

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
      }

      setLoading(false)
    }

    loadPost()
  }, [id, supabase, fetchQueueItems])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (!post?.slug) {
      setSlug(generateSlug(value))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const wasPublished = post?.status === 'published'
    const isNowPublished = published
    // Use current queueItemIds (may have been modified by user removing items)
    const currentQueueItems = queueItemIds

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
      console.log(`[Queue] Publishing post - marking ${currentQueueItems.length} items as used`)
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
        if (response.ok) {
          console.log('[Queue] Items marked as used successfully')
        } else {
          console.error('[Queue] Failed to mark items as used')
        }
      } catch (err) {
        console.error('[Queue] Error marking items as used:', err)
      }
    }

    // Trigger translations when publishing for the first time
    if (!wasPublished && isNowPublished) {
      console.log(`[i18n] Triggering translations for post ${id}`)
      fetch('/api/admin/translations/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content_type: 'generated_post',
          content_id: id,
          priority: 10,
        }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.queued > 0) {
            console.log(`[i18n] Queued ${data.queued} translations`)
          }
        })
        .catch(err => console.error('[i18n] Translation queue error:', err))
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
      <main className="mx-auto max-w-4xl px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/admin/generated-articles')}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Zurück
            </Button>
            <div className="flex items-center gap-4">
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
              <Button type="submit" disabled={saving || !title || !slug}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title" className="font-mono text-xs">
                Titel
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Artikeltitel"
                className="text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug" className="font-mono text-xs">
                Slug (URL)
              </Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="artikel-slug"
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="excerpt" className="font-mono text-xs">
                Excerpt (SEO-Beschreibung)
              </Label>
              <Textarea
                id="excerpt"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Kurze Zusammenfassung..."
                rows={3}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">{excerpt.length}/200</p>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs">Kategorie</Label>
              <Select value={category} onValueChange={setCategory}>
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
          </div>

          <Tabs defaultValue="content" className="space-y-4">
            <TabsList>
              <TabsTrigger value="content">Inhalt</TabsTrigger>
              <TabsTrigger value="images" className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Bilder
              </TabsTrigger>
              {queueItems.length > 0 && (
                <TabsTrigger value="sources" className="flex items-center gap-2">
                  <Newspaper className="h-4 w-4" />
                  Quellen
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {queueItems.length}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="content">
              <div className="space-y-2">
                <Label className="font-mono text-xs">Inhalt</Label>
                <TiptapEditor content={content} onChange={setContent} />
              </div>
            </TabsContent>

            <TabsContent value="images">
              <div className="border rounded-lg p-4">
                <PostImageGallery postId={id} />
              </div>
            </TabsContent>

            <TabsContent value="sources">
              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Verknüpfte News-Quellen</h3>
                    <p className="text-sm text-muted-foreground">
                      Diese News-Artikel wurden für die Generierung verwendet.
                      Entfernte Items werden zurück in die Queue gestellt.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {queueItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 p-3 bg-muted/50 rounded-lg"
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
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        title={published ? 'Bereits veröffentlicht' : 'Entfernen und zurück in Queue'}
                      >
                        {removingItemId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>

                {published && (
                  <p className="text-xs text-muted-foreground italic">
                    Der Artikel ist bereits veröffentlicht. Quellen können nicht mehr entfernt werden.
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
