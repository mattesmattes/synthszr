'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

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
  const [debug, setDebug] = useState('')
  const touchStartX = useRef<number>(0)
  const touchStartY = useRef<number>(0)
  const touchEndX = useRef<number>(0)
  const isSwiping = useRef(false)

  useEffect(() => {
    const minSwipeDistance = 80 // Minimum swipe distance in pixels
    const maxVerticalDistance = 100 // Max vertical movement to count as horizontal swipe

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
      touchEndX.current = e.touches[0].clientX
      isSwiping.current = true
      setDebug(`Start: ${Math.round(touchStartX.current)}px`)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isSwiping.current) return
      touchEndX.current = e.touches[0].clientX
      const deltaX = touchEndX.current - touchStartX.current
      const deltaY = e.touches[0].clientY - touchStartY.current

      // Show debug while moving
      const direction = deltaX > 0 ? 'RIGHT' : 'LEFT'
      setDebug(`${direction}: ${Math.abs(Math.round(deltaX))}px`)

      // If moving too much vertically, cancel the horizontal swipe detection
      if (Math.abs(deltaY) > maxVerticalDistance) {
        isSwiping.current = false
        setDebug('')
      }
    }

    const handleTouchEnd = () => {
      if (!isSwiping.current) return

      const deltaX = touchEndX.current - touchStartX.current
      const absDistance = Math.abs(deltaX)

      setDebug(`End: ${deltaX > 0 ? 'RIGHT' : 'LEFT'} ${absDistance}px`)

      if (absDistance >= minSwipeDistance) {
        if (deltaX > 0) {
          // Swiped right - go to newer post or home
          setDebug(`→ Navigating to ${newerPostSlug || 'home'}`)
          setTimeout(() => {
            if (newerPostSlug) {
              router.push(`/posts/${newerPostSlug}`)
            } else {
              router.push('/')
            }
          }, 100)
        } else {
          // Swiped left - go to older post
          if (olderPostSlug) {
            setDebug(`← Navigating to ${olderPostSlug}`)
            setTimeout(() => {
              router.push(`/posts/${olderPostSlug}`)
            }, 100)
          } else {
            setDebug('← No older post')
          }
        }
      }

      isSwiping.current = false

      // Clear debug after a delay
      setTimeout(() => setDebug(''), 2000)
    }

    // Add event listeners with passive: false to allow preventDefault if needed
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [olderPostSlug, newerPostSlug, router])

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Debug indicator - remove after testing */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        background: debug ? '#CCFF00' : 'rgba(0,0,0,0.5)',
        color: debug ? 'black' : 'white',
        padding: '8px 16px',
        borderRadius: 8,
        fontSize: 12,
        fontFamily: 'monospace',
        zIndex: 9999,
        transition: 'all 0.2s',
        opacity: debug ? 1 : 0.5,
      }}>
        {debug || `← ${olderPostSlug ? 'older' : 'none'} | ${newerPostSlug ? 'newer' : 'home'} →`}
      </div>
      {children}
    </div>
  )
}
