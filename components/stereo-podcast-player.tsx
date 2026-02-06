'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Play, Pause, Download, Loader2, Volume2 } from 'lucide-react'
import {
  mixToStereo,
  audioBufferToWav,
  downloadWav,
  type SegmentMetadata,
} from '@/lib/audio/stereo-mixer'

interface StereoPodcastPlayerProps {
  segmentUrls: string[]
  segmentMetadata: SegmentMetadata[]
  title?: string
}

export function StereoPodcastPlayer({
  segmentUrls,
  segmentMetadata,
  title = 'podcast',
}: StereoPodcastPlayerProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const startTimeRef = useRef<number>(0)
  const animationFrameRef = useRef<number | null>(null)

  const loadAndMix = useCallback(async () => {
    if (audioBufferRef.current) return audioBufferRef.current

    setIsLoading(true)
    setError(null)

    try {
      const result = await mixToStereo({
        segmentUrls,
        segmentMetadata,
      })

      audioBufferRef.current = result.audioBuffer
      setDuration(result.duration)

      return result.audioBuffer
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load audio'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [segmentUrls, segmentMetadata])

  const updateProgress = useCallback(() => {
    if (!audioContextRef.current || !isPlaying) return

    const elapsed = audioContextRef.current.currentTime - startTimeRef.current
    const percent = Math.min((elapsed / duration) * 100, 100)
    setProgress(percent)

    if (percent < 100) {
      animationFrameRef.current = requestAnimationFrame(updateProgress)
    } else {
      setIsPlaying(false)
    }
  }, [duration, isPlaying])

  const play = useCallback(async () => {
    try {
      const buffer = await loadAndMix()

      // Create new audio context if needed
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext()
      }

      // Resume audio context if suspended (browser autoplay policy)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume()
      }

      // Stop any existing playback
      if (sourceRef.current) {
        try {
          sourceRef.current.stop()
        } catch {
          // Ignore if already stopped
        }
      }

      // Create and start new source
      const source = audioContextRef.current.createBufferSource()
      source.buffer = buffer
      source.connect(audioContextRef.current.destination)

      source.onended = () => {
        setIsPlaying(false)
        setProgress(100)
      }

      startTimeRef.current = audioContextRef.current.currentTime
      source.start(0)
      sourceRef.current = source
      setIsPlaying(true)

      // Start progress animation
      animationFrameRef.current = requestAnimationFrame(updateProgress)
    } catch (err) {
      console.error('[StereoPodcastPlayer] Playback error:', err)
      setError(err instanceof Error ? err.message : 'Playback failed')
    }
  }, [loadAndMix, updateProgress])

  const pause = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.stop()
      sourceRef.current = null
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    setIsPlaying(false)
  }, [])

  const handleDownload = useCallback(async () => {
    try {
      setIsLoading(true)
      const buffer = await loadAndMix()
      const blob = audioBufferToWav(buffer)
      downloadWav(blob, `${title}-stereo.wav`)
    } catch (err) {
      console.error('Download error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [loadAndMix, title])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Volume2 className="h-4 w-4" />
        <span>Stereo Podcast (HOST links, GUEST rechts)</span>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
          {error}
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={isPlaying ? pause : play}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <div className="flex-1 space-y-1">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatTime((progress / 100) * duration)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={handleDownload}
          disabled={isLoading}
          title="Download as WAV"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {segmentMetadata.length} Segmente | {segmentMetadata.filter(s => s.speaker === 'HOST').length} HOST | {segmentMetadata.filter(s => s.speaker === 'GUEST').length} GUEST
      </div>
    </div>
  )
}
