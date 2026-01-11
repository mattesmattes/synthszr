'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { LanguageCode } from '@/lib/types'

interface I18nContextType {
  locale: LanguageCode
  t: (key: string, fallback?: string) => string
  translations: Record<string, string>
}

const I18nContext = createContext<I18nContextType | null>(null)

interface I18nProviderProps {
  children: ReactNode
  locale: LanguageCode
  translations: Record<string, string>
}

export function I18nProvider({ children, locale, translations }: I18nProviderProps) {
  const t = (key: string, fallback?: string): string => {
    return translations[key] ?? fallback ?? key
  }

  return (
    <I18nContext.Provider value={{ locale, t, translations }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}

export function useLocale(): LanguageCode {
  return useI18n().locale
}

export function useTranslation() {
  return useI18n().t
}
