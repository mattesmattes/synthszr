import type { ReactNode } from 'react'

// Force dynamic rendering for all newsletter pages
// These pages use searchParams and don't need static generation
export const dynamic = 'force-dynamic'

interface NewsletterLayoutProps {
  children: ReactNode
}

export default function NewsletterLayout({ children }: NewsletterLayoutProps) {
  return <>{children}</>
}
