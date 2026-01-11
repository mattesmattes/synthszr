'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, ImageIcon } from 'lucide-react'
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
import { createClient } from '@/lib/supabase/client'
import { use } from 'react'

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
      }

      setLoading(false)
    }

    loadPost()
  }, [id, supabase])

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
    const pendingQueueItems = post?.pending_queue_item_ids || []

    // Update the post
    const updateData: Record<string, unknown> = {
      title,
      slug,
      excerpt: excerpt || null,
      category,
      content: JSON.stringify(content),
      status: published ? 'published' : 'draft',
      updated_at: new Date().toISOString(),
    }

    // Clear pending_queue_item_ids when publishing (they'll be marked as used)
    if (!wasPublished && isNowPublished && pendingQueueItems.length > 0) {
      updateData.pending_queue_item_ids = []
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

    // Mark queue items as "used" when publishing for the first time
    if (!wasPublished && isNowPublished && pendingQueueItems.length > 0) {
      console.log(`[Queue] Publishing post - marking ${pendingQueueItems.length} items as used`)
      try {
        const response = await fetch('/api/admin/news-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action: 'use',
            itemIds: pendingQueueItems,
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
          </Tabs>
        </form>
      </main>
    </div>
  )
}
