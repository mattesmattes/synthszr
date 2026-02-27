'use client'

import { useEffect, useState } from 'react'
import {
  FileText,
  Loader2,
  Trash2,
  Eye,
  Calendar,
  Hash,
  ExternalLink,
  Edit2,
  BookOpen,
  Link as LinkIcon,
  Link2,
  Tag,
  AlignLeft,
  Type,
  Send,
  Archive,
  FileEdit,
  ImageIcon,
  Bot,
  Sparkles,
  Languages
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TiptapEditor } from '@/components/tiptap-editor'
import { TiptapRenderer } from '@/components/tiptap-renderer'
import { PostImageGallery } from '@/components/post-image-gallery'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface DigestSource {
  id: string
  title: string
  source_url: string | null
  source_email: string | null
  source_type: string
  collected_at: string
}

interface Digest {
  id: string
  digest_date: string
  analysis_content: string | null
  word_count: number | null
  sources?: DigestSource[]
}

interface GeneratedPost {
  id: string
  title: string
  slug: string | null
  excerpt: string | null
  category: string | null
  content: Record<string, unknown>
  word_count: number | null
  status: 'draft' | 'published' | 'archived'
  created_at: string
  digest?: Digest | null
  prompt?: { name: string } | null
  ai_model?: string | null
}

type AIModel = 'claude-opus-4' | 'claude-sonnet-4' | 'gemini-2.5-pro' | 'gemini-2.0-flash'

