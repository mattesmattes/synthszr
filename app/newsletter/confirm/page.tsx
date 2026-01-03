'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Suspense } from 'react'

function ConfirmContent() {
  const searchParams = useSearchParams()
  const status = searchParams.get('status')
  const error = searchParams.get('error')

  const getContent = () => {
    if (status === 'success') {
      return {
        icon: <CheckCircle2 className="h-16 w-16 text-green-500" />,
        title: 'E-Mail bestätigt!',
        message: 'Vielen Dank! Du erhältst ab jetzt unseren Newsletter.',
        type: 'success' as const,
      }
    }

    if (status === 'already_confirmed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: 'Bereits bestätigt',
        message: 'Deine E-Mail-Adresse wurde bereits bestätigt. Du erhältst unseren Newsletter.',
        type: 'warning' as const,
      }
    }

    if (error === 'invalid_token') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Ungültiger Link',
        message: 'Dieser Bestätigungslink ist ungültig oder abgelaufen. Bitte melde dich erneut an.',
        type: 'error' as const,
      }
    }

    if (error === 'missing_token') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Fehlender Link',
        message: 'Der Bestätigungslink ist unvollständig. Bitte verwende den Link aus der E-Mail.',
        type: 'error' as const,
      }
    }

    return {
      icon: <XCircle className="h-16 w-16 text-red-500" />,
      title: 'Fehler',
      message: 'Bei der Bestätigung ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
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
          Zur Startseite
        </Link>
      </div>
    </main>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse">Laden...</div>
      </main>
    }>
      <ConfirmContent />
    </Suspense>
  )
}
