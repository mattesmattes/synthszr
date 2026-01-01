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
  Link as LinkIcon
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
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
import { TiptapEditor } from '@/components/tiptap-editor'
import { TiptapRenderer } from '@/components/tiptap-renderer'

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
  content: Record<string, unknown>
  word_count: number | null
  status: 'draft' | 'published' | 'archived'
  created_at: string
  digest?: Digest | null
  prompt?: { name: string } | null
}

export default function GeneratedArticlesPage() {
  const [posts, setPosts] = useState<GeneratedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingPost, setViewingPost] = useState<GeneratedPost | null>(null)
  const [editingPost, setEditingPost] = useState<GeneratedPost | null>(null)
  const [deletingPost, setDeletingPost] = useState<GeneratedPost | null>(null)
  const [viewingDigest, setViewingDigest] = useState<Digest | null>(null)
  const [saving, setSaving] = useState(false)

  const [editForm, setEditForm] = useState<{ title: string; content: Record<string, unknown> }>({ title: '', content: {} })

  useEffect(() => {
    fetchPosts()
  }, [])

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
    setEditForm({ title: post.title, content: post.content })
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
          content: editForm.content,
        }),
        credentials: 'include',
      })

      if (res.ok) {
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
    <div className="p-8">
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-medium">{post.title}</h3>
                      <Badge className={statusColors[post.status]}>
                        {statusLabels[post.status]}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground line-clamp-2">
                      <TiptapRenderer content={post.content} />
                    </div>
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
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openViewDialog(post)} title="Vorschau">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(post)} title="Bearbeiten">
                      <Edit2 className="h-4 w-4" />
                    </Button>
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
          <DialogHeader>
            <DialogTitle>Artikel bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeite Titel und Inhalt des generierten Artikels
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-y-auto py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Titel</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              />
            </div>
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <Label>Inhalt</Label>
              <div className="flex-1 min-h-[300px] max-h-[50vh] overflow-y-auto border rounded-md">
                <TiptapEditor
                  content={editForm.content}
                  onChange={(content) => setEditForm({ ...editForm, content })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setEditingPost(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
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
