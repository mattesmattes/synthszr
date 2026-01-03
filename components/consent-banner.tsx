'use client'

import { useState, useEffect } from 'react'
import { X, Settings, ChevronDown, ChevronUp } from 'lucide-react'
import {
  hasConsent,
  getConsent,
  setConsent,
  acceptAll,
  rejectAll,
  type ConsentPreferences,
} from '@/lib/consent'

export function ConsentBanner() {
  const [isVisible, setIsVisible] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [preferences, setPreferences] = useState<ConsentPreferences>({
    essential: true,
    analytics: false,
    marketing: false,
    timestamp: 0,
    version: '1.0',
  })

  useEffect(() => {
    // Nur anzeigen wenn noch kein Consent gegeben wurde
    if (!hasConsent()) {
      setIsVisible(true)
    }
    setPreferences(getConsent())
  }, [])

  const handleAcceptAll = () => {
    acceptAll()
    setIsVisible(false)
  }

  const handleRejectAll = () => {
    rejectAll()
    setIsVisible(false)
  }

  const handleSavePreferences = () => {
    setConsent(preferences)
    setIsVisible(false)
  }

  const toggleCategory = (category: 'analytics' | 'marketing') => {
    setPreferences((prev) => ({
      ...prev,
      [category]: !prev[category],
    }))
  }

  if (!isVisible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6">
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-lg">
        <div className="p-4 md:p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">
                Datenschutz-Einstellungen
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Wir nutzen Cookies und ähnliche Technologien, um die Website zu
                verbessern und das Nutzererlebnis zu analysieren.{' '}
                <a
                  href="/datenschutz"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Datenschutzerklärung
                </a>
              </p>
            </div>
          </div>

          {/* Details Toggle */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="mt-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Einstellungen anpassen</span>
            {showDetails ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Detailed Settings */}
          {showDetails && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {/* Essential - Always On */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Technisch notwendig
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Erforderlich für grundlegende Funktionen
                  </p>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="sr-only peer"
                  />
                  <div className="h-5 w-9 rounded-full bg-primary opacity-50 cursor-not-allowed">
                    <div className="absolute top-0.5 left-[18px] h-4 w-4 rounded-full bg-white transition-transform" />
                  </div>
                </div>
              </div>

              {/* Analytics */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Analyse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Anonyme Nutzungsstatistiken (Vercel Analytics)
                  </p>
                </div>
                <button
                  onClick={() => toggleCategory('analytics')}
                  className="relative"
                  role="switch"
                  aria-checked={preferences.analytics}
                >
                  <div
                    className={`h-5 w-9 rounded-full transition-colors ${
                      preferences.analytics ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                        preferences.analytics ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </div>
                </button>
              </div>

              {/* Marketing */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Marketing
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Newsletter-Tracking und personalisierte Inhalte
                  </p>
                </div>
                <button
                  onClick={() => toggleCategory('marketing')}
                  className="relative"
                  role="switch"
                  aria-checked={preferences.marketing}
                >
                  <div
                    className={`h-5 w-9 rounded-full transition-colors ${
                      preferences.marketing ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                        preferences.marketing ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {showDetails ? (
              <button
                onClick={handleSavePreferences}
                className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Auswahl speichern
              </button>
            ) : (
              <>
                <button
                  onClick={handleRejectAll}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
                >
                  Nur notwendige
                </button>
                <button
                  onClick={handleAcceptAll}
                  className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Alle akzeptieren
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Kleiner Button um Consent-Einstellungen erneut zu öffnen
 * Kann z.B. im Footer platziert werden
 */
export function ConsentSettingsButton() {
  const [, setForceUpdate] = useState(0)

  const handleClick = () => {
    // Consent zurücksetzen um Banner erneut anzuzeigen
    if (typeof window !== 'undefined') {
      localStorage.removeItem('synthszr_consent')
      window.dispatchEvent(new CustomEvent('consent-reset'))
      setForceUpdate((n) => n + 1)
      // Seite neu laden um Banner anzuzeigen
      window.location.reload()
    }
  }

  return (
    <button
      onClick={handleClick}
      className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
    >
      Cookie-Einstellungen
    </button>
  )
}
