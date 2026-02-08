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
  const [flyingNavMilky, setFlyingNavMilky] = useState(false)
  const [mounted, setMounted] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const coverRef = useRef<HTMLDivElement | null>(null)
  const hasTransitionedRef = useRef(false)
  const searchParams = useSearchParams()
  const shouldAutoplay = searchParams.get('autoplay') === 'true'

  // Mount guard for createPortal
  useEffect(() => setMounted(true), [])

  // IntersectionObserver to track cover element visibility
  useEffect(() => {
    const el = coverRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setCoverVisible(entry.isIntersecting)
      },
      { threshold: 0 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [status])

  // Show flying nav whenever cover scrolls out of view
  useEffect(() => {
    setShowFlyingNav(!coverVisible)
  }, [coverVisible])

  // Milky → transparent transition for flying nav (newsletter clickout)
  useEffect(() => {
    if (shouldAutoplay && showFlyingNav && !hasTransitionedRef.current) {
      hasTransitionedRef.current = true
      setFlyingNavMilky(true)
      // Brief pause, then start CSS transition to transparent
      const timer = setTimeout(() => setFlyingNavMilky(false), 600)
      return () => clearTimeout(timer)
    }
  }, [shouldAutoplay, showFlyingNav])

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

    // If audio is ready, attempt playback
    if (status === 'ready' && audioUrl) {
      setAutoplayTriggered(true)
      pendingAutoplayRef.current = true
      audioRef.current?.play().catch(() => {
        // Browser blocked — cover player is visible for user to tap
        console.log('[AudioPlayer] Autoplay blocked by browser — cover player visible for tap')
      })
    }
    // Only give up if there's definitively no podcast (error/disabled)
    else if (status === 'error' || status === 'disabled') {
      setAutoplayTriggered(true)
      console.log('[AudioPlayer] Autoplay requested but no podcast available')
    }
  }, [shouldAutoplay, autoplayTriggered, status, audioUrl])

  // Called when audio is ready to play
  const handleCanPlay = useCallback(() => {
    if (pendingAutoplayRef.current) {
      pendingAutoplayRef.current = false
      audioRef.current?.play().catch(() => {
        console.log('[AudioPlayer] Autoplay blocked by browser — cover player visible for tap')
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

  // Shared player content (used by both cover pill and flying nav)
  const playerContent = (opts: { showClose?: boolean }) => (
    <div className="relative z-10 flex items-center gap-3 pl-1.5 pr-2 py-1.5">
      {/* Play/Pause */}
      <button
        onClick={togglePlayback}
        disabled={status === 'loading'}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-black/80 dark:bg-white/90 hover:bg-black dark:hover:bg-white transition-colors shrink-0 disabled:opacity-50"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {status === 'loading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-white dark:text-black" />
        ) : isPlaying ? (
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

      {/* Close (flying nav only) */}
      {opts.showClose && (
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/8 dark:hover:bg-white/10 transition-colors shrink-0"
          aria-label="Close player"
        >
          <X className="h-3 w-3 text-black/40 dark:text-white/40" />
        </button>
      )}
    </div>
  )

  // Glass layers shared by cover pill and flying nav
  const glassLayers = (milkyOpacity: number) => (
    <>
      {/* Layer 1: Backdrop blur — frosted glass base */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          backdropFilter: 'blur(16px) saturate(1.8) brightness(1.1) contrast(1.05)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.8) brightness(1.1) contrast(1.05)',
        }}
      />

      {/* Layer 2: Glass tint with depth gradient — thicker glass at edges */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 90% 90% at 50% 45%,
            rgba(255,255,255,0.12) 0%,
            rgba(255,255,255,0.18) 40%,
            rgba(255,255,255,0.35) 70%,
            rgba(255,255,255,0.55) 90%,
            rgba(255,255,255,0.7) 100%
          )`,
        }}
      />

      {/* Layer 3: Top caustic band */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `linear-gradient(172deg,
            rgba(255,255,255,0.9) 0%,
            rgba(255,255,255,0.45) 6%,
            rgba(255,255,255,0.08) 18%,
            transparent 30%,
            transparent 85%,
            rgba(0,0,0,0.03) 100%
          )`,
        }}
      />

      {/* Layer 4: Chromatic aberration */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: `
            inset 6px 0 18px -4px rgba(0,130,255,0.25),
            inset -6px 0 18px -4px rgba(255,80,0,0.2),
            inset 0 6px 16px -4px rgba(255,255,255,0.7),
            inset 0 -4px 12px -4px rgba(0,0,0,0.06),
            inset 0 0 30px 0 rgba(255,255,255,0.05)
          `,
        }}
      />

      {/* Milky overlay — controls opaqueness */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: 'rgba(255,255,255,0.88)',
          opacity: milkyOpacity,
          transition: 'opacity 1.5s ease-out',
        }}
      />

      {/* Layer 5: Sharp specular reflection line */}
      <div
        className="absolute inset-x-3 top-[1px] h-[1px] rounded-full pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.95) 20%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.95) 80%, transparent 95%)',
        }}
      />

      {/* Layer 6: Bottom rim light */}
      <div
        className="absolute inset-x-6 bottom-[1px] h-[1px] rounded-full pointer-events-none opacity-40"
        style={{
          background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.6) 30%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.6) 70%, transparent 90%)',
        }}
      />
    </>
  )

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

      {/* Cover: full player pill (newsletter clickout) or simple button (normal) */}
      <div ref={coverRef}>
        {shouldAutoplay ? (
          // Full player pill with milky glass on the cover
          <div className={cn(
            'relative rounded-full overflow-hidden',
            'border border-white/60 dark:border-white/20',
            'shadow-[0_2px_16px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.3),0_8px_32px_rgba(0,0,0,0.08)]',
            'dark:shadow-[0_2px_16px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.1),0_8px_32px_rgba(0,0,0,0.3)]',
          )}>
            {glassLayers(1)}
            {playerContent({ showClose: false })}
          </div>
        ) : (
          // Normal small circular play/pause button
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
        )}
      </div>

      {/* Flying Navigation — liquid glass mini player */}
      {showFlyingNav && mounted && createPortal(
        <div
          className="flying-player-enter fixed top-3 left-0 right-0 flex justify-center z-50 pointer-events-none"
          role="region"
          aria-label="Podcast Player"
        >
          <div className={cn(
            'relative rounded-full pointer-events-auto overflow-hidden',
            'border border-white/60 dark:border-white/20',
            'shadow-[0_2px_16px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.3),0_8px_32px_rgba(0,0,0,0.08)]',
            'dark:shadow-[0_2px_16px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.1),0_8px_32px_rgba(0,0,0,0.3)]',
          )}>
            {glassLayers(flyingNavMilky ? 1 : 0)}
            {playerContent({ showClose: true })}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
