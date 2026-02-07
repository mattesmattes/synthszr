'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Play, Pause, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  postId: string
  locale?: 'de' | 'en' // Kept for API compatibility, but always uses EN internally
  className?: string
}

export function AudioPlayer({ postId, className }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'disabled'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoplayTriggered, setAutoplayTriggered] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const searchParams = useSearchParams()
  const shouldAutoplay = searchParams.get('autoplay') === 'true'

  // Fetch podcast audio status on mount (always EN)
  useEffect(() => {
    const fetchAudioStatus = async () => {
      try {
        // Use podcast endpoint - always EN for now
        const response = await fetch(`/api/podcast/${postId}?locale=en`)
        const data = await response.json()

        // Podcast endpoint returns { exists, audioUrl, status }
        console.log('[AudioPlayer] Podcast API response:', data)
        if (data.exists && data.audioUrl) {
          console.log('[AudioPlayer] Setting audio URL:', data.audioUrl)
          setAudioUrl(data.audioUrl)
          setStatus('ready')
        } else if (data.status === 'generating') {
          // Podcast is being generated, poll for completion
          setStatus('loading')
          pollForPodcast()
        } else {
          setStatus('idle')
        }
      } catch (err) {
        console.error('[AudioPlayer] Failed to fetch podcast status:', err)
        setStatus('idle')
      }
    }

    // Poll for podcast completion when generating
    const pollForPodcast = async () => {
      const maxAttempts = 60 // 5 minutes max (5s intervals)
      let attempts = 0

      const poll = async () => {
        attempts++
        try {
          const response = await fetch(`/api/podcast/${postId}?locale=en`)
          const data = await response.json()

          if (data.exists && data.audioUrl) {
            setAudioUrl(data.audioUrl)
            setStatus('ready')
            return
          }

          if (data.status === 'generating' && attempts < maxAttempts) {
            setTimeout(poll, 5000) // Poll every 5 seconds
          } else if (data.status === 'failed') {
            setStatus('error')
          }
        } catch {
          if (attempts < maxAttempts) {
            setTimeout(poll, 5000)
          } else {
            setStatus('error')
          }
        }
      }

      poll()
    }

    fetchAudioStatus()
  }, [postId])

  // Track if we should autoplay when audio becomes available
  const pendingAutoplayRef = useRef(false)

  // Handle autoplay from URL parameter (e.g., from newsletter link)
  useEffect(() => {
    if (!shouldAutoplay || autoplayTriggered) return

    // If audio is ready, mark for autoplay (will be triggered by onCanPlay)
    if (status === 'ready' && audioUrl) {
      setAutoplayTriggered(true)
      pendingAutoplayRef.current = true
      // Also try immediate play in case audio is already loaded
      audioRef.current?.play().catch(() => {
        // Will be retried in onCanPlay
      })
    }
    // If no audio yet and autoplay was requested, just mark as triggered (no auto-generation)
    else if (status === 'idle' && !audioUrl) {
      setAutoplayTriggered(true)
      // Don't trigger generation - podcast should be pre-generated in admin
      console.log('[AudioPlayer] Autoplay requested but no podcast available')
    }
  }, [shouldAutoplay, autoplayTriggered, status, audioUrl])

  // Called when audio is ready to play
  const handleCanPlay = useCallback(() => {
    if (pendingAutoplayRef.current) {
      pendingAutoplayRef.current = false
      audioRef.current?.play().catch((err) => {
        console.log('[AudioPlayer] Autoplay blocked by browser:', err)
      })
    }
  }, [])

  // Handle play/pause
  const togglePlayback = useCallback(async () => {
    if (status === 'disabled') return

    // If no audio URL yet, just show idle state - podcast should be generated in admin
    if (!audioUrl && status === 'idle') {
      console.log('[AudioPlayer] No podcast available for this post')
      // Don't auto-generate - podcasts should be pre-generated in admin
      return
    }

    // If generating, just wait
    if (status === 'loading') {
      console.log('[AudioPlayer] Podcast is still generating, please wait...')
      return
    }

    // Toggle playback
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        console.log('[AudioPlayer] Playing audio:', audioUrl, 'readyState:', audioRef.current.readyState)
        audioRef.current.play().catch(err => {
          console.error('[AudioPlayer] Play failed:', err)
        })
      }
    } else {
      console.warn('[AudioPlayer] audioRef.current is null, audioUrl:', audioUrl)
    }
  }, [audioUrl, status, isPlaying])

  // Audio event handlers
  const handlePlay = useCallback(() => setIsPlaying(true), [])
  const handlePause = useCallback(() => setIsPlaying(false), [])
  const handleEnded = useCallback(() => setIsPlaying(false), [])
  const handleError = useCallback((e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    const audio = e.currentTarget
    console.error('[AudioPlayer] Audio error:', {
      src: audio.src,
      error: audio.error?.message,
      code: audio.error?.code,
      networkState: audio.networkState,
      readyState: audio.readyState,
    })
    setStatus('error')
  }, [])

  // Don't render if TTS is disabled or no podcast available
  if (status === 'disabled' || status === 'idle') {
    return null
  }

  return (
    <>
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onCanPlay={handleCanPlay}
          onError={handleError}
          preload="auto"
        />
      )}

      {/* Play/Pause icon button - white circle with dark icon */}
      <button
        onClick={togglePlayback}
        disabled={status === 'loading'}
        className={cn(
          'flex items-center justify-center w-12 h-12 rounded-full bg-white/90 hover:bg-white transition-all shadow-lg disabled:opacity-50',
          className
        )}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {status === 'loading' ? (
          <Loader2 className="h-6 w-6 animate-spin text-black" />
        ) : isPlaying ? (
          <Pause className="h-6 w-6 text-black fill-black" />
        ) : (
          <Play className="h-6 w-6 text-black fill-black ml-0.5" />
        )}
      </button>
    </>
  )
}
