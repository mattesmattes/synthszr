"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { X, Loader2, CheckCircle2 } from "lucide-react"

const COOKIE_NAME = 'synthszr_subscribed'
const COOKIE_DAYS = 365
const POPUP_DELAY_MS = 5000 // Show popup after 5 seconds
const LOCAL_STORAGE_EMAIL_KEY = 'synthszr_email_draft'
const LOCAL_STORAGE_VISIT_KEY = 'synthszr_visit_count'
const SHOW_POPUP_EVERY_N_VISITS = 7 // Show popup on every 7th visit

// Translations for the popup
type PopupTranslation = {
  heading: string
  subheading: string
  placeholder: string
  submit: string
  submitting: string
  success: string
}

// English is the default (shown before user chooses a language)
const defaultTranslation: PopupTranslation = {
  heading: 'Subscribe free. Unsubscribe the second it sucks.',
  subheading: 'High-signal news across AI, business, UX, and tech. Every morning.',
  placeholder: 'your@email.com',
  submit: 'Subscribe',
  submitting: 'Sending...',
  success: 'Almost there! Please confirm your email.',
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

export function NewsletterPopup() {
  const [isVisible, setIsVisible] = useState(false)
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState("")
  const popupRef = useRef<HTMLDivElement>(null)

  // Always use English for the popup (design decision: English is the universal default)
  // The popup should show English to all users regardless of URL locale
  const t: PopupTranslation = defaultTranslation

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

    // Increment visit counter and check if we should show popup
    const currentCount = parseInt(localStorage.getItem(LOCAL_STORAGE_VISIT_KEY) || '0', 10)
    const newCount = currentCount + 1
    localStorage.setItem(LOCAL_STORAGE_VISIT_KEY, newCount.toString())

    // Only show popup on every Nth visit (1st, 8th, 15th, etc.)
    if (newCount % SHOW_POPUP_EVERY_N_VISITS !== 1) {
      return
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
        body: JSON.stringify({ email, language: 'en' }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        // Set cookie to not show popup again
        setCookie(COOKIE_NAME, 'true', COOKIE_DAYS)
        // Clear localStorage (email draft and visit counter)
        localStorage.removeItem(LOCAL_STORAGE_EMAIL_KEY)
        localStorage.removeItem(LOCAL_STORAGE_VISIT_KEY)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Animated backdrop - radial blur expanding from center */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-backdrop-blur" />

      <div
        ref={popupRef}
        className="relative w-full max-w-md bg-[#f5f5f5] p-6 md:p-8 shadow-2xl animate-popup-emerge overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-popup-heading"
      >
        {/* Subtle shimmer effect */}
        <div className="absolute inset-0 opacity-0 animate-shimmer pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-shimmer-slide" />
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
          <div className="text-center py-6">
            <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-3" />
            <p className="text-base text-gray-700">{t.success}</p>
          </div>
        ) : (
          <>
            {/* Heading */}
            <h2
              id="newsletter-popup-heading"
              className="text-xl md:text-2xl font-bold text-gray-900 leading-tight mb-2 pr-8"
            >
              Subscribe free. Unsubscribe<br />the second it sucks.
            </h2>

            {/* Subheading */}
            <p className="text-base md:text-lg text-gray-400 leading-relaxed mb-6">
              {t.subheading}
            </p>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder={t.placeholder}
                required
                disabled={status === 'loading'}
                className="flex-1 px-3 py-2.5 text-sm border border-gray-300 bg-white focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-6 py-2.5 text-sm font-medium bg-black text-white hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
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
