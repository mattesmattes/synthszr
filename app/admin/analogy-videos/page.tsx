'use client'

import { useEffect, useState } from 'react'
import { Film, Loader2, Play, Trash2, RotateCcw, Check, X, ImageIcon, Volume2, Sparkles, Terminal, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

// --- Types ---

interface AnalogyVideo {
  id: string
  post_id: string
  video_type?: string
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
  script_data: MachineScript | null
  error_message: string | null
  attempts: number
  created_at: string
  updated_at: string
  generated_posts?: { title: string; slug: string }
}

interface MachineStep {
  type: 'stream_in' | 'highlight' | 'extract_number' | 'strike' | 'build_take' | 'pause'
  text: string
  color?: string
  delay_ms?: number
}

interface MachineScript {
  title: string
  sourceText: string
  steps: MachineStep[]
  take: string
  estimatedDuration: number
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  generating_image: { label: 'Image...', variant: 'outline' },
  generating_audio: { label: 'Audio...', variant: 'outline' },
  compositing: { label: 'Compositing...', variant: 'outline' },
  review: { label: 'Review', variant: 'default' },
  published: { label: 'Published', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
}

const STEP_COLORS: Record<string, string> = {
  green: 'text-green-400',
  cyan: 'text-cyan-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
}

// --- Main Component ---

export default function AnalogyVideosPage() {
  const [activeTab, setActiveTab] = useState('analogy')
  const [videos, setVideos] = useState<AnalogyVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [processing, setProcessing] = useState(false)
  const [previewVideo, setPreviewVideo] = useState<AnalogyVideo | null>(null)
  const [deleteVideo, setDeleteVideo] = useState<AnalogyVideo | null>(null)
  const [recentPosts, setRecentPosts] = useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [selectedPostId, setSelectedPostId] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchVideos()
  }, [statusFilter, activeTab])

  useEffect(() => {
    fetchRecentPosts()
  }, [])

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
      params.set('videoType', activeTab)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/admin/analogy-videos?${params}`, { credentials: 'include' })
      if (res.ok) {
        setVideos(await res.json())
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMessage(`Loading failed: ${data.error || res.statusText}`)
      }
    } catch (error) {
      console.error('Error fetching videos:', error)
      setErrorMessage(`Network error: ${error instanceof Error ? error.message : 'Unknown'}`)
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
    setErrorMessage(null)
    try {
      const res = await fetch('/api/admin/analogy-videos/extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: selectedPostId, videoType: activeTab }),
      })
      const data = await res.json()
      if (data.error) {
        setErrorMessage(`Extraction failed: ${data.error}`)
      } else if (data.extracted === 0) {
        setErrorMessage(data.message || 'No analogies/scripts found')
      } else {
        await fetchVideos()
      }
    } catch (error) {
      console.error('Error extracting:', error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown'}`)
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
            Video Factory
          </h1>
          <p className="text-muted-foreground mt-1">
            Short-form videos from Synthszr content
          </p>
        </div>
        {activeTab === 'analogy' && (
          <Button
            variant="outline"
            size="sm"
            onClick={processNext}
            disabled={processing || pendingCount === 0}
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generate ({pendingCount})
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="analogy" className="gap-1.5">
            <ImageIcon className="h-4 w-4" />
            Analogy Machine
          </TabsTrigger>
          <TabsTrigger value="machine" className="gap-1.5">
            <Terminal className="h-4 w-4" />
            The Machine
          </TabsTrigger>
        </TabsList>

        {/* Shared Extract Section */}
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {activeTab === 'analogy' ? 'Extract Analogies' : 'Generate Processing Script'}
            </CardTitle>
            <CardDescription>
              {activeTab === 'analogy'
                ? 'Select a post to extract analogies with Greek mythology visuals via Claude'
                : 'Select a post to generate terminal processing scripts via Claude'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Select value={selectedPostId} onValueChange={setSelectedPostId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select post..." />
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
                {activeTab === 'analogy' ? 'Extract' : 'Generate'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Error Message */}
        {errorMessage && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {/* Filter */}
        <div className="flex items-center gap-4 mt-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="review">Review ({reviewCount})</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {videos.length} Video{videos.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* === Analogy Machine Tab === */}
        <TabsContent value="analogy" className="mt-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No analogy videos found. Extract analogies from a post to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.map((video) => (
                <Card key={video.id} className="overflow-hidden">
                  <div
                    className="aspect-[9/16] bg-muted relative cursor-pointer max-h-[300px]"
                    onClick={() => setPreviewVideo(video)}
                  >
                    {video.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
                      </div>
                    )}
                    {video.image_fallback && (
                      <Badge variant="outline" className="absolute top-2 left-2 bg-background/80 text-xs">Fallback</Badge>
                    )}
                    {(video.status === 'generating_image' || video.status === 'generating_audio' || video.status === 'compositing') && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-white animate-spin" />
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant={STATUS_CONFIG[video.status]?.variant || 'secondary'}>
                        {STATUS_CONFIG[video.status]?.label || video.status}
                      </Badge>
                      {video.audio_duration_seconds && (
                        <span className="text-xs text-muted-foreground">{video.audio_duration_seconds.toFixed(1)}s</span>
                      )}
                    </div>
                    <p className="text-sm font-medium line-clamp-3">&ldquo;{video.analogy_text}&rdquo;</p>
                    {video.context_text && <p className="text-xs text-muted-foreground">{video.context_text}</p>}
                    {/* Audio Player */}
                    {video.audio_url && (
                      <div className="flex items-center gap-2">
                        <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <audio controls src={video.audio_url} className="w-full h-7" />
                      </div>
                    )}
                    {video.error_message && <p className="text-xs text-destructive line-clamp-2">{video.error_message}</p>}
                    {video.generated_posts && (
                      <p className="text-xs text-muted-foreground truncate">from: {video.generated_posts.title}</p>
                    )}
                    <VideoActions video={video} processing={processing} onProcess={processSpecific} onUpdateStatus={updateStatus} onDelete={setDeleteVideo} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* === The Machine Tab === */}
        <TabsContent value="machine" className="mt-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No machine scripts found. Generate scripts from a post to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {videos.map((video) => (
                <Card key={video.id} className="overflow-hidden">
                  {/* Terminal Preview */}
                  <div
                    className="bg-black p-4 cursor-pointer min-h-[200px] font-mono text-xs"
                    onClick={() => setPreviewVideo(video)}
                  >
                    <div className="flex items-center gap-2 mb-3 text-green-500 text-[10px]">
                      <span className="opacity-60">$</span>
                      <span>synthszr --process</span>
                      <span className="animate-pulse">_</span>
                    </div>
                    {video.script_data ? (
                      <MachineScriptPreview script={video.script_data} />
                    ) : (
                      <p className="text-gray-500 text-xs">{video.analogy_text}</p>
                    )}
                  </div>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant={STATUS_CONFIG[video.status]?.variant || 'secondary'}>
                        {STATUS_CONFIG[video.status]?.label || video.status}
                      </Badge>
                      {video.script_data?.estimatedDuration && (
                        <span className="text-xs text-muted-foreground">~{video.script_data.estimatedDuration}s</span>
                      )}
                    </div>
                    <p className="text-sm font-medium line-clamp-2">{video.analogy_text}</p>
                    {video.generated_posts && (
                      <p className="text-xs text-muted-foreground truncate">from: {video.generated_posts.title}</p>
                    )}
                    <VideoActions video={video} processing={processing} onProcess={processSpecific} onUpdateStatus={updateStatus} onDelete={setDeleteVideo} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={!!previewVideo} onOpenChange={() => setPreviewVideo(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {previewVideo?.video_type === 'machine' ? 'Machine Preview' : 'Analogy Preview'}
            </DialogTitle>
            <DialogDescription>{previewVideo?.generated_posts?.title}</DialogDescription>
          </DialogHeader>
          {previewVideo && (
            <div className="space-y-4">
              {/* Analogy: Image + Audio */}
              {previewVideo.video_type !== 'machine' && (
                <>
                  {previewVideo.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewVideo.image_url} alt="Analogy" className="w-full rounded-lg" />
                  )}
                  <div className="space-y-2">
                    <p className="text-lg font-semibold">&ldquo;{previewVideo.analogy_text}&rdquo;</p>
                    {previewVideo.context_text && <p className="text-sm text-muted-foreground">{previewVideo.context_text}</p>}
                  </div>
                  {previewVideo.audio_url && (
                    <div className="flex items-center gap-2">
                      <Volume2 className="h-4 w-4 text-muted-foreground" />
                      <audio controls src={previewVideo.audio_url} className="w-full h-8" />
                    </div>
                  )}
                  {previewVideo.image_prompt && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Image Prompt</summary>
                      <pre className="mt-2 whitespace-pre-wrap bg-muted p-2 rounded text-xs">{previewVideo.image_prompt}</pre>
                    </details>
                  )}
                </>
              )}

              {/* Machine: Full terminal preview */}
              {previewVideo.video_type === 'machine' && previewVideo.script_data && (
                <div className="bg-black rounded-lg p-6 font-mono text-sm space-y-4 max-h-[500px] overflow-y-auto">
                  <div className="text-green-500 text-xs flex items-center gap-2">
                    <span className="opacity-60">$</span>
                    <span>synthszr --process --verbose</span>
                  </div>
                  <div className="border-t border-gray-800 pt-3">
                    <p className="text-gray-400 text-xs mb-2">INPUT:</p>
                    <p className="text-gray-300 text-xs leading-relaxed">{previewVideo.script_data.sourceText}</p>
                  </div>
                  <div className="border-t border-gray-800 pt-3">
                    <p className="text-gray-400 text-xs mb-2">PROCESSING ({previewVideo.script_data.steps.length} steps):</p>
                    {previewVideo.script_data.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-0.5">
                        <span className="text-gray-600 w-16 shrink-0">{step.type}</span>
                        <span className={
                          step.type === 'highlight' ? (STEP_COLORS[step.color || ''] || 'text-cyan-400') :
                          step.type === 'strike' ? 'text-gray-600 line-through' :
                          step.type === 'extract_number' ? 'text-yellow-400 font-bold' :
                          step.type === 'build_take' ? 'text-green-400' :
                          'text-gray-400'
                        }>
                          {step.text || '...'}
                        </span>
                        <span className="text-gray-700 ml-auto shrink-0">{step.delay_ms}ms</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-green-900 pt-3">
                    <p className="text-green-500 text-xs mb-1">OUTPUT:</p>
                    <p className="text-green-400 text-sm font-bold">{previewVideo.script_data.take}</p>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                {previewVideo.status === 'review' && (
                  <>
                    <Button onClick={() => updateStatus(previewVideo.id, 'published')}>
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button variant="outline" onClick={() => updateStatus(previewVideo.id, 'pending')}>
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
            <AlertDialogTitle>Delete video?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteVideo?.analogy_text.slice(0, 80)}...&rdquo;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteVideo && handleDelete(deleteVideo.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// --- Subcomponents ---

function VideoActions({ video, processing, onProcess, onUpdateStatus, onDelete }: {
  video: AnalogyVideo
  processing: boolean
  onProcess: (id: string) => void
  onUpdateStatus: (id: string, status: string) => void
  onDelete: (video: AnalogyVideo) => void
}) {
  return (
    <div className="flex items-center gap-1 pt-1">
      {video.status === 'review' && (
        <>
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => onUpdateStatus(video.id, 'published')}>
            <Check className="h-3 w-3 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onUpdateStatus(video.id, 'pending')}>
            <RotateCcw className="h-3 w-3 mr-1" /> Redo
          </Button>
        </>
      )}
      {video.status === 'pending' && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onProcess(video.id)} disabled={processing}>
          {processing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
          Generate
        </Button>
      )}
      {video.status === 'failed' && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onUpdateStatus(video.id, 'pending')}>
          <RotateCcw className="h-3 w-3 mr-1" /> Retry
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" onClick={() => onDelete(video)}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  )
}

function MachineScriptPreview({ script }: { script: MachineScript }) {
  const highlights = script.steps.filter(s => s.type === 'highlight').slice(0, 3)
  const strikes = script.steps.filter(s => s.type === 'strike').slice(0, 2)
  const takeLines = script.steps.filter(s => s.type === 'build_take')

  return (
    <div className="space-y-2 text-[11px]">
      {/* Source text snippet */}
      <p className="text-gray-500 leading-relaxed line-clamp-2">{script.sourceText.slice(0, 120)}...</p>
      {/* Highlights */}
      {highlights.map((h, i) => (
        <span key={i} className={`${STEP_COLORS[h.color || ''] || 'text-cyan-400'} mr-2`}>[{h.text}]</span>
      ))}
      {/* Strikes */}
      {strikes.length > 0 && (
        <p className="text-gray-600 line-through">{strikes.map(s => s.text).join(' | ')}</p>
      )}
      {/* Take */}
      <div className="border-t border-gray-800 pt-2 mt-2">
        {takeLines.map((line, i) => (
          <p key={i} className="text-green-400">{line.text}</p>
        ))}
      </div>
    </div>
  )
}
