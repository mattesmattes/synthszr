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
  const containerRef = useRef<HTMLDivElement>(null)
  const debugRef = useRef<HTMLDivElement>(null)

  // Touch tracking refs (no re-renders)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchStartTime = useRef(0)
  const currentDeltaX = useRef(0)
  const isTracking = useRef(false)

  const navigate = useCallback((direction: 'left' | 'right') => {
    if (direction === 'right') {
      // Swipe right → newer post or home
      if (newerPostSlug) {
        router.push(`/posts/${newerPostSlug}`)
      } else {
        router.push('/')
      }
    } else {
      // Swipe left → older post
      if (olderPostSlug) {
        router.push(`/posts/${olderPostSlug}`)
      }
    }
  }, [olderPostSlug, newerPostSlug, router])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const minSwipeDistance = 60 // Reduced for snappier feel
    const maxVerticalRatio = 1.5 // Allow some diagonal movement
    const minVelocity = 0.4 // px/ms - fast swipe threshold

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
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTracking.current) return

      const deltaX = e.touches[0].clientX - touchStartX.current
      const deltaY = e.touches[0].clientY - touchStartY.current
      currentDeltaX.current = deltaX

      // Cancel if moving too vertically
      if (Math.abs(deltaY) > Math.abs(deltaX) * maxVerticalRatio && Math.abs(deltaY) > 30) {
        isTracking.current = false
        updateDebug(`← ${olderPostSlug ? 'älter' : '–'} | ${newerPostSlug ? 'neuer' : 'home'} →`, false)
        return
      }

      // Visual feedback
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
      const velocity = Math.abs(deltaX) / elapsed // px/ms
      const absDistance = Math.abs(deltaX)

      // Trigger navigation if:
      // 1. Swiped far enough, OR
      // 2. Swiped fast enough (even if short)
      const shouldNavigate = absDistance >= minSwipeDistance ||
        (velocity >= minVelocity && absDistance >= 30)

      if (shouldNavigate) {
        if (deltaX > 0) {
          updateDebug('→ navigiere...', true)
          navigate('right')
        } else if (olderPostSlug) {
          updateDebug('← navigiere...', true)
          navigate('left')
        } else {
          updateDebug('← kein älterer Post', false)
        }
      } else {
        updateDebug(`← ${olderPostSlug ? 'älter' : '–'} | ${newerPostSlug ? 'neuer' : 'home'} →`, false)
      }
    }

    // Use passive listeners for better scroll performance
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [olderPostSlug, newerPostSlug, navigate])

  return (
    <div ref={containerRef} style={{ minHeight: '100vh' }}>
      {/* Debug indicator */}
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
