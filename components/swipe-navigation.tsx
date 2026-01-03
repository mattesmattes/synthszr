'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useCallback } from 'react'

interface SwipeNavigationProps {
  children: React.ReactNode
  olderPostSlug?: string | null  // Swipe left → older (previous day)
  newerPostSlug?: string | null  // Swipe right → newer (next day) or home
}

export function SwipeNavigation({
  children,
  olderPostSlug,
  newerPostSlug
}: SwipeNavigationProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number>(0)
  const touchStartY = useRef<number>(0)
  const isSwiping = useRef<boolean>(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isSwiping.current = true
  }, [])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isSwiping.current) return
    isSwiping.current = false

    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY

    const deltaX = touchEndX - touchStartX.current
    const deltaY = touchEndY - touchStartY.current

    // Minimum swipe distance (px)
    const minSwipeDistance = 80

    // Ensure horizontal swipe is dominant (not vertical scrolling)
    if (Math.abs(deltaX) < minSwipeDistance) return
    if (Math.abs(deltaY) > Math.abs(deltaX) * 0.7) return

    if (deltaX > 0) {
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
  }, [router, olderPostSlug, newerPostSlug])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchEnd])

  return (
    <div ref={containerRef} className="min-h-screen">
      {children}
    </div>
  )
}
