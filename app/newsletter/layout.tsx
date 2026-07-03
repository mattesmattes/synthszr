import type { ReactNode } from 'react'
import type { Metadata } from 'next'

// Force dynamic rendering for all newsletter pages
// These pages use searchParams and don't need static generation
export const dynamic = 'force-dynamic'

// Funktionale Seiten (confirm/unsubscribe/preferences) — nie indexieren.
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface NewsletterLayoutProps {
  children: ReactNode
}

export default function NewsletterLayout({ children }: NewsletterLayoutProps) {
  return <>{children}</>
}
