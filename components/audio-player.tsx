'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Play, Pause, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  postId: string
  locale?: 'de' | 'en'
  className?: string
}

export function AudioPlayer({ postId, locale = 'de', className }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'disabled'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoplayTriggered, setAutoplayTriggered] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const searchParams = useSearchParams()
  const shouldAutoplay = searchParams.get('autoplay') === 'true'

  // Fetch audio status on mount
  useEffect(() => {
    const fetchAudioStatus = async () => {
      try {
        const response = await fetch(`/api/tts/${postId}?locale=${locale}`)
        const data = await response.json()

        if (data.enabled === false) {
          setStatus('disabled')
          return
        }

        if (data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
        } else {
          setStatus('idle')
        }
      } catch (err) {
        console.error('[AudioPlayer] Failed to fetch audio status:', err)
        setStatus('idle')
      }
    }

    fetchAudioStatus()
  }, [postId, locale])

  // Handle autoplay from URL parameter (e.g., from newsletter link)
  useEffect(() => {
    if (!shouldAutoplay || autoplayTriggered) return

    // If audio is ready, play it
    if (status === 'ready' && audioUrl) {
      setAutoplayTriggered(true)
      // Small delay to ensure audio element is mounted
      setTimeout(() => {
        audioRef.current?.play().catch((err) => {
          // Autoplay might be blocked by browser - that's okay
          console.log('[AudioPlayer] Autoplay blocked by browser:', err)
        })
      }, 500)
    }
    // If no audio yet, trigger generation
    else if (status === 'idle' && !audioUrl) {
      setAutoplayTriggered(true)
      setStatus('loading')

      fetch(`/api/tts/${postId}?locale=${locale}&generate=true`)
        .then(res => res.json())
        .then(data => {
          if (data.audioUrl) {
            setAudioUrl(data.audioUrl)
            setStatus('ready')
            // Auto-play after generation
            setTimeout(() => {
              audioRef.current?.play().catch((err) => {
                console.log('[AudioPlayer] Autoplay blocked by browser:', err)
              })
            }, 500)
          } else {
            setStatus('error')
          }
        })
        .catch(err => {
          console.error('[AudioPlayer] Auto-generation error:', err)
          setStatus('error')
        })
    }
  }, [shouldAutoplay, autoplayTriggered, status, audioUrl, postId, locale])

  // Handle play/pause
  const togglePlayback = useCallback(async () => {
    if (status === 'disabled') return

    // If no audio URL yet, generate it
    if (!audioUrl && status !== 'loading') {
      setStatus('loading')

      try {
        const response = await fetch(`/api/tts/${postId}?locale=${locale}&generate=true`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to generate audio')
        }

        if (data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
          // Auto-play after generation
          setTimeout(() => {
            audioRef.current?.play()
          }, 100)
        } else {
          throw new Error('No audio URL returned')
        }
      } catch (err) {
        console.error('[AudioPlayer] Generation error:', err)
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
  }, [audioUrl, status, postId, locale, isPlaying])

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
          preload="metadata"
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
