/**
 * Consent Management für DSGVO-konforme Cookie/Tracking-Verwaltung
 */

export type ConsentCategory = 'essential' | 'analytics' | 'marketing'

export interface ConsentPreferences {
  essential: boolean // Immer true, technisch notwendig
  analytics: boolean // Vercel Web Analytics
  marketing: boolean // Newsletter-Tracking
  timestamp: number
  version: string
}

const CONSENT_KEY = 'synthszr_consent'
const CONSENT_VERSION = '1.0'

/**
 * Standardeinstellungen - nur Essential aktiv
 */
export const defaultConsent: ConsentPreferences = {
  essential: true,
  analytics: false,
  marketing: false,
  timestamp: 0,
  version: CONSENT_VERSION,
}

/**
 * Prüft ob Consent bereits erteilt wurde
 */
export function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem(CONSENT_KEY)
  if (!stored) return false

  try {
    const consent = JSON.parse(stored) as ConsentPreferences
    // Consent ist gültig wenn Version übereinstimmt
    return consent.version === CONSENT_VERSION && consent.timestamp > 0
  } catch {
    return false
  }
}

/**
 * Lädt gespeicherte Consent-Präferenzen
 */
export function getConsent(): ConsentPreferences {
  if (typeof window === 'undefined') return defaultConsent

  const stored = localStorage.getItem(CONSENT_KEY)
  if (!stored) return defaultConsent

  try {
    const consent = JSON.parse(stored) as ConsentPreferences
    if (consent.version !== CONSENT_VERSION) {
      return defaultConsent
    }
    return consent
  } catch {
    return defaultConsent
  }
}

/**
 * Speichert Consent-Präferenzen
 */
export function setConsent(preferences: Partial<ConsentPreferences>): ConsentPreferences {
  const newConsent: ConsentPreferences = {
    essential: true, // Immer aktiv
    analytics: preferences.analytics ?? false,
    marketing: preferences.marketing ?? false,
    timestamp: Date.now(),
    version: CONSENT_VERSION,
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(newConsent))

    // Custom Event für andere Komponenten
    window.dispatchEvent(new CustomEvent('consent-updated', { detail: newConsent }))
  }

  return newConsent
}

/**
 * Akzeptiert alle Kategorien
 */
export function acceptAll(): ConsentPreferences {
  return setConsent({
    analytics: true,
    marketing: true,
  })
}

/**
 * Lehnt alle optionalen Kategorien ab
 */
export function rejectAll(): ConsentPreferences {
  return setConsent({
    analytics: false,
    marketing: false,
  })
}

/**
 * Löscht Consent (für "Einstellungen ändern")
 */
export function resetConsent(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CONSENT_KEY)
    window.dispatchEvent(new CustomEvent('consent-reset'))
  }
}

/**
 * Prüft ob eine bestimmte Kategorie erlaubt ist
 */
export function isConsentGiven(category: ConsentCategory): boolean {
  const consent = getConsent()
  return consent[category] ?? false
}
