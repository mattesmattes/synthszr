'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, Pause, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PodcastPlayerProps {
  postId: string
  locale?: string
  className?: string
}

export function PodcastPlayer({ postId, locale = 'de', className }: PodcastPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'generating' | 'ready' | 'error'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Check if podcast exists on mount
  useEffect(() => {
    const checkPodcastStatus = async () => {
      try {
        const response = await fetch(`/api/podcast/${postId}?locale=${locale}`)
        const data = await response.json()

        if (data.exists && data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
        } else if (data.status === 'generating') {
          setStatus('generating')
          startPolling()
        } else {
          setStatus('idle')
        }
      } catch (err) {
        console.error('[PodcastPlayer] Failed to check status:', err)
        setStatus('idle')
      }
    }

    checkPodcastStatus()

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [postId, locale])

  // Poll for completion when generating
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/podcast/${postId}?locale=${locale}`)
        const data = await response.json()

        if (data.exists && data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
        } else if (data.status === 'failed') {
          setStatus('error')
          setErrorMessage('Podcast-Generierung fehlgeschlagen')
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
        }
      } catch {
        // Continue polling
      }
    }, 5000) // Poll every 5 seconds
  }, [postId, locale])

  // Handle click - generate or toggle playback
  const handleClick = useCallback(async () => {
    // If already ready, toggle playback
    if (status === 'ready' && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      return
    }

    // If idle, start generation
    if (status === 'idle') {
      setStatus('generating')
      setErrorMessage(null)

      try {
        const response = await fetch(`/api/podcast/${postId}?locale=${locale}&generate=true`)
        const data = await response.json()

        if (data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setStatus('ready')
          // Auto-play after generation
          setTimeout(() => {
            audioRef.current?.play()
          }, 100)
        } else if (data.status === 'generating') {
          startPolling()
        } else {
          throw new Error(data.error || 'Generation failed')
        }
      } catch (err) {
        console.error('[PodcastPlayer] Generation error:', err)
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'Unbekannter Fehler')
      }
    }
  }, [status, isPlaying, postId, locale, startPolling])

  // Audio event handlers
  const handlePlay = useCallback(() => setIsPlaying(true), [])
  const handlePause = useCallback(() => setIsPlaying(false), [])
  const handleEnded = useCallback(() => setIsPlaying(false), [])

  // Don't render if error
  if (status === 'error') {
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
          preload="auto"
        />
      )}

      {/* Podcast icon button - styled differently from TTS player */}
      <button
        onClick={handleClick}
        disabled={status === 'loading' || status === 'generating'}
        className={cn(
          'flex items-center justify-center w-12 h-12 rounded-full transition-all shadow-lg disabled:opacity-70',
          status === 'generating'
            ? 'bg-purple-500/90 hover:bg-purple-500'
            : 'bg-purple-600/90 hover:bg-purple-600',
          className
        )}
        aria-label={isPlaying ? 'Pause Podcast' : 'Play Podcast'}
        title={status === 'idle' ? 'Podcast generieren' : status === 'generating' ? 'Wird generiert...' : 'Podcast abspielen'}
      >
        {status === 'loading' || status === 'generating' ? (
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        ) : isPlaying ? (
          <Pause className="h-6 w-6 text-white fill-white" />
        ) : (
          <Mic className="h-6 w-6 text-white" />
        )}
      </button>
    </>
  )
}
