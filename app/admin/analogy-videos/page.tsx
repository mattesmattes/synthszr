'use client'

import { useEffect, useState } from 'react'
import { Film, Loader2, Play, Trash2, RotateCcw, Check, X, ImageIcon, Volume2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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

interface AnalogyVideo {
  id: string
  post_id: string
  analogy_text: string
  context_text: string | null
  source_section: string | null
  status: string
  progress: number
  image_prompt: string | null
  image_url: string | null
  image_fallback: boolean
  audio_url: string | null
  audio_duration_seconds: number | null
  video_url: string | null
  video_duration_seconds: number | null
  thumbnail_url: string | null
  error_message: string | null
  attempts: number
  created_at: string
  updated_at: string
  generated_posts?: { title: string; slug: string }
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ausstehend', variant: 'secondary' },
  generating_image: { label: 'Bild...', variant: 'outline' },
  generating_audio: { label: 'Audio...', variant: 'outline' },
  compositing: { label: 'Video...', variant: 'outline' },
  review: { label: 'Review', variant: 'default' },
  published: { label: 'Publiziert', variant: 'default' },
  failed: { label: 'Fehler', variant: 'destructive' },
}

export default function AnalogyVideosPage() {
  const [videos, setVideos] = useState<AnalogyVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [processing, setProcessing] = useState(false)
  const [previewVideo, setPreviewVideo] = useState<AnalogyVideo | null>(null)
  const [deleteVideo, setDeleteVideo] = useState<AnalogyVideo | null>(null)
  const [recentPosts, setRecentPosts] = useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [selectedPostId, setSelectedPostId] = useState('')
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    fetchVideos()
    fetchRecentPosts()
  }, [statusFilter])

  async function fetchRecentPosts() {
    try {
      const res = await fetch('/api/admin/posts?limit=5&published=false', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        const posts = data.posts || []
        setRecentPosts(posts)
        if (posts.length > 0 && !selectedPostId) {
          setSelectedPostId(posts[0].id)
        }
      }
    } catch (error) {
      console.error('Error fetching posts:', error)
    }
  }

  async function fetchVideos() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/admin/analogy-videos?${params}`, { credentials: 'include' })
      if (res.ok) {
        setVideos(await res.json())
      }
    } catch (error) {
      console.error('Error fetching videos:', error)
    } finally {
      setLoading(false)
    }
  }

  async function processNext() {
    setProcessing(true)
    try {
      const res = await fetch('/api/admin/analogy-videos/process', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.success) {
        await fetchVideos()
      }
    } catch (error) {
      console.error('Error processing:', error)
    } finally {
      setProcessing(false)
    }
  }

  async function processSpecific(videoId: string) {
    setProcessing(true)
    try {
      await fetch('/api/admin/analogy-videos/process', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      await fetchVideos()
    } catch (error) {
      console.error('Error processing:', error)
    } finally {
      setProcessing(false)
    }
  }

  async function updateStatus(videoId: string, status: string) {
    try {
      await fetch(`/api/admin/analogy-videos/${videoId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await fetchVideos()
      if (previewVideo?.id === videoId) setPreviewVideo(null)
    } catch (error) {
      console.error('Error updating status:', error)
    }
  }

  async function handleDelete(videoId: string) {
    try {
      await fetch(`/api/admin/analogy-videos/${videoId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setDeleteVideo(null)
      await fetchVideos()
    } catch (error) {
      console.error('Error deleting:', error)
    }
  }

  async function extractFromPost() {
    if (!selectedPostId) return
    setExtracting(true)
    try {
      const res = await fetch('/api/admin/analogy-videos/extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: selectedPostId }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchVideos()
      }
    } catch (error) {
      console.error('Error extracting:', error)
    } finally {
      setExtracting(false)
    }
  }

  const pendingCount = videos.filter(v => v.status === 'pending').length
  const reviewCount = videos.filter(v => v.status === 'review').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Film className="h-6 w-6" />
            Analogy Machine
          </h1>
          <p className="text-muted-foreground mt-1">
            TikTok-Videos aus Synthszr-Take-Analogien
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={processNext}
            disabled={processing || pendingCount === 0}
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generieren ({pendingCount})
          </Button>
        </div>
      </div>

      {/* Extract Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Analogien extrahieren</CardTitle>
          <CardDescription>Post auswählen um Analogien per Claude zu extrahieren</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Select value={selectedPostId} onValueChange={setSelectedPostId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Post auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {recentPosts.map((post) => (
                  <SelectItem key={post.id} value={post.id}>
                    {post.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={extractFromPost} disabled={extracting || !selectedPostId}>
              {extracting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Extrahieren
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="review">Review ({reviewCount})</SelectItem>
            <SelectItem value="published">Publiziert</SelectItem>
            <SelectItem value="failed">Fehler</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {videos.length} Video{videos.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : videos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Keine Videos gefunden. Extrahiere Analogien aus einem Post.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <Card key={video.id} className="overflow-hidden">
              {/* Image Preview */}
              <div
                className="aspect-video bg-muted relative cursor-pointer"
                onClick={() => setPreviewVideo(video)}
              >
                {video.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.image_url}
                    alt={video.analogy_text.slice(0, 60)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                  </div>
                )}
                {video.image_fallback && (
                  <Badge variant="outline" className="absolute top-2 left-2 bg-background/80 text-xs">
                    Fallback
                  </Badge>
                )}
                {video.status === 'review' && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Play className="h-12 w-12 text-white" />
                  </div>
                )}
                {(video.status === 'generating_image' || video.status === 'generating_audio' || video.status === 'compositing') && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-white animate-spin" />
                  </div>
                )}
              </div>

              <CardContent className="p-4 space-y-3">
                {/* Status + Post */}
                <div className="flex items-center justify-between">
                  <Badge variant={STATUS_CONFIG[video.status]?.variant || 'secondary'}>
                    {STATUS_CONFIG[video.status]?.label || video.status}
                  </Badge>
                  {video.audio_duration_seconds && (
                    <span className="text-xs text-muted-foreground">
                      {video.audio_duration_seconds.toFixed(1)}s
                    </span>
                  )}
                </div>

                {/* Analogy Text */}
                <p className="text-sm font-medium line-clamp-3">
                  &ldquo;{video.analogy_text}&rdquo;
                </p>

                {video.context_text && (
                  <p className="text-xs text-muted-foreground">
                    {video.context_text}
                  </p>
                )}

                {video.error_message && (
                  <p className="text-xs text-destructive line-clamp-2">
                    {video.error_message}
                  </p>
                )}

                {/* Post Title */}
                {video.generated_posts && (
                  <p className="text-xs text-muted-foreground truncate">
                    aus: {video.generated_posts.title}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 pt-1">
                  {video.status === 'review' && (
                    <>
                      <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => updateStatus(video.id, 'published')}>
                        <Check className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(video.id, 'pending')}>
                        <RotateCcw className="h-3 w-3 mr-1" /> Neu
                      </Button>
                    </>
                  )}
                  {video.status === 'pending' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => processSpecific(video.id)} disabled={processing}>
                      {processing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                      Generieren
                    </Button>
                  )}
                  {video.status === 'failed' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(video.id, 'pending')}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Retry
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => setDeleteVideo(video)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewVideo} onOpenChange={() => setPreviewVideo(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Analogy Preview</DialogTitle>
            <DialogDescription>
              {previewVideo?.generated_posts?.title}
            </DialogDescription>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-4">
              {/* Image */}
              {previewVideo.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewVideo.image_url}
                  alt="Analogy"
                  className="w-full rounded-lg"
                />
              )}

              {/* Text */}
              <div className="space-y-2">
                <p className="text-lg font-semibold">&ldquo;{previewVideo.analogy_text}&rdquo;</p>
                {previewVideo.context_text && (
                  <p className="text-sm text-muted-foreground">{previewVideo.context_text}</p>
                )}
              </div>

              {/* Audio Player */}
              {previewVideo.audio_url && (
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <audio controls src={previewVideo.audio_url} className="w-full h-8" />
                </div>
              )}

              {/* Image Prompt */}
              {previewVideo.image_prompt && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Image Prompt</summary>
                  <pre className="mt-2 whitespace-pre-wrap bg-muted p-2 rounded text-xs">
                    {previewVideo.image_prompt}
                  </pre>
                </details>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                {previewVideo.status === 'review' && (
                  <>
                    <Button onClick={() => updateStatus(previewVideo.id, 'published')}>
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button variant="outline" onClick={() => { updateStatus(previewVideo.id, 'pending'); }}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Regenerate
                    </Button>
                    <Button variant="destructive" onClick={() => { setPreviewVideo(null); setDeleteVideo(previewVideo); }}>
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteVideo} onOpenChange={() => setDeleteVideo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Video löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteVideo?.analogy_text.slice(0, 80)}...&rdquo;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteVideo && handleDelete(deleteVideo.id)}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
