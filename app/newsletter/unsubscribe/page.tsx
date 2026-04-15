'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Suspense, useState } from 'react'

type ViewState =
  | { kind: 'confirm'; id: string }
  | { kind: 'loading' }
  | { kind: 'status'; status: string | null; error: string | null }

function UnsubscribeContent() {
  const searchParams = useSearchParams()
  const initialId = searchParams.get('id')
  const initialConfirm = searchParams.get('confirm') === '1'
  const initialStatus = searchParams.get('status')
  const initialError = searchParams.get('error')

  const [view, setView] = useState<ViewState>(() => {
    if (initialConfirm && initialId) return { kind: 'confirm', id: initialId }
    return { kind: 'status', status: initialStatus, error: initialError }
  })

  async function handleConfirm(id: string) {
    setView({ kind: 'loading' })
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.status) {
        setView({ kind: 'status', status: data.status, error: null })
      } else {
        setView({ kind: 'status', status: null, error: data.error || 'server_error' })
      }
    } catch {
      setView({ kind: 'status', status: null, error: 'server_error' })
    }
  }

  if (view.kind === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (view.kind === 'confirm') {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <AlertCircle className="h-16 w-16 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold">Unsubscribe from newsletter?</h1>
          <p className="text-muted-foreground">
            Confirm below to stop receiving our newsletter. You will not be unsubscribed automatically — this extra step prevents email scanners from unsubscribing you by accident.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => handleConfirm(view.id)}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Yes, unsubscribe me
            </button>
            <Link
              href="/"
              className="px-6 py-3 border rounded-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const { status, error } = view
  const content = (() => {
    if (status === 'success') {
      return {
        icon: <CheckCircle2 className="h-16 w-16 text-green-500" />,
        title: 'Unsubscribed',
        message: 'You have been successfully unsubscribed from our newsletter. We will not send you any more emails.',
      }
    }
    if (status === 'already_unsubscribed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: 'Already unsubscribed',
        message: 'You are already unsubscribed from our newsletter.',
      }
    }
    if (error === 'not_found') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Not found',
        message: 'We could not find your email address. You may have already been unsubscribed.',
      }
    }
    if (error === 'missing_id') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Invalid link',
        message: 'The unsubscribe link is incomplete. Please use the link from the email.',
      }
    }
    return {
      icon: <XCircle className="h-16 w-16 text-red-500" />,
      title: 'Error',
      message: 'An error occurred during unsubscription. Please try again later.',
    }
  })()

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">{content.icon}</div>
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
