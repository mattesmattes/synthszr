'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

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
  const touchStartX = useRef<number>(0)
  const touchStartY = useRef<number>(0)

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX
      const touchEndY = e.changedTouches[0].clientY

      const deltaX = touchEndX - touchStartX.current
      const deltaY = touchEndY - touchStartY.current

      // Minimum swipe distance (px)
      const minSwipeDistance = 100

      // Must be primarily horizontal swipe
      if (Math.abs(deltaX) < minSwipeDistance) return
      if (Math.abs(deltaY) > Math.abs(deltaX) * 0.5) return

      if (deltaX > 0) {
        // Swipe right (finger moves left→right) → newer post or home
        if (newerPostSlug) {
          router.push(`/posts/${newerPostSlug}`)
        } else {
          router.push('/')
        }
      } else {
        // Swipe left (finger moves right→left) → older post
        if (olderPostSlug) {
          router.push(`/posts/${olderPostSlug}`)
        }
      }
    }

    // Register on document level to catch all touch events
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [router, olderPostSlug, newerPostSlug])

  return <>{children}</>
}
