"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { X, Loader2, CheckCircle2 } from "lucide-react"
import type { LanguageCode } from "@/lib/types"
import { ALL_LOCALES } from "@/lib/i18n/config"

const COOKIE_NAME = 'synthszr_subscribed'
const COOKIE_DAYS = 365
const POPUP_DELAY_MS = 5000 // Show popup after 5 seconds
const LOCAL_STORAGE_EMAIL_KEY = 'synthszr_email_draft'

interface NewsletterPopupProps {
  locale?: LanguageCode
}

/**
 * Detect locale from URL path (e.g., /en/posts/... → 'en')
 */
function detectLocaleFromPath(): LanguageCode {
  if (typeof window === 'undefined') return 'de'

  const pathSegments = window.location.pathname.split('/')
  const firstSegment = pathSegments[1]

  if (firstSegment && ALL_LOCALES.includes(firstSegment as LanguageCode)) {
    return firstSegment as LanguageCode
  }

  return 'de' // Default to German
}

// Translations for the popup
type PopupTranslation = {
  heading: string
  subheading: string
  placeholder: string
  submit: string
  submitting: string
  success: string
}

const defaultTranslation: PopupTranslation = {
  heading: 'Kostenlos abonnieren. Abbestellen, wenn\'s nervt.',
  subheading: 'Das Interessante aus AI, Business, UX und Tech jeden Morgen in Deiner Inbox.',
  placeholder: 'your@email.com',
  submit: 'Subscribe',
  submitting: 'Sending...',
  success: 'Fast geschafft! Bitte bestätige deine E-Mail.',
}

const translations: Partial<Record<LanguageCode, PopupTranslation>> = {
  de: defaultTranslation,
  en: {
    heading: 'Subscribe for free. Unsubscribe when it bothers you.',
    subheading: 'The interesting stuff from AI, Business, UX and Tech every morning in your inbox.',
    placeholder: 'your@email.com',
    submit: 'Subscribe',
    submitting: 'Sending...',
    success: 'Almost there! Please confirm your email.',
  },
  cs: {
    heading: 'Odebírejte zdarma. Odhlaste se, kdykoliv.',
    subheading: 'Zajímavosti z AI, businessu, UX a technologií každé ráno ve vaší schránce.',
    placeholder: 'your@email.com',
    submit: 'Subscribe',
    submitting: 'Odesílání...',
    success: 'Skoro hotovo! Potvrďte prosím svůj email.',
  },
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`
}

function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null
  return null
}

export function NewsletterPopup({ locale: localeProp }: NewsletterPopupProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState("")
  const [detectedLocale, setDetectedLocale] = useState<LanguageCode>('de')
  const popupRef = useRef<HTMLDivElement>(null)

  // Use prop if provided, otherwise detect from URL
  const locale = localeProp ?? detectedLocale

  const t: PopupTranslation = translations[locale] ?? defaultTranslation

  // Detect locale from URL on mount
  useEffect(() => {
    if (!localeProp) {
      setDetectedLocale(detectLocaleFromPath())
    }
  }, [localeProp])

  // Check if popup should be shown
  useEffect(() => {
    // Don't show if already subscribed
    if (getCookie(COOKIE_NAME)) {
      return
    }

    // Try to restore email from localStorage
    const savedEmail = localStorage.getItem(LOCAL_STORAGE_EMAIL_KEY)
    if (savedEmail) {
      setEmail(savedEmail)
    }

    // Show popup after delay
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, POPUP_DELAY_MS)

    return () => clearTimeout(timer)
  }, [])

  // Close on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
      setIsVisible(false)
    }
  }, [])

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsVisible(false)
    }
  }, [])

  useEffect(() => {
    if (isVisible) {
      // Small delay to prevent immediate close from the same click
      const timer = setTimeout(() => {
        document.addEventListener('click', handleOutsideClick)
        document.addEventListener('keydown', handleKeyDown)
      }, 100)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('click', handleOutsideClick)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [isVisible, handleOutsideClick, handleKeyDown])

  const handleClose = () => {
    setIsVisible(false)
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setEmail(value)
    // Save draft to localStorage
    localStorage.setItem(LOCAL_STORAGE_EMAIL_KEY, value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) return

    setStatus('loading')
    setErrorMessage("")

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, language: locale }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        // Set cookie to not show popup again
        setCookie(COOKIE_NAME, 'true', COOKIE_DAYS)
        // Clear localStorage
        localStorage.removeItem(LOCAL_STORAGE_EMAIL_KEY)
        // Auto-close after success
        setTimeout(() => setIsVisible(false), 3000)
      } else {
        setStatus('error')
        setErrorMessage(data.error || 'An error occurred')
      }
    } catch {
      setStatus('error')
      setErrorMessage('Network error. Please try again.')
    }
  }

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-backdrop-fade">
      {/* Animated backdrop with blur */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      <div
        ref={popupRef}
        className="relative w-full max-w-xl bg-[#f5f5f5] p-8 md:p-12 shadow-2xl animate-popup-enter overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-popup-heading"
      >
        {/* Subtle shimmer effect on the edge */}
        <div className="absolute inset-0 opacity-0 animate-shimmer pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-shimmer-slide" />
        </div>
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-800 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {status === 'success' ? (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <p className="text-lg text-gray-700">{t.success}</p>
          </div>
        ) : (
          <>
            {/* Heading */}
            <h2
              id="newsletter-popup-heading"
              className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight mb-2"
            >
              {t.heading}
            </h2>

            {/* Subheading */}
            <p className="text-lg md:text-xl text-gray-400 leading-relaxed mb-8">
              {t.subheading}
            </p>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder={t.placeholder}
                required
                disabled={status === 'loading'}
                className="flex-1 px-4 py-3 text-base border border-gray-300 bg-white focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-8 py-3 text-base font-medium bg-black text-white hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.submitting}
                  </>
                ) : (
                  t.submit
                )}
              </button>
            </form>

            {/* Error message */}
            {status === 'error' && errorMessage && (
              <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
