'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import { Play, Pause, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  postId: string
  locale?: 'de' | 'en' // Kept for API compatibility, but always uses EN internally
  className?: string
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AudioPlayer({ postId, className }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'disabled'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoplayTriggered, setAutoplayTriggered] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [coverVisible, setCoverVisible] = useState(true)
  const [showFlyingNav, setShowFlyingNav] = useState(false)
  const [mounted, setMounted] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const coverButtonRef = useRef<HTMLButtonElement | null>(null)
  const searchParams = useSearchParams()
  const shouldAutoplay = searchParams.get('autoplay') === 'true'

  // Mount guard for createPortal
  useEffect(() => setMounted(true), [])

  // IntersectionObserver to track cover button visibility
  useEffect(() => {
    const button = coverButtonRef.current
    if (!button) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setCoverVisible(entry.isIntersecting)
      },
      { threshold: 0 }
    )

    observer.observe(button)
    return () => observer.disconnect()
  }, [status])

  // Show flying nav whenever cover button scrolls out of view
  useEffect(() => {
    setShowFlyingNav(!coverVisible)
  }, [coverVisible])

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
  const handleEnded = useCallback(() => {
    setIsPlaying(false)
    setCurrentTime(0)
  }, [])
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

  // Seek on progress bar click
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = Math.max(0, Math.min(1, x / rect.width))
    audioRef.current.currentTime = ratio * duration
  }, [duration])

  // Close flying nav and stop playback
  const handleClose = useCallback(() => {
    audioRef.current?.pause()
    setShowFlyingNav(false)
  }, [])

  // Don't render if TTS is disabled or no podcast available
  if (status === 'disabled' || status === 'idle') {
    return null
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

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
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          preload="auto"
        />
      )}

      {/* Cover play/pause button */}
      <button
        ref={coverButtonRef}
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

      {/* Flying Navigation — liquid glass mini player */}
      {showFlyingNav && mounted && createPortal(
        <div
          className="flying-player-enter fixed top-3 left-0 right-0 flex justify-center z-50 pointer-events-none"
          role="region"
          aria-label="Podcast Player"
        >
          {/* SVG filter for glass refraction distortion */}
          <svg className="absolute w-0 h-0" aria-hidden="true">
            <defs>
              <filter id="glass-refraction" x="-10%" y="-10%" width="120%" height="120%">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.015"
                  numOctaves="3"
                  seed="2"
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale="6"
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
          </svg>

          <div className={cn(
            'relative rounded-full pointer-events-auto overflow-hidden',
            // Outer shell: border + shadow
            'border border-white/50 dark:border-white/15',
            'shadow-[0_4px_24px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)]',
            'dark:shadow-[0_4px_24px_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.2)]',
          )}>
            {/* Layer 1: Backdrop blur — glass base with visible background distortion */}
            <div
              className="absolute -inset-2 rounded-full"
              style={{
                backdropFilter: 'blur(16px) saturate(1.8) brightness(1.05)',
                WebkitBackdropFilter: 'blur(16px) saturate(1.8) brightness(1.05)',
                filter: 'url(#glass-refraction)',
              }}
            />

            {/* Layer 2: Base tint — semi-transparent so distortion is visible */}
            <div className="absolute inset-0 rounded-full bg-white/25 dark:bg-white/10" />

            {/* Layer 3: Edge refraction — light bends stronger at curved glass edges */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: `radial-gradient(ellipse 80% 80% at 50% 50%,
                  transparent 50%,
                  rgba(255,255,255,0.3) 70%,
                  rgba(255,255,255,0.5) 85%,
                  rgba(255,255,255,0.7) 100%
                )`,
              }}
            />

            {/* Layer 4: Caustic highlight — light concentrates at top of curved glass */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: `linear-gradient(180deg,
                  rgba(255,255,255,0.7) 0%,
                  rgba(255,255,255,0.15) 15%,
                  transparent 35%,
                  transparent 75%,
                  rgba(255,255,255,0.1) 100%
                )`,
              }}
            />

            {/* Layer 5: Chromatic aberration — prismatic color split at glass edges */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                boxShadow: `
                  inset 5px 0 14px -2px rgba(0,120,255,0.3),
                  inset -5px 0 14px -2px rgba(255,70,0,0.25),
                  inset 0 3px 10px -2px rgba(255,255,255,0.6),
                  inset 0 -2px 8px -1px rgba(0,0,0,0.08)
                `,
              }}
            />

            {/* Layer 6: Specular highlight — sharp light reflection on glass surface */}
            <div
              className="absolute inset-x-4 top-[1px] h-[1px] rounded-full pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.9) 25%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.9) 75%, transparent 100%)',
              }}
            />

            {/* Content */}
            <div className="relative z-10 flex items-center gap-3 pl-1.5 pr-2 py-1.5">
              {/* Play/Pause */}
              <button
                onClick={togglePlayback}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-black/80 dark:bg-white/90 hover:bg-black dark:hover:bg-white transition-colors shrink-0"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5 text-white dark:text-black fill-white dark:fill-black" />
                ) : (
                  <Play className="h-3.5 w-3.5 text-white dark:text-black fill-white dark:fill-black ml-0.5" />
                )}
              </button>

              {/* Progress bar */}
              <div
                onClick={handleProgressClick}
                className="relative w-28 sm:w-40 h-1 bg-black/10 dark:bg-white/15 rounded-full cursor-pointer group"
              >
                <div
                  className="absolute inset-y-0 left-0 bg-black/60 dark:bg-white/70 rounded-full transition-[width] duration-150 ease-linear"
                  style={{ width: `${progress}%` }}
                />
                {/* Seek knob on hover */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-black dark:bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm pointer-events-none"
                  style={{ left: `calc(${progress}% - 5px)` }}
                />
              </div>

              {/* Time display */}
              <span className="text-[10px] font-mono text-black/50 dark:text-white/50 tabular-nums whitespace-nowrap select-none">
                {formatTime(currentTime)}
                <span className="mx-px opacity-50">/</span>
                {formatTime(duration)}
              </span>

              {/* Close */}
              <button
                onClick={handleClose}
                className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/8 dark:hover:bg-white/10 transition-colors shrink-0"
                aria-label="Close player"
              >
                <X className="h-3 w-3 text-black/40 dark:text-white/40" />
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
