'use client'

import { useRouter } from 'next/navigation'
import { useSwipeable } from 'react-swipeable'

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

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      // Swipe left (finger moves right→left) → older post
      if (olderPostSlug) {
        router.push(`/posts/${olderPostSlug}`)
      }
    },
    onSwipedRight: () => {
      // Swipe right (finger moves left→right) → newer post or home
      if (newerPostSlug) {
        router.push(`/posts/${newerPostSlug}`)
      } else {
        router.push('/')
      }
    },
    trackMouse: false,
    trackTouch: true,
    delta: 80,              // Minimum distance for swipe
    swipeDuration: 500,     // Maximum time for swipe
    preventScrollOnSwipe: false,
  })

  return (
    <div {...handlers} style={{ minHeight: '100vh' }}>
      {children}
    </div>
  )
}
