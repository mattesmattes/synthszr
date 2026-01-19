'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  FileText,
  Loader2,
  Trash2,
  Eye,
  Calendar,
  Hash,
  Edit2,
  BookOpen,
  Link2,
  Tag,
  AlignLeft,
  Type,
  Send,
  Archive,
  FileEdit,
  Plus,
  Sparkles,
  ExternalLink,
  ImageIcon,
  Bot,
  Brain,
  FlaskConical,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { createClient } from '@/lib/supabase/client'

interface CombinedPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  category: string
  status: 'draft' | 'published' | 'archived'
  created_at: string
  source: 'manual' | 'ai'
  word_count?: number | null
  ai_model?: string | null
}

type AIModel = 'claude-opus-4' | 'claude-sonnet-4' | 'gemini-2.5-pro' | 'gemini-3-pro-preview'

const AI_MODEL_LABELS: Record<AIModel, { label: string; color: string }> = {
  'claude-opus-4': { label: 'Claude Opus 4', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  'claude-sonnet-4': { label: 'Claude Sonnet 4', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  'gemini-2.5-pro': { label: 'Gemini 2.5 Pro', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  'gemini-3-pro-preview': { label: 'Gemini 3 Pro', color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' },
}

const CATEGORIES = ['AI & Tech', 'Marketing', 'Design', 'Business', 'Code', 'Synthese', 'general']

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

// Count words in TipTap content
function countWords(content: Record<string, unknown>): number {
  const text = extractTextPreview(content, 100000)
  return text.split(/\s+/).filter(Boolean).length
}

export default function AdminPage() {
  const [posts, setPosts] = useState<CombinedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingPost, setViewingPost] = useState<CombinedPost | null>(null)
  const [editingPost, setEditingPost] = useState<CombinedPost | null>(null)
  const [deletingPost, setDeletingPost] = useState<CombinedPost | null>(null)
  const [saving, setSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [changingStatus, setChangingStatus] = useState<string | null>(null)

  const [editForm, setEditForm] = useState<{
    title: string
    slug: string
    excerpt: string
    category: string
    status: 'draft' | 'published' | 'archived'
    content: Record<string, unknown>
  }>({ title: '', slug: '', excerpt: '', category: 'AI & Tech', status: 'draft', content: {} })

  // Article thumbnails state
  const [articleThumbnails, setArticleThumbnails] = useState<Array<{ id: string; article_index: number; generation_status: string; image_url?: string; source_text?: string }>>([])
  const [articleCount, setArticleCount] = useState(0)
  const [generatingThumbnails, setGeneratingThumbnails] = useState(false)
  const [regeneratingThumbnailIndex, setRegeneratingThumbnailIndex] = useState<number | null>(null)

  const supabase = createClient()

  // Extract H2 headings (articles) from TipTap content
  function getArticleHeadlines(content: Record<string, unknown>): string[] {
    const headlines: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traverse = (node: any) => {
      if (!node) return
      if (node.type === 'heading' && node.attrs?.level === 2) {
        const headingText = node.content?.map((c: { text?: string }) => c.text || '').join('') || ''
        const lowerText = headingText.toLowerCase()
        if (!lowerText.includes('synthszr take') && !lowerText.includes('mattes synthese')) {
          headlines.push(headingText)
        }
      }
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) traverse(child)
      }
    }
    traverse(content)
    return headlines
  }

  // Count H2 headings (articles) in TipTap content
  function countArticles(content: Record<string, unknown>): number {
    return getArticleHeadlines(content).length
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

  // Regenerate a single article thumbnail
  async function regenerateSingleThumbnail(postId: string, articleIndex: number, headline: string) {
    setRegeneratingThumbnailIndex(articleIndex)
    try {
      // Delete existing thumbnail for this index
      const existing = articleThumbnails.find(t => t.article_index === articleIndex)
      if (existing) {
        await fetch(`/api/generate-article-thumbnails?postId=${postId}&articleIndex=${articleIndex}`, {
          method: 'DELETE',
          credentials: 'include',
        })
      }

      // Generate new thumbnail for this single article
      const res = await fetch('/api/generate-article-thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          postId,
          articles: [{ index: articleIndex, text: headline.slice(0, 300), vote: null }],
        }),
      })
      if (res.ok) {
        await fetchArticleThumbnails(postId)
      }
    } catch (err) {
      console.error('[Thumbnails] Regenerate single failed:', err)
    } finally {
      setRegeneratingThumbnailIndex(null)
    }
  }

  // Delete all article thumbnails for a post
  async function deleteArticleThumbnails(postId: string) {
    if (!confirm('Alle Artikel-Thumbnails löschen?')) return
    try {
      const res = await fetch(`/api/generate-article-thumbnails?postId=${postId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setArticleThumbnails([])
      }
    } catch (err) {
      console.error('[Thumbnails] Delete failed:', err)
    }
  }

  // Generate article thumbnails (deletes existing ones first for regeneration)
  async function generateArticleThumbnails(postId: string, content: Record<string, unknown>) {
    setGeneratingThumbnails(true)

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
      setGeneratingThumbnails(false)
      return
    }

    try {
      // API handles deletion of existing thumbnails
      const res = await fetch('/api/generate-article-thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ postId, articles }),
      })
      await res.json()
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

  async function fetchPosts() {
    setLoading(true)

    // Fetch manual posts
    const { data: manualPosts } = await supabase
      .from('posts')
      .select('id, title, slug, excerpt, content, category, published, created_at')
      .order('created_at', { ascending: false })

    // Fetch AI-generated posts
    const { data: aiPosts } = await supabase
      .from('generated_posts')
      .select('id, title, slug, excerpt, content, category, status, created_at, word_count, ai_model')
      .order('created_at', { ascending: false })

    // Combine and normalize
    const combined: CombinedPost[] = [
      ...(manualPosts || []).map(p => {
        let parsedContent = p.content
        if (typeof p.content === 'string') {
          try {
            parsedContent = JSON.parse(p.content)
          } catch {
            parsedContent = { type: 'doc', content: [] }
          }
        }
        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          content: parsedContent as Record<string, unknown>,
          category: p.category || 'general',
          status: (p.published ? 'published' : 'draft') as 'draft' | 'published' | 'archived',
          created_at: p.created_at,
          source: 'manual' as const,
          word_count: countWords(parsedContent as Record<string, unknown>),
        }
      }),
      ...(aiPosts || []).map(p => {
        let parsedContent = p.content
        if (typeof p.content === 'string') {
          try {
            parsedContent = JSON.parse(p.content)
          } catch {
            parsedContent = { type: 'doc', content: [] }
          }
        }
        return {
          id: p.id,
          title: p.title,
          slug: p.slug || '',
          excerpt: p.excerpt,
          content: parsedContent as Record<string, unknown>,
          category: p.category || 'AI & Tech',
          status: p.status as 'draft' | 'published' | 'archived',
          created_at: p.created_at,
          source: 'ai' as const,
          word_count: p.word_count,
          ai_model: p.ai_model,
        }
      })
    ]

    // Sort by created_at descending
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    setPosts(combined)
    setLoading(false)
  }

  function openViewDialog(post: CombinedPost) {
    setViewingPost(post)
  }

  function openEditDialog(post: CombinedPost) {
    setEditingPost(post)
    setEditForm({
      title: post.title,
      slug: post.slug || generateSlug(post.title),
      excerpt: post.excerpt || '',
      category: post.category || 'AI & Tech',
      status: post.status,
      content: post.content,
    })
    // Fetch article thumbnails and count for AI posts
    if (post.source === 'ai') {
      const count = countArticles(post.content)
      setArticleCount(count)
      fetchArticleThumbnails(post.id)
    } else {
      setArticleCount(0)
      setArticleThumbnails([])
    }
  }

  async function handleStatusChange(post: CombinedPost, newStatus: 'draft' | 'published' | 'archived') {
    setChangingStatus(post.id)
    try {
      if (post.source === 'manual') {
        const { error } = await supabase
          .from('posts')
          .update({ published: newStatus === 'published', updated_at: new Date().toISOString() })
          .eq('id', post.id)
        if (error) throw error
      } else {
        const res = await fetch('/api/admin/generated-posts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: post.id, status: newStatus }),
          credentials: 'include',
        })
        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || 'Fehler beim Statuswechsel')
        }
      }
      fetchPosts()
    } catch (error) {
      console.error('Error changing status:', error)
      alert(error instanceof Error ? error.message : 'Fehler beim Statuswechsel')
    } finally {
      setChangingStatus(null)
    }
  }

  async function handleSaveEdit() {
    if (!editingPost) return

    setSaving(true)
    try {
      if (editingPost.source === 'manual') {
        const { error } = await supabase
          .from('posts')
          .update({
            title: editForm.title,
            slug: editForm.slug,
            excerpt: editForm.excerpt || null,
            category: editForm.category,
            published: editForm.status === 'published',
            content: editForm.content,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingPost.id)
        if (error) throw error
      } else {
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
        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || 'Fehler beim Speichern')
        }

        // Generate article thumbnails if missing (count all non-failed thumbnails)
        const existingThumbnails = articleThumbnails.filter(t => t.generation_status !== 'failed').length
        const currentArticleCount = countArticles(editForm.content)
        if (currentArticleCount > 0 && existingThumbnails < currentArticleCount) {
          generateArticleThumbnails(editingPost.id, editForm.content)
        }
      }
      setEditingPost(null)
      fetchPosts()
    } catch (error) {
      console.error('Error saving post:', error)
      alert(error instanceof Error ? error.message : 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingPost) return

    setIsDeleting(true)
    try {
      if (deletingPost.source === 'manual') {
        const { error } = await supabase.from('posts').delete().eq('id', deletingPost.id)
        if (error) throw error
      } else {
        const res = await fetch(`/api/admin/generated-posts?id=${deletingPost.id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) {
          const error = await res.json()
          throw new Error(error.error || 'Fehler beim Löschen')
        }
      }
      setDeletingPost(null)
      fetchPosts()
    } catch (error) {
      console.error('Error deleting post:', error)
      alert(error instanceof Error ? error.message : 'Fehler beim Löschen')
    } finally {
      setIsDeleting(false)
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
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
            <FileText className="h-8 w-8" />
            Blog Posts
          </h1>
          <div className="mt-1 flex items-center gap-3">
            <a
              href="/api/admin/analyze-edits"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Brain className="h-3 w-3" />
              Analyze Edits
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <span className="text-muted-foreground/30">|</span>
            <a
              href="/api/cron/extract-patterns"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <FlaskConical className="h-3 w-3" />
              Extract Patterns
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
        <Button asChild>
          <Link href="/admin/new" className="gap-2">
            <Plus className="h-4 w-4" />
            Neuer Post
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">Noch keine Posts vorhanden.</p>
            <Button asChild>
              <Link href="/admin/new">Ersten Post erstellen</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={`${post.source}-${post.id}`}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-medium">{post.title}</h3>
                      {post.source === 'ai' && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Sparkles className="h-3 w-3" /> AI
                        </Badge>
                      )}
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
                        })}
                      </span>
                      {post.word_count && (
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {post.word_count} Wörter
                        </span>
                      )}
                      {post.slug && (
                        <span className="flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          /{post.slug}
                        </span>
                      )}
                      {post.status === 'published' && (
                        <Link
                          href={`/posts/${post.slug}`}
                          target="_blank"
                          className="flex items-center gap-1 hover:text-primary transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ansehen
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openViewDialog(post)} title="Vorschau">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(post)} title="Bearbeiten">
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    {post.status === 'draft' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStatusChange(post, 'published')}
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStatusChange(post, 'draft')}
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
                    )}
                    {post.status !== 'archived' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStatusChange(post, 'archived')}
                        disabled={changingStatus === post.id}
                        title="Archivieren"
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {changingStatus === post.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingPost(post)}
                      title="Löschen"
                    >
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
            <DialogTitle className="flex items-center gap-2">
              {viewingPost?.title}
              {viewingPost?.source === 'ai' && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Sparkles className="h-3 w-3" /> AI
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {viewingPost?.word_count} Wörter • {viewingPost?.category} • Erstellt am{' '}
              {viewingPost && new Date(viewingPost.created_at).toLocaleDateString('de-DE')}
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {viewingPost && <TiptapRenderer content={viewingPost.content} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPost(null)}>
              Schließen
            </Button>
            <Button onClick={() => {
              if (viewingPost) {
                openEditDialog(viewingPost)
                setViewingPost(null)
              }
            }}>
              <Edit2 className="h-4 w-4 mr-2" />
              Bearbeiten
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
              <DialogTitle className="flex items-center gap-2">
                Artikel bearbeiten
                {editingPost?.source === 'ai' && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Sparkles className="h-3 w-3" /> AI
                  </Badge>
                )}
              </DialogTitle>
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
                    slug: generateSlug(e.target.value),
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
                className="h-20 resize-none"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">{editForm.excerpt.length}/200 Zeichen</p>
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
            <Tabs defaultValue="content">
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

              <TabsContent value="content" className="mt-4">
                <div className="min-h-[300px] border rounded-md">
                  <TiptapEditor
                    content={editForm.content}
                    onChange={(content) => setEditForm({ ...editForm, content })}
                  />
                </div>
              </TabsContent>

              <TabsContent value="images" className="mt-4">
                {editingPost?.source === 'ai' ? (
                  <div className="space-y-6">
                    {/* Article Thumbnails Section */}
                    {articleCount > 0 && (
                      <div className="border rounded-lg p-4 bg-muted/10">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#CCFF00] flex items-center justify-center">
                              <span className="text-xs font-bold text-black">●</span>
                            </div>
                            <div>
                              <h3 className="font-semibold text-sm">Artikel-Thumbnails</h3>
                              <p className="text-xs text-muted-foreground">
                                Runde Icons für jede News • {articleThumbnails.filter(t => t.generation_status === 'completed').length} von {articleCount} generiert
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {articleThumbnails.filter(t => t.generation_status === 'completed').length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => deleteArticleThumbnails(editingPost.id)}
                                className="gap-1.5 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Löschen
                              </Button>
                            )}
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
                                  {articleThumbnails.filter(t => t.generation_status === 'completed').length > 0 ? 'Neu generieren' : 'Generieren'}
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        {/* Thumbnail Grid with Headlines */}
                        {articleThumbnails.filter(t => t.generation_status === 'completed').length > 0 ? (
                          <div className="grid grid-cols-3 gap-4">
                            {getArticleHeadlines(editForm.content).map((headline, idx) => {
                              const thumbnail = articleThumbnails.find(t => t.article_index === idx)
                              const isRegenerating = regeneratingThumbnailIndex === idx
                              return (
                                <div key={idx} className="border rounded-lg p-3 bg-background group relative">
                                  <div className="aspect-square rounded-full overflow-hidden bg-[#CCFF00] mb-3 mx-auto w-24 relative">
                                    {thumbnail?.image_url ? (
                                      <img
                                        src={thumbnail.image_url}
                                        alt={`Thumbnail ${idx + 1}`}
                                        className="w-full h-full object-cover"
                                        style={{ imageRendering: 'pixelated' }}
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                        {thumbnail?.generation_status === 'generating' || isRegenerating ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : '—'}
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-xs text-center line-clamp-2 text-muted-foreground mb-2">
                                    {headline.slice(0, 80)}{headline.length > 80 ? '...' : ''}
                                  </p>
                                  {/* Regenerate button - always visible */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-7 text-xs"
                                    disabled={isRegenerating || generatingThumbnails}
                                    onClick={() => regenerateSingleThumbnail(editingPost!.id, idx, headline)}
                                  >
                                    {isRegenerating ? (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    ) : (
                                      <RefreshCw className="h-3 w-3 mr-1" />
                                    )}
                                    {thumbnail?.image_url ? 'Neu' : 'Generieren'}
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-lg">
                            Noch keine Thumbnails generiert
                          </div>
                        )}
                      </div>
                    )}

                    {/* Cover Images Section */}
                    <div className="border rounded-lg p-4 bg-muted/10">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded bg-[#CCFF00] flex items-center justify-center">
                          <span className="text-xs font-bold text-black">▢</span>
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm">Cover-Bilder</h3>
                          <p className="text-xs text-muted-foreground">Rechteckige Bilder für Artikelvorschau</p>
                        </div>
                      </div>
                      <PostImageGallery postId={editingPost.id} />
                      <div className="mt-3">
                        <GenerateImagesButton postId={editingPost.id} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <p>Bildergalerie nur für AI-generierte Artikel verfügbar</p>
                  </div>
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
            <AlertDialogTitle>Post löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Post &quot;{deletingPost?.title}&quot; wirklich löschen?
              {deletingPost?.status === 'published' && (
                <span className="block mt-2 text-destructive font-medium">
                  Achtung: Dieser Post ist bereits veröffentlicht!
                </span>
              )}
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Component to manually trigger image generation for a post
function GenerateImagesButton({ postId }: { postId: string }) {
  const [generating, setGenerating] = useState(false)
  const supabase = createClient()

  async function generateImages() {
    setGenerating(true)
    try {
      // Get the post content
      const { data: post } = await supabase
        .from('generated_posts')
        .select('content')
        .eq('id', postId)
        .single()

      if (!post?.content) {
        alert('Kein Post-Inhalt gefunden.')
        return
      }

      // Parse TipTap content to extract text with headings
      let textContent = ''
      const extractedSections: Array<{ title: string; content: string }> = []

      try {
        const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content

        // Extract text with structure awareness
        let currentHeading = ''
        let currentContent = ''

        const processNode = (node: Record<string, unknown>) => {
          if (node.type === 'heading') {
            // Save previous section if exists
            if (currentHeading && currentContent.trim().length > 50) {
              extractedSections.push({ title: currentHeading, content: currentContent.trim() })
            }
            // Start new section
            currentHeading = ''
            if (node.content && Array.isArray(node.content)) {
              currentHeading = node.content.map((n: Record<string, unknown>) => n.text || '').join('')
            }
            currentContent = ''
          } else if (node.text) {
            currentContent += node.text + ' '
            textContent += node.text + ' '
          } else if (node.content && Array.isArray(node.content)) {
            node.content.forEach(processNode)
            if (node.type === 'paragraph') currentContent += '\n'
          }
        }

        processNode(content)

        // Don't forget the last section
        if (currentHeading && currentContent.trim().length > 50) {
          extractedSections.push({ title: currentHeading, content: currentContent.trim() })
        }
      } catch {
        alert('Fehler beim Parsen des Inhalts.')
        return
      }

      // Use extracted sections, or fall back to text splitting
      let sectionsToProcess: Array<{ title: string; content: string }> = []

      if (extractedSections.length > 0) {
        sectionsToProcess = extractedSections.slice(0, 3)
      } else {
        // Fallback: split by paragraphs
        const paragraphs = textContent
          .split(/\n{2,}/)
          .map(s => s.trim())
          .filter(s => s.length > 50)
          .slice(0, 3)

        sectionsToProcess = paragraphs.map((p, i) => ({
          title: `Abschnitt ${i + 1}`,
          content: p
        }))
      }

      if (sectionsToProcess.length === 0) {
        alert('Keine ausreichenden Textabschnitte für Bildgenerierung gefunden.')
        return
      }

      console.log(`[ImageGen] Found ${sectionsToProcess.length} sections for image generation`)

      // Delete any existing failed/generating images for this post
      await supabase
        .from('post_images')
        .delete()
        .eq('post_id', postId)
        .in('generation_status', ['pending', 'generating', 'failed'])

      // Trigger image generation from post content sections
      const response = await fetch('/api/generate-image', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          newsItems: sectionsToProcess.map(s => ({
            text: `${s.title}\n\n${s.content.slice(0, 2000)}`,
          })),
        }),
      })

      if (response.ok) {
        // Also trigger article thumbnail generation
        const content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
        const articles: Array<{ index: number; text: string; vote: null }> = []
        let articleIndex = 0

        const extractH2Headings = (node: Record<string, unknown>) => {
          if (node.type === 'heading' && (node.attrs as Record<string, unknown>)?.level === 2) {
            const headingText = (node.content as Array<{ text?: string }>)
              ?.map(c => c.text || '').join('') || ''
            const lowerText = headingText.toLowerCase()
            if (!lowerText.includes('synthszr take') && !lowerText.includes('mattes synthese')) {
              articles.push({ index: articleIndex++, text: headingText.slice(0, 300), vote: null })
            }
          }
          if (node.content && Array.isArray(node.content)) {
            node.content.forEach(extractH2Headings)
          }
        }
        extractH2Headings(content)

        if (articles.length > 0) {
          console.log(`[ImageGen] Triggering ${articles.length} article thumbnails`)
          fetch('/api/generate-article-thumbnails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ postId, articles }),
          }).catch(err => console.error('[Thumbnails] Error:', err))
        }

        alert('Bildgenerierung gestartet! Die Seite wird aktualisiert.')
        window.location.reload()
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Unbekannter Fehler')
      }
    } catch (error) {
      console.error('Error generating images:', error)
      alert('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="border-t pt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={generateImages}
        disabled={generating}
        className="w-full"
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generiere Bilder...
          </>
        ) : (
          <>
            <ImageIcon className="h-4 w-4 mr-2" />
            Neue Bilder generieren
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        Visualisiert bis zu 5 News-Snippets aus dem Blogpost
      </p>
    </div>
  )
}
