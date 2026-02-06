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
        if (data.exists && data.audioUrl) {
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
    // If no audio yet, trigger generation (always use EN for podcast)
    else if (status === 'idle' && !audioUrl) {
      setAutoplayTriggered(true)
      pendingAutoplayRef.current = true
      setStatus('loading')

      // Trigger podcast generation - always use EN
      fetch(`/api/podcast/${postId}?locale=en&generate=true`)
        .then(res => res.json())
        .then(data => {
          if (data.audioUrl) {
            setAudioUrl(data.audioUrl)
            setStatus('ready')
          } else if (data.status === 'generating') {
            // Poll for completion
            pollForCompletion()
          } else {
            setStatus('error')
            pendingAutoplayRef.current = false
          }
        })
        .catch(err => {
          console.error('[AudioPlayer] Podcast generation error:', err)
          setStatus('error')
          pendingAutoplayRef.current = false
        })
    }

    // Helper to poll for podcast completion
    function pollForCompletion() {
      const poll = async () => {
        try {
          const res = await fetch(`/api/podcast/${postId}?locale=en`)
          const data = await res.json()

          if (data.exists && data.audioUrl) {
            setAudioUrl(data.audioUrl)
            setStatus('ready')
          } else if (data.status === 'generating') {
            setTimeout(poll, 5000)
          } else {
            setStatus('error')
            pendingAutoplayRef.current = false
          }
        } catch {
          setStatus('error')
          pendingAutoplayRef.current = false
        }
      }
      poll()
    }
  }, [shouldAutoplay, autoplayTriggered, status, audioUrl, postId])

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

    // If no audio URL yet, trigger podcast generation (always EN)
    if (!audioUrl && status !== 'loading') {
      setStatus('loading')

      try {
        // Trigger podcast generation - always use EN
        const response = await fetch(`/api/podcast/${postId}?locale=en&generate=true`)
        const data = await response.json()

        if (!response.ok && data.status !== 'generating') {
          throw new Error(data.error || 'Failed to generate podcast')
        }

        if (data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
          // Auto-play after generation
          setTimeout(() => {
            audioRef.current?.play()
          }, 100)
        } else if (data.status === 'generating') {
          // Poll for completion
          const poll = async () => {
            const res = await fetch(`/api/podcast/${postId}?locale=en`)
            const pollData = await res.json()

            if (pollData.exists && pollData.audioUrl) {
              setAudioUrl(pollData.audioUrl)
              setStatus('ready')
              // Auto-play when ready
              setTimeout(() => {
                audioRef.current?.play()
              }, 100)
            } else if (pollData.status === 'generating') {
              setTimeout(poll, 5000)
            } else if (pollData.status === 'failed') {
              setStatus('error')
            }
          }
          poll()
        } else {
          throw new Error('No audio URL returned')
        }
      } catch (err) {
        console.error('[AudioPlayer] Podcast generation error:', err)
        setStatus('error')
      }
      return
    }

    // Toggle playback
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
    }
  }, [audioUrl, status, postId, isPlaying])

  // Audio event handlers
  const handlePlay = useCallback(() => setIsPlaying(true), [])
  const handlePause = useCallback(() => setIsPlaying(false), [])
  const handleEnded = useCallback(() => setIsPlaying(false), [])

  // Don't render if TTS is disabled
  if (status === 'disabled') {
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
