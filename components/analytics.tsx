'use client'

import { useEffect, useState } from 'react'
import { Analytics as VercelAnalytics } from '@vercel/analytics/next'
import { getConsent, hasConsent } from '@/lib/consent'

/**
 * Conditional Analytics Component
 * Lädt Vercel Analytics nur wenn Consent erteilt wurde
 */
export function Analytics() {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)

  useEffect(() => {
    // Initial check
    if (hasConsent()) {
      const consent = getConsent()
      setAnalyticsEnabled(consent.analytics)
    }

    // Listen for consent updates
    const handleConsentUpdate = (event: CustomEvent) => {
      const consent = event.detail
      setAnalyticsEnabled(consent?.analytics ?? false)
    }

    const handleConsentReset = () => {
      setAnalyticsEnabled(false)
    }

    window.addEventListener('consent-updated', handleConsentUpdate as EventListener)
    window.addEventListener('consent-reset', handleConsentReset)

    return () => {
      window.removeEventListener('consent-updated', handleConsentUpdate as EventListener)
      window.removeEventListener('consent-reset', handleConsentReset)
    }
  }, [])

  // Nur rendern wenn Analytics erlaubt
  if (!analyticsEnabled) {
    return null
  }

  return <VercelAnalytics />
}
