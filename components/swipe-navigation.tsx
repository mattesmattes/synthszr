'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useCallback } from 'react'

interface SwipeNavigationProps {
  children: React.ReactNode
  olderPostSlug?: string | null
  newerPostSlug?: string | null
}

export function SwipeNavigation({
  children,
  olderPostSlug,
  newerPostSlug
}: SwipeNavigationProps) {
  const router = useRouter()
  const debugRef = useRef<HTMLDivElement>(null)

  // Touch tracking refs (no re-renders)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const currentDeltaX = useRef(0)
  const isTracking = useRef(false)

  const navigate = useCallback((direction: 'left' | 'right') => {
    if (direction === 'right') {
      if (newerPostSlug) {
        router.push(`/posts/${newerPostSlug}`)
      } else {
        router.push('/')
      }
    } else {
      if (olderPostSlug) {
        router.push(`/posts/${olderPostSlug}`)
      }
    }
  }, [olderPostSlug, newerPostSlug, router])

  useEffect(() => {
    // Only enable swipe navigation on mobile (viewport < 768px)
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    if (!isMobile) {
      // Hide debug indicator on desktop
      if (debugRef.current) {
        debugRef.current.style.display = 'none'
      }
      return
    }

    const minSwipeDistance = 50
    const maxVerticalRatio = 2
    const minVelocity = 0.3

    const updateDebug = (text: string, highlight: boolean = false) => {
      if (debugRef.current) {
        debugRef.current.textContent = text
        debugRef.current.style.background = highlight ? '#CCFF00' : 'rgba(0,0,0,0.5)'
        debugRef.current.style.color = highlight ? 'black' : 'white'
      }
    }

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
      touchStartTime.current = Date.now()
      currentDeltaX.current = 0
      isTracking.current = true
      updateDebug('touch...', true)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTracking.current) return

      const deltaX = e.touches[0].clientX - touchStartX.current
      const deltaY = e.touches[0].clientY - touchStartY.current
      currentDeltaX.current = deltaX

      // Cancel if moving too vertically
      if (Math.abs(deltaY) > Math.abs(deltaX) * maxVerticalRatio && Math.abs(deltaY) > 20) {
        isTracking.current = false
        updateDebug(`← ${olderPostSlug ? 'älter' : '–'} | ${newerPostSlug ? 'neuer' : 'home'} →`, false)
        return
      }

      const direction = deltaX > 0 ? '→' : '←'
      const target = deltaX > 0
        ? (newerPostSlug ? 'neuer' : 'home')
        : (olderPostSlug ? 'älter' : '–')
      updateDebug(`${direction} ${Math.abs(Math.round(deltaX))}px → ${target}`, true)
    }

    const handleTouchEnd = () => {
      if (!isTracking.current) return
      isTracking.current = false

      const deltaX = currentDeltaX.current
      const elapsed = Date.now() - touchStartTime.current
      const velocity = Math.abs(deltaX) / elapsed
      const absDistance = Math.abs(deltaX)

      const shouldNavigate = absDistance >= minSwipeDistance ||
        (velocity >= minVelocity && absDistance >= 25)

      if (shouldNavigate) {
        if (deltaX > 0) {
          updateDebug('→ navigiere...', true)
          navigate('right')
        } else if (olderPostSlug) {
          updateDebug('← navigiere...', true)
          navigate('left')
        } else {
          updateDebug('← kein älterer', false)
        }
      } else {
        updateDebug(`← ${olderPostSlug ? 'älter' : '–'} | ${newerPostSlug ? 'neuer' : 'home'} →`, false)
      }
    }

    // Window-level events to catch all touches
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [olderPostSlug, newerPostSlug, navigate])

  return (
    <div style={{ minHeight: '100vh' }}>
      <div
        ref={debugRef}
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 12,
          fontFamily: 'monospace',
          zIndex: 9999,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        ← {olderPostSlug ? 'älter' : '–'} | {newerPostSlug ? 'neuer' : 'home'} →
      </div>
      {children}
    </div>
  )
}