const AI_MODEL_LABELS: Record<AIModel, { label: string; color: string }> = {
  'claude-opus-4': { label: 'Claude Opus 4', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  'claude-sonnet-4': { label: 'Claude Sonnet 4', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  'gemini-2.5-pro': { label: 'Gemini 2.5 Pro', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  'gemini-2.0-flash': { label: 'Gemini 3 Pro', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' },
}

const CATEGORIES = ['AI & Tech', 'Marketing', 'Design', 'Business', 'Code', 'Synthese']

// Extract plain text from TipTap JSON for preview
function extractTextPreview(content: Record<string, unknown>, maxLength = 200): string {
  const extractText = (node: Record<string, unknown>): string => {
    if (node.text) return node.text as string
    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extractText).join(' ')
    }
    return ''
  }
  const text = extractText(content).replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
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

export default function GeneratedArticlesPage() {
  const [posts, setPosts] = useState<GeneratedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingPost, setViewingPost] = useState<GeneratedPost | null>(null)
  const [editingPost, setEditingPost] = useState<GeneratedPost | null>(null)
  const [deletingPost, setDeletingPost] = useState<GeneratedPost | null>(null)
  const [viewingDigest, setViewingDigest] = useState<Digest | null>(null)
  const [saving, setSaving] = useState(false)

  const [editForm, setEditForm] = useState<{
    title: string
    slug: string
    excerpt: string
    category: string
    status: 'draft' | 'published' | 'archived'
    content: Record<string, unknown>
  }>({ title: '', slug: '', excerpt: '', category: 'AI & Tech', status: 'draft', content: {} })
  const [changingStatus, setChangingStatus] = useState<string | null>(null)

  // Article thumbnails state
  const [articleThumbnails, setArticleThumbnails] = useState<Array<{ id: string; article_index: number; generation_status: string }>>([])
  const [articleCount, setArticleCount] = useState(0)
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false)

  // Translation trigger state
  const [triggeringTranslations, setTriggeringTranslations] = useState<string | null>(null)

  // Count H2 headings (articles) in TipTap content
  function countArticles(content: Record<string, unknown>): number {
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
    traverse(content)
    return count
  }

  // Fetch article thumbnails for a post
  async function fetchArticleThumbnails(postId: string) {
    try {
      const res = await fetch(`/api/generate-article-thumbnails?postId=${postId}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setArticleThumbnails(data.thumbnails || [])
      }
    } catch (err) {
      console.error('[Thumbnails] Failed to fetch:', err)
    }
  }

  // Generate article thumbnails
  async function generateArticleThumbnails(postId: string, content: Record<string, unknown>) {
    setGeneratingThumbnails(true)

    // Extract articles from content
    const articles: Array<{ index: number; text: string; vote: null }> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractArticles = (node: any, currentIndex = { value: 0 }) => {
      if (!node) return
      if (node.type === 'heading' && node.attrs?.level === 2) {
        const headingText = node.content?.map((c: { text?: string }) => c.text || '').join('') || ''
        const lowerText = headingText.toLowerCase()
        if (!lowerText.includes('synthszr take') && !lowerText.includes('mattes synthese')) {
          articles.push({
            index: currentIndex.value,
            text: headingText.slice(0, 300),
            vote: null,
          })
          currentIndex.value++
        }
      }
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) extractArticles(child, currentIndex)
      }
    }
    extractArticles(content)

    if (articles.length === 0) {
      console.log('[Thumbnails] No articles found')
      setGeneratingThumbnails(false)
      return
    }

    console.log(`[Thumbnails] Generating ${articles.length} thumbnails for post ${postId}`)

    try {
      const res = await fetch('/api/generate-article-thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId, articles }),
      })
      const data = await res.json()
      console.log(`[Thumbnails] Generated: ${data.generated}, Failed: ${data.failed}`)
      await fetchArticleThumbnails(postId)
    } catch (err) {
      console.error('[Thumbnails] Generation failed:', err)
    } finally {
      setGeneratingThumbnails(false)
    }
  }

  useEffect(() => {
    fetchPosts()
  }, [])

  // Trigger translations for a post manually
  async function triggerTranslations(postId: string) {
    setTriggeringTranslations(postId)
    try {
      const res = await fetch('/api/admin/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'trigger',
          content_type: 'generated_post',
          content_id: postId,
          priority: 10,
        }),
      })
      const data = await res.json()
      if (res.ok && data.queued > 0) {
        console.log(`[i18n] Queued ${data.queued} translations for post ${postId}`)
        // Start processing the queue
        fetch('/api/admin/translations/process-queue', {
          method: 'POST',
          credentials: 'include',
        })
          .then(r => r.json())
          .then(result => console.log(`[i18n] Processing started: ${result.processed} items`))
          .catch(err => console.error('[i18n] Process queue error:', err))
      } else if (data.queued === 0) {
        console.log('[i18n] No translations queued (all manually edited or no languages)')
      } else {
        console.error('[i18n] Failed to trigger translations:', data.error)
      }
    } catch (err) {
      console.error('[i18n] Error triggering translations:', err)
    } finally {
      setTriggeringTranslations(null)
    }
  }

  async function fetchPosts() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/generated-posts', { credentials: 'include' })
      console.log('[Generated Articles] API response status:', res.status)
      if (res.ok) {
        const data = await res.json()
        console.log('[Generated Articles] Fetched posts:', data.length, 'items')
        // Parse content from JSON string if needed (database stores as TEXT, not JSONB)
        const parsedPosts = data.map((post: GeneratedPost & { content: string | Record<string, unknown> }) => {
          let parsedContent: Record<string, unknown> = { type: 'doc', content: [] }

          if (typeof post.content === 'string') {
            try {
              parsedContent = JSON.parse(post.content)
            } catch (e) {
              // If parsing fails (e.g., old data stored as [object Object]), create empty doc
              console.warn('Failed to parse content for post:', post.id, e)
              parsedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: post.content || 'Kein Inhalt' }] }] }
            }
          } else if (post.content && typeof post.content === 'object') {
            parsedContent = post.content
          }

          return { ...post, content: parsedContent }
        })
        setPosts(parsedPosts)
      }
    } catch (error) {
      console.error('Error fetching posts:', error)
    } finally {
      setLoading(false)
    }
  }

  function openViewDialog(post: GeneratedPost) {
    setViewingPost(post)
  }

  function openEditDialog(post: GeneratedPost) {
    setEditingPost(post)
    setEditForm({
      title: post.title,
      slug: post.slug || generateSlug(post.title),
      excerpt: post.excerpt || '',
      category: post.category || 'AI & Tech',
      status: post.status,
      content: post.content
    })
    // Fetch article thumbnails and count
    setArticleCount(countArticles(post.content))
    fetchArticleThumbnails(post.id)
  }

  async function handleStatusChange(postId: string, newStatus: 'draft' | 'published' | 'archived') {
    setChangingStatus(postId)
    try {
      const res = await fetch('/api/admin/generated-posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postId, status: newStatus }),
        credentials: 'include',
      })

      if (res.ok) {
        // Trigger translations when publishing (with retry logic)
        if (newStatus === 'published') {
          console.log(`[i18n] Triggering translations for post ${postId}`)

          const queueWithRetry = async (retries = 3): Promise<{ queued: number; error?: string }> => {
            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                const queueRes = await fetch('/api/admin/translations/queue', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({
                    content_type: 'generated_post',
                    content_id: postId,
                    priority: 10,
                  }),
                })
                if (!queueRes.ok) {
                  const errorData = await queueRes.json().catch(() => ({ error: 'Unknown error' }))
                  throw new Error(errorData.error || `HTTP ${queueRes.status}`)
                }
                return await queueRes.json()
              } catch (err) {
                console.error(`[i18n] Queue attempt ${attempt}/${retries} failed:`, err)
                if (attempt === retries) {
                  return { queued: 0, error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
              }
            }
            return { queued: 0, error: 'Alle Versuche fehlgeschlagen' }
          }

          queueWithRetry().then(async (result) => {
            if (result.error) {
              console.error('[i18n] Translation queue failed:', result.error)
              alert(`⚠️ Post veröffentlicht, aber Übersetzungen fehlgeschlagen: ${result.error}\n\nBitte manuell in /admin/translations starten.`)
              return
            }
            if (result.queued > 0) {
              console.log(`[i18n] Queued ${result.queued} translations, starting processing...`)
              fetch('/api/admin/translations/process-queue', {
                method: 'POST',
                credentials: 'include',
              })
                .then(res => res.json())
                .then(processResult => console.log(`[i18n] Processing started: ${processResult.processed || 0} items`))
                .catch(err => console.error('[i18n] Process queue error:', err))
            }
          })
        }
        fetchPosts()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Statuswechsel')
      }
    } catch (error) {
      console.error('Error changing status:', error)
      alert('Fehler beim Statuswechsel')
    } finally {
      setChangingStatus(null)
    }
  }

  function openDeleteDialog(post: GeneratedPost) {
    setDeletingPost(post)
  }

  async function handleSaveEdit() {
    if (!editingPost) return

    setSaving(true)
    try {
      const res = await fetch('/api/admin/generated-posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingPost.id,
          title: editForm.title,
          slug: editForm.slug,
          excerpt: editForm.excerpt,
          category: editForm.category,
          status: editForm.status,
          content: editForm.content,
        }),
        credentials: 'include',
      })

      if (res.ok) {
        // Trigger translations when publishing for the first time
        const wasPublished = editingPost.status === 'published'
        const isNowPublished = editForm.status === 'published'
        if (!wasPublished && isNowPublished) {
          console.log(`[i18n] Triggering translations for post ${editingPost.id}`)
          fetch('/api/admin/translations/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              content_type: 'generated_post',
              content_id: editingPost.id,
              priority: 10,
            }),
          })
            .then(res => res.json())
            .then(data => {
              if (data.queued > 0) {
                console.log(`[i18n] Queued ${data.queued} translations, starting processing...`)
                // Immediately start processing the queue
                fetch('/api/admin/translations/process-queue', {
                  method: 'POST',
                  credentials: 'include',
                })
                  .then(res => res.json())
                  .then(result => console.log(`[i18n] Processing started: ${result.processed} items`))
                  .catch(err => console.error('[i18n] Process queue error:', err))
              }
            })
            .catch(err => console.error('[i18n] Translation queue error:', err))
        }

        // NOTE: Thumbnails are NOT auto-generated on save
        // User must manually go to "Bilder" tab and click "Generieren"
        // This ensures intentional thumbnail creation after content is finalized

        setEditingPost(null)
        fetchPosts()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Speichern')
      }
    } catch (error) {
      console.error('Error saving post:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingPost) return

    try {
      const res = await fetch(`/api/admin/generated-posts?id=${deletingPost.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (res.ok) {
        setDeletingPost(null)
        fetchPosts()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Löschen')
      }
    } catch (error) {
      console.error('Error deleting post:', error)
      alert('Fehler beim Löschen')
    }
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    published: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    archived: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  }

  const statusLabels: Record<string, string> = {
    draft: 'Entwurf',
    published: 'Veröffentlicht',
    archived: 'Archiviert',
  }

  return (
    <div className="p-4 md:p-8 max-w-full overflow-x-hidden">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <FileText className="h-8 w-8" />
          Generierte AI-Artikel
        </h1>
        <p className="mt-1 text-muted-foreground">
          Übersicht aller mit dem Ghostwriter erstellten Blogartikel
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Keine Artikel vorhanden
            </CardTitle>
            <CardDescription>
              Erstelle deinen ersten AI-Artikel unter &quot;AI Artikel erstellen&quot; oder nutze den Ghostwriter in der Digests-Übersicht.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-medium">{post.title}</h3>
                      <Badge className={statusColors[post.status]}>
                        {statusLabels[post.status]}
                      </Badge>
                      {post.category && (
                        <Badge variant="outline" className="text-xs">
                          {post.category}
                        </Badge>
                      )}
                      {post.ai_model && AI_MODEL_LABELS[post.ai_model as AIModel] && (
                        <Badge className={`text-xs ${AI_MODEL_LABELS[post.ai_model as AIModel].color}`}>
                          <Bot className="h-3 w-3 mr-1" />
                          {AI_MODEL_LABELS[post.ai_model as AIModel].label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {post.excerpt || extractTextPreview(post.content)}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(post.created_at).toLocaleDateString('de-DE', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {post.word_count && (
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {post.word_count} Wörter
                        </span>
                      )}
                      {post.digest && (
                        <button
                          onClick={() => setViewingDigest(post.digest!)}
                          className="flex items-center gap-1 hover:text-primary transition-colors underline-offset-2 hover:underline"
                        >
                          <BookOpen className="h-3 w-3" />
                          Digest vom {new Date(post.digest.digest_date).toLocaleDateString('de-DE')}
                        </button>
                      )}
                      {post.prompt?.name && (
                        <Badge variant="outline" className="text-xs">
                          {post.prompt.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openViewDialog(post)} title="Vorschau">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" asChild title="Bearbeiten">
                      <Link href={`/admin/generated-articles/edit/${post.id}`}>
                        <Edit2 className="h-4 w-4" />
                      </Link>
                    </Button>
                    {post.status === 'draft' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStatusChange(post.id, 'published')}
                        disabled={changingStatus === post.id}
                        title="Veröffentlichen"
                        className="text-green-600 hover:text-green-700"
                      >
                        {changingStatus === post.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {post.status === 'published' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => triggerTranslations(post.id)}
                          disabled={triggeringTranslations === post.id}
                          title="Übersetzungen triggern"
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {triggeringTranslations === post.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Languages className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleStatusChange(post.id, 'draft')}
                          disabled={changingStatus === post.id}
                          title="Zurück zu Entwurf"
                          className="text-yellow-600 hover:text-yellow-700"
                        >
                          {changingStatus === post.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileEdit className="h-4 w-4" />
                          )}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(post)} title="Löschen">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewingPost} onOpenChange={() => setViewingPost(null)}>
        <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingPost?.title}</DialogTitle>
            <DialogDescription>
              {viewingPost?.word_count} Wörter • Erstellt am {viewingPost && new Date(viewingPost.created_at).toLocaleDateString('de-DE')}
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {viewingPost && <TiptapRenderer content={viewingPost.content} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPost(null)}>
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingPost} onOpenChange={() => setEditingPost(null)}>
        <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
          <div className="space-y-4 flex-1 overflow-y-auto py-4">
            {/* Header - scrolls with content */}
            <DialogHeader>
              <DialogTitle>Artikel bearbeiten</DialogTitle>
              <DialogDescription>
                Bearbeite Metadaten und Inhalt des Artikels
              </DialogDescription>
            </DialogHeader>
            {/* Metadata Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title" className="flex items-center gap-1.5 text-sm">
                  <Type className="h-3.5 w-3.5" />
                  Titel
                </Label>
                <Input
                  id="edit-title"
                  value={editForm.title}
                  onChange={(e) => setEditForm({
                    ...editForm,
                    title: e.target.value,
                    slug: generateSlug(e.target.value)
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-slug" className="flex items-center gap-1.5 text-sm">
                  <Link2 className="h-3.5 w-3.5" />
                  Slug (URL)
                </Label>
                <Input
                  id="edit-slug"
                  value={editForm.slug}
                  onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                  placeholder="artikel-url-slug"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-excerpt" className="flex items-center gap-1.5 text-sm">
                <AlignLeft className="h-3.5 w-3.5" />
                Excerpt (SEO-Beschreibung)
              </Label>
              <Textarea
                id="edit-excerpt"
                value={editForm.excerpt}
                onChange={(e) => setEditForm({ ...editForm, excerpt: e.target.value })}
                placeholder="Kurze Zusammenfassung für Vorschau und SEO..."
                className="h-24 resize-none"
                maxLength={800}
              />
              <p className="text-xs text-muted-foreground">{editForm.excerpt.length}/800 Zeichen</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Tag className="h-3.5 w-3.5" />
                  Kategorie
                </Label>
                <Select
                  value={editForm.category}
                  onValueChange={(value) => setEditForm({ ...editForm, category: value })}
                >
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
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Send className="h-3.5 w-3.5" />
                  Status
                </Label>
                <Select
                  value={editForm.status}
                  onValueChange={(value: 'draft' | 'published' | 'archived') => setEditForm({ ...editForm, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">
                      <span className="flex items-center gap-2">
                        <FileEdit className="h-3.5 w-3.5" />
                        Entwurf
                      </span>
                    </SelectItem>
                    <SelectItem value="published">
                      <span className="flex items-center gap-2">
                        <Send className="h-3.5 w-3.5" />
                        Veröffentlicht
                      </span>
                    </SelectItem>
                    <SelectItem value="archived">
                      <span className="flex items-center gap-2">
                        <Archive className="h-3.5 w-3.5" />
                        Archiviert
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Content and Images Tabs */}
            <Tabs defaultValue="content" className="flex-1 flex flex-col min-h-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="content" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Inhalt
                </TabsTrigger>
                <TabsTrigger value="images" className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
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
              </TabsList>

              <TabsContent value="content" className="flex-1 flex flex-col min-h-0 mt-4">
                <div className="flex-1 min-h-[400px] border rounded-md">
                  <TiptapEditor
                    content={editForm.content}
                    onChange={(content) => setEditForm({ ...editForm, content })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="images" className="flex-1 overflow-y-auto mt-4 space-y-4">
                {/* Article Thumbnails Section */}
                {articleCount > 0 && editingPost && (
                  <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
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
                      onClick={() => generateArticleThumbnails(editingPost.id, editForm.content)}
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

                {editingPost && (
                  <PostImageGallery postId={editingPost.id} />
                )}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setEditingPost(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editForm.title}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingPost} onOpenChange={() => setDeletingPost(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Artikel löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Artikel &quot;{deletingPost?.title}&quot; wirklich löschen?
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Digest Dialog */}
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
              {viewingDigest?.sources && viewingDigest.sources.length > 0 && ` • ${viewingDigest.sources.length} Quellen`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-6 py-4">
            {/* Sources Section */}
            {viewingDigest?.sources && viewingDigest.sources.length > 0 && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  Quellen ({viewingDigest.sources.length})
                </h3>
                <div className="space-y-2">
                  {viewingDigest.sources.map((source) => (
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

            {!viewingDigest?.analysis_content && (
              <p className="text-muted-foreground text-center py-8">
                Kein Digest-Inhalt verfügbar
              </p>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setViewingDigest(null)}>
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
