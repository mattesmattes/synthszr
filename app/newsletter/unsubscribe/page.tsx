'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Suspense } from 'react'

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const status = searchParams.get('status')
  const error = searchParams.get('error')

  const getContent = () => {
    if (status === 'success') {
      return {
        icon: <CheckCircle2 className="h-16 w-16 text-green-500" />,
        title: 'Unsubscribed',
        message: 'You have been successfully unsubscribed from our newsletter. We will not send you any more emails.',
        type: 'success' as const,
      }
    }

    if (status === 'already_unsubscribed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: 'Already unsubscribed',
        message: 'You are already unsubscribed from our newsletter.',
        type: 'warning' as const,
      }
    }

    if (error === 'not_found') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Not found',
        message: 'We could not find your email address. You may have already been unsubscribed.',
        type: 'error' as const,
      }
    }

    if (error === 'missing_id') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Invalid link',
        message: 'The unsubscribe link is incomplete. Please use the link from the email.',
        type: 'error' as const,
      }
    }

    return {
      icon: <XCircle className="h-16 w-16 text-red-500" />,
      title: 'Error',
      message: 'An error occurred during unsubscription. Please try again later.',
      type: 'error' as const,
    }
  }

  const content = getContent()

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          {content.icon}
        </div>
        <h1 className="text-2xl font-bold">{content.title}</h1>
        <p className="text-muted-foreground">{content.message}</p>
        <Link
          href="/"
          className="inline-block mt-6 px-6 py-3 bg-primary text-primary-foreground rounded-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go to homepage
        </Link>
      </div>
    </main>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse">Loading...</div>
      </main>
    }>
      <UnsubscribeContent />
    </Suspense>
  )
}
