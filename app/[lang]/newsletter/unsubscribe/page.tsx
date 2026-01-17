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
    success_title: 'Abmeldung erfolgreich',
    success_message: 'Du wurdest erfolgreich vom Newsletter abgemeldet. Wir werden dir keine weiteren E-Mails senden.',
    already_title: 'Bereits abgemeldet',
    already_message: 'Du bist bereits vom Newsletter abgemeldet.',
    notfound_title: 'Nicht gefunden',
    notfound_message: 'Wir konnten deine E-Mail-Adresse nicht finden. Möglicherweise wurdest du bereits abgemeldet.',
    invalid_title: 'Ungültiger Link',
    invalid_message: 'Der Abmelde-Link ist unvollständig. Bitte verwende den Link aus der E-Mail.',
    error_title: 'Fehler',
    error_message: 'Bei der Abmeldung ist ein Fehler aufgetreten. Bitte versuche es später erneut.',
    back_home: 'Zur Startseite',
    loading: 'Laden...',
  },
  en: {
    success_title: 'Unsubscribed successfully',
    success_message: 'You have been successfully unsubscribed from the newsletter. We will not send you any more emails.',
    already_title: 'Already unsubscribed',
    already_message: 'You are already unsubscribed from the newsletter.',
    notfound_title: 'Not found',
    notfound_message: 'We could not find your email address. You may have already been unsubscribed.',
    invalid_title: 'Invalid link',
    invalid_message: 'The unsubscribe link is incomplete. Please use the link from the email.',
    error_title: 'Error',
    error_message: 'An error occurred during unsubscription. Please try again later.',
    back_home: 'Back to home',
    loading: 'Loading...',
  },
  nds: {
    success_title: 'Afmelding erfolgrik',
    success_message: 'Du büst erfolgrik vun den Newsletter afmeldt. Wi schickt di keen E-Mails mehr.',
    already_title: 'All afmeldt',
    already_message: 'Du büst all vun den Newsletter afmeldt.',
    notfound_title: 'Nich funnen',
    notfound_message: 'Wi kunnt dien E-Mail-Adress nich finnen. Villicht büst du all afmeldt.',
    invalid_title: 'Ungülligen Link',
    invalid_message: 'De Afmelde-Link is nich komplett. Bruuk bitte den Link ut de E-Mail.',
    error_title: 'Fehler',
    error_message: 'Bi de Afmelding is en Fehler optreden. Versöök dat later nochmal.',
    back_home: 'Na de Startsiet',
    loading: 'Laden...',
  },
  cs: {
    success_title: 'Odhlášení úspěšné',
    success_message: 'Byli jste úspěšně odhlášeni z newsletteru. Nebudeme vám posílat další e-maily.',
    already_title: 'Již odhlášeno',
    already_message: 'Již jste odhlášeni z newsletteru.',
    notfound_title: 'Nenalezeno',
    notfound_message: 'Nepodařilo se najít vaši e-mailovou adresu. Možná jste již byli odhlášeni.',
    invalid_title: 'Neplatný odkaz',
    invalid_message: 'Odkaz pro odhlášení je neúplný. Použijte prosím odkaz z e-mailu.',
    error_title: 'Chyba',
    error_message: 'Při odhlášení došlo k chybě. Zkuste to prosím později.',
    back_home: 'Zpět na hlavní stránku',
    loading: 'Načítání...',
  },
}

function UnsubscribeContent({ params }: PageProps) {
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

    if (status === 'already_unsubscribed') {
      return {
        icon: <AlertCircle className="h-16 w-16 text-yellow-500" />,
        title: t.already_title,
        message: t.already_message,
      }
    }

    if (error === 'not_found') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: t.notfound_title,
        message: t.notfound_message,
      }
    }

    if (error === 'missing_id') {
      return {
        icon: <XCircle className="h-16 w-16 text-red-500" />,
        title: t.invalid_title,
        message: t.invalid_message,
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

export default function UnsubscribePage({ params }: PageProps) {
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
      <UnsubscribeContent params={params} />
    </Suspense>
  )
}
