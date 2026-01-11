import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/lib/i18n/context'
import { getTranslations } from '@/lib/i18n/get-translations'
import { ALL_LOCALES } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'

interface LocaleLayoutProps {
  children: ReactNode
  params: Promise<{ lang: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { lang } = await params

  // Validate locale
  if (!ALL_LOCALES.includes(lang as LanguageCode)) {
    notFound()
  }

  const locale = lang as LanguageCode
  const translations = await getTranslations(locale)

  return (
    <I18nProvider locale={locale} translations={translations}>
      {children}
    </I18nProvider>
  )
}

// Generate static params for all locales
export function generateStaticParams() {
  return ALL_LOCALES.map((lang) => ({ lang }))
}
