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
        title: 'Abmeldung erfolgreich',
        message: 'Du wurdest erfolgreich vom Newsletter abgemeldet. Wir werden dir keine weiteren E-Mails senden.',
        type: 'success' as const,
      }
    }

    if (status === 'already_unsubscribed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: 'Bereits abgemeldet',
        message: 'Du bist bereits vom Newsletter abgemeldet.',
        type: 'warning' as const,
      }
    }

    if (error === 'not_found') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Nicht gefunden',
        message: 'Wir konnten deine E-Mail-Adresse nicht finden. Möglicherweise wurdest du bereits abgemeldet.',
        type: 'error' as const,
      }
    }

    if (error === 'missing_id') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: 'Ungültiger Link',
        message: 'Der Abmelde-Link ist unvollständig. Bitte verwende den Link aus der E-Mail.',
        type: 'error' as const,
      }
    }

    return {
      icon: <XCircle className="h-16 w-16 text-red-500" />,
      title: 'Fehler',
      message: 'Bei der Abmeldung ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
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

export default function UnsubscribePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse">Laden...</div>
      </main>
    }>
      <UnsubscribeContent />
    </Suspense>
  )
}
