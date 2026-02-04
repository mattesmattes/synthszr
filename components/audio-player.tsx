'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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

  const audioRef = useRef<HTMLAudioElement | null>(null)

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
