'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, ImageIcon, RefreshCw, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PostImage {
  id: string
  post_id: string
  daily_repo_id: string | null
  image_url: string
  source_text: string | null
  is_cover: boolean
  generation_status: 'pending' | 'generating' | 'completed' | 'failed'
  error_message: string | null
  created_at: string
}

interface PostImageGalleryProps {
  postId: string
  onCoverChange?: (imageId: string) => void
}

export function PostImageGallery({ postId, onCoverChange }: PostImageGalleryProps) {
  const [images, setImages] = useState<PostImage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(null)
  const [savingCover, setSavingCover] = useState(false)

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/post-images?postId=${postId}`)
      if (res.ok) {
        const data = await res.json()
        setImages(data.images || [])

        // Set selected cover from existing cover image
        const coverImage = data.images?.find((img: PostImage) => img.is_cover)
        if (coverImage) {
          setSelectedCoverId(coverImage.id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch images:', error)
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    fetchImages()

    // Poll for updates if there are pending/generating images
    const interval = setInterval(() => {
      const hasPending = images.some(
        img => img.generation_status === 'pending' || img.generation_status === 'generating'
      )
      if (hasPending) {
        fetchImages()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [fetchImages, images])

  async function handleSetCover(imageId: string) {
    setSelectedCoverId(imageId)
    setSavingCover(true)

    try {
      const res = await fetch('/api/post-images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, imageId }),
      })

      if (res.ok) {
        fetchImages()
        onCoverChange?.(imageId)
      }
    } catch (error) {
      console.error('Failed to set cover:', error)
    } finally {
      setSavingCover(false)
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!confirm('Bild wirklich löschen?')) return

    try {
      const res = await fetch(`/api/post-images?imageId=${imageId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        fetchImages()
      }
    } catch (error) {
      console.error('Failed to delete image:', error)
    }
  }

  const completedImages = images.filter(img => img.generation_status === 'completed')
  const pendingImages = images.filter(
    img => img.generation_status === 'pending' || img.generation_status === 'generating'
  )
  const failedImages = images.filter(img => img.generation_status === 'failed')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ImageIcon className="h-12 w-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">Keine Bilder generiert</p>
        <p className="text-xs text-muted-foreground mt-1">
          Bilder werden beim Erstellen des Artikels automatisch generiert
        </p>
      </div>
    )
  }

  return (
    <Tabs defaultValue="gallery" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="gallery" className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          Galerie ({completedImages.length})
        </TabsTrigger>
        <TabsTrigger value="status" className="flex items-center gap-2">
          Status
          {pendingImages.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {pendingImages.length} ausstehend
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="gallery" className="mt-4">
        {completedImages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Bilder werden generiert...</p>
          </div>
        ) : (
          <RadioGroup
            value={selectedCoverId || ''}
            onValueChange={handleSetCover}
            className="grid grid-cols-2 md:grid-cols-3 gap-4"
          >
            {completedImages.map((image) => (
              <div key={image.id} className="relative group">
                <Label
                  htmlFor={image.id}
                  className={cn(
                    'block cursor-pointer rounded-lg overflow-hidden border-2 transition-all',
                    selectedCoverId === image.id
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-transparent hover:border-muted-foreground/30'
                  )}
                >
                  <div className="relative aspect-video" style={{ backgroundColor: '#CCFF00' }}>
                    <img
                      src={image.image_url}
                      alt="Generated visualization"
                      className="w-full h-full object-cover"
                      style={{ mixBlendMode: 'multiply' }}
                    />
                    {selectedCoverId === image.id && (
                      <div className="absolute top-2 left-2">
                        <Badge className="bg-primary text-primary-foreground">
                          <Check className="h-3 w-3 mr-1" />
                          Cover
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RadioGroupItem
                      value={image.id}
                      id={image.id}
                      className="sr-only"
                    />
                  </div>
                </Label>

                {/* Delete button */}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.preventDefault()
                    handleDeleteImage(image.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>

                {/* Source text preview */}
                {image.source_text && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                    {image.source_text.slice(0, 100)}...
                  </p>
                )}
              </div>
            ))}
          </RadioGroup>
        )}

        {savingCover && (
          <div className="flex items-center justify-center mt-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Speichere Cover-Auswahl...
          </div>
        )}
      </TabsContent>

      <TabsContent value="status" className="mt-4 space-y-3">
        {pendingImages.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Wird generiert ({pendingImages.length})
            </h4>
            {pendingImages.map((image) => (
              <div key={image.id} className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-muted-foreground line-clamp-2">
                  {image.source_text?.slice(0, 150)}...
                </p>
              </div>
            ))}
          </div>
        )}

        {failedImages.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-destructive">
              Fehlgeschlagen ({failedImages.length})
            </h4>
            {failedImages.map((image) => (
              <div key={image.id} className="p-3 rounded-lg bg-destructive/10 text-sm">
                <p className="text-destructive font-medium">{image.error_message}</p>
                <p className="text-muted-foreground line-clamp-1 mt-1">
                  {image.source_text?.slice(0, 100)}...
                </p>
              </div>
            ))}
          </div>
        )}

        {completedImages.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-green-600 dark:text-green-400">
              Fertig ({completedImages.length})
            </h4>
            <p className="text-sm text-muted-foreground">
              Wähle ein Bild in der Galerie als Cover aus.
            </p>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={fetchImages}
          className="w-full mt-4"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Status aktualisieren
        </Button>
      </TabsContent>
    </Tabs>
  )
}
