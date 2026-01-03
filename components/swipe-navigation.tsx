'use client'

import { useRouter } from 'next/navigation'
import { useSwipeable, SwipeEventData } from 'react-swipeable'
import { useCallback, useState } from 'react'

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

  const handleSwipedLeft = useCallback(() => {
    if (olderPostSlug) {
      router.push(`/posts/${olderPostSlug}`)
    }
  }, [olderPostSlug, router])

  const handleSwipedRight = useCallback(() => {
    if (newerPostSlug) {
      router.push(`/posts/${newerPostSlug}`)
    } else {
      router.push('/')
    }
  }, [newerPostSlug, router])

  const handleSwiping = useCallback((e: SwipeEventData) => {
    setDebug(`Swiping: ${e.dir} (${Math.round(e.deltaX)}px)`)
  }, [])

  const handlers = useSwipeable({
    onSwipedLeft: handleSwipedLeft,
    onSwipedRight: handleSwipedRight,
    onSwiping: handleSwiping,
    trackMouse: true,  // Also track mouse for desktop testing
    trackTouch: true,
    delta: 30,
    swipeDuration: 1000,
    preventScrollOnSwipe: false,
  })

  return (
    <div {...handlers} style={{ minHeight: '100vh' }}>
      {/* Debug indicator - remove after testing */}
      {debug && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#CCFF00',
          color: 'black',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 12,
          fontFamily: 'monospace',
          zIndex: 9999,
        }}>
          {debug}
        </div>
      )}
      {children}
    </div>
  )
}
