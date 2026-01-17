'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import type { LanguageCode } from '@/lib/types'

interface PageProps {
  params: Promise<{ lang: string }>
}

const translations: Record<string, Record<string, string>> = {
  de: {
    success_title: 'E-Mail bestätigt!',
    success_message: 'Vielen Dank! Du erhältst ab jetzt unseren Newsletter.',
    already_title: 'Bereits bestätigt',
    already_message: 'Deine E-Mail-Adresse wurde bereits bestätigt. Du erhältst unseren Newsletter.',
    invalid_title: 'Ungültiger Link',
    invalid_message: 'Dieser Bestätigungslink ist ungültig oder abgelaufen. Bitte melde dich erneut an.',
    missing_title: 'Fehlender Link',
    missing_message: 'Der Bestätigungslink ist unvollständig. Bitte verwende den Link aus der E-Mail.',
    error_title: 'Fehler',
    error_message: 'Bei der Bestätigung ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
    back_home: 'Zur Startseite',
    loading: 'Laden...',
  },
  en: {
    success_title: 'Email confirmed!',
    success_message: 'Thank you! You will now receive our newsletter.',
    already_title: 'Already confirmed',
    already_message: 'Your email address has already been confirmed. You are receiving our newsletter.',
    invalid_title: 'Invalid link',
    invalid_message: 'This confirmation link is invalid or expired. Please sign up again.',
    missing_title: 'Missing link',
    missing_message: 'The confirmation link is incomplete. Please use the link from the email.',
    error_title: 'Error',
    error_message: 'An error occurred during confirmation. Please try again later.',
    back_home: 'Back to home',
    loading: 'Loading...',
  },
  nds: {
    success_title: 'E-Mail bestätigt!',
    success_message: 'Veel Dank! Du kriggst nu unsen Newsletter.',
    already_title: 'All bestätigt',
    already_message: 'Dien E-Mail-Adress is all bestätigt. Du kriggst unsen Newsletter.',
    invalid_title: 'Ungülligen Link',
    invalid_message: 'Disse Bestätigungslink is ungüllig oder aflopen. Meld di bitte nochmal an.',
    missing_title: 'Fehlenden Link',
    missing_message: 'De Bestätigungslink is nich komplett. Bruuk bitte den Link ut de E-Mail.',
    error_title: 'Fehler',
    error_message: 'Bi de Bestätigung is en Fehler optreden. Versöök dat later nochmal.',
    back_home: 'Na de Startsiet',
    loading: 'Laden...',
  },
  cs: {
    success_title: 'E-mail potvrzen!',
    success_message: 'Děkujeme! Nyní budete dostávat náš newsletter.',
    already_title: 'Již potvrzeno',
    already_message: 'Vaše e-mailová adresa již byla potvrzena. Dostáváte náš newsletter.',
    invalid_title: 'Neplatný odkaz',
    invalid_message: 'Tento potvrzovací odkaz je neplatný nebo vypršel. Zaregistrujte se prosím znovu.',
    missing_title: 'Chybějící odkaz',
    missing_message: 'Potvrzovací odkaz je neúplný. Použijte prosím odkaz z e-mailu.',
    error_title: 'Chyba',
    error_message: 'Při potvrzení došlo k chybě. Zkuste to prosím později.',
    back_home: 'Zpět na hlavní stránku',
    loading: 'Načítání...',
  },
}

function ConfirmContent({ params }: PageProps) {
  const searchParams = useSearchParams()
  const status = searchParams.get('status')
  const error = searchParams.get('error')
  const [locale, setLocale] = useState<LanguageCode>('de')

  useEffect(() => {
    async function init() {
      const { lang } = await params
      setLocale(lang as LanguageCode)
    }
    init()
  }, [params])

  const t = translations[locale] || translations.de

  const getContent = () => {
    if (status === 'success') {
      return {
        icon: <CheckCircle2 className="h-16 w-16 text-green-500" />,
        title: t.success_title,
        message: t.success_message,
      }
    }

    if (status === 'already_confirmed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: t.already_title,
        message: t.already_message,
      }
    }

    if (error === 'invalid_token') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: t.invalid_title,
        message: t.invalid_message,
      }
    }

    if (error === 'missing_token') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: t.missing_title,
        message: t.missing_message,
      }
    }

    return {
      icon: <XCircle className="h-16 w-16 text-red-500" />,
      title: t.error_title,
      message: t.error_message,
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
          href={`/${locale}`}
          className="inline-block mt-6 px-6 py-3 bg-primary text-primary-foreground rounded-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {t.back_home}
        </Link>
      </div>
    </main>
  )
}

export default function ConfirmPage({ params }: PageProps) {
  const [locale, setLocale] = useState<LanguageCode>('de')

  useEffect(() => {
    async function init() {
      const { lang } = await params
      setLocale(lang as LanguageCode)
    }
    init()
  }, [params])

  const t = translations[locale] || translations.de

  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse">{t.loading}</div>
      </main>
    }>
      <ConfirmContent params={params} />
    </Suspense>
  )
}
