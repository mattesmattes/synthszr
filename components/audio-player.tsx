'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, Loader2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
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
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

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
          setDuration(data.duration || 0)
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
      setError(null)

      try {
        const response = await fetch(`/api/tts/${postId}?locale=${locale}&generate=true`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to generate audio')
        }

        if (data.audioUrl) {
          setAudioUrl(data.audioUrl)
          setDuration(data.duration || 0)
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
        setError(err instanceof Error ? err.message : 'Generation failed')
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
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }, [])

  const handlePlay = useCallback(() => setIsPlaying(true), [])
  const handlePause = useCallback(() => setIsPlaying(false), [])
  const handleEnded = useCallback(() => {
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])

  // Handle slider change
  const handleSeek = useCallback((value: number[]) => {
    if (audioRef.current && value[0] !== undefined) {
      audioRef.current.currentTime = value[0]
      setCurrentTime(value[0])
    }
  }, [])

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Don't render if TTS is disabled
  if (status === 'disabled') {
    return null
  }

  return (
    <div className={cn('flex items-center gap-3 p-3 bg-muted/50 rounded-lg', className)}>
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          preload="metadata"
        />
      )}

      {/* Play/Pause button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlayback}
        disabled={status === 'loading'}
        className="shrink-0"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {status === 'loading' ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isPlaying ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </Button>

      {/* Progress slider and time */}
      <div className="flex-1 flex items-center gap-2">
        {status === 'ready' && audioUrl ? (
          <>
            <span className="text-xs text-muted-foreground w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <Slider
              value={[currentTime]}
              min={0}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="flex-1"
              aria-label="Audio progress"
            />
            <span className="text-xs text-muted-foreground w-10">
              {formatTime(duration)}
            </span>
          </>
        ) : status === 'loading' ? (
          <span className="text-sm text-muted-foreground">Generating audio...</span>
        ) : status === 'error' ? (
          <span className="text-sm text-destructive">{error || 'Error'}</span>
        ) : (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Volume2 className="h-4 w-4" />
            Listen to article
          </span>
        )}
      </div>
    </div>
  )
}
