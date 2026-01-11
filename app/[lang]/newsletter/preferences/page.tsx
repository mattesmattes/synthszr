'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, CheckCircle, AlertCircle, Globe } from 'lucide-react'
import type { LanguageCode, Language } from '@/lib/types'

interface PageProps {
  params: Promise<{ lang: string }>
}

function PreferencesContent({ params }: PageProps) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [locale, setLocale] = useState<LanguageCode>('de')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [languages, setLanguages] = useState<Language[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string>('de')
  const [email, setEmail] = useState<string>('')

  useEffect(() => {
    async function init() {
      const { lang } = await params
      setLocale(lang as LanguageCode)

      // Fetch available languages
      try {
        const res = await fetch('/api/languages')
        if (res.ok) {
          const data = await res.json()
          setLanguages(data.languages || [])
        }
      } catch (e) {
        console.error('Error fetching languages:', e)
      }

      // Fetch subscriber data if token is provided
      if (token) {
        try {
          const res = await fetch(`/api/newsletter/preferences?token=${token}`)
          if (res.ok) {
            const data = await res.json()
            setEmail(data.email || '')
            setSelectedLanguage(data.language || 'de')
          } else {
            const data = await res.json()
            setError(data.error || 'Ungültiger oder abgelaufener Link')
          }
        } catch {
          setError('Fehler beim Laden der Einstellungen')
        }
      } else {
        setError('Kein Zugangstoken vorhanden')
      }

      setLoading(false)
    }
    init()
  }, [params, token])

  async function handleSave() {
    if (!token) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/newsletter/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, language: selectedLanguage }),
      })

      if (res.ok) {
        setSuccess(true)
      } else {
        const data = await res.json()
        setError(data.error || 'Fehler beim Speichern')
      }
    } catch {
      setError('Netzwerkfehler')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <Link
        href={`/${locale}`}
        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-3 w-3" />
        Zurück zur Startseite
      </Link>

      <div className="text-center mb-8">
        <Globe className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">Newsletter-Einstellungen</h1>
        {email && (
          <p className="mt-2 text-sm text-muted-foreground">{email}</p>
        )}
      </div>

      {error && !success && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 mb-6">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 mb-6">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-200">
            Deine Einstellungen wurden gespeichert!
          </p>
        </div>
      )}

      {!error && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Bevorzugte Newsletter-Sprache
            </label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.native_name || lang.name} ({lang.code.toUpperCase()})
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              Falls keine Übersetzung verfügbar ist, erhältst du den Newsletter auf Deutsch.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Speichern...
              </>
            ) : (
              'Speichern'
            )}
          </button>
        </div>
      )}
    </>
  )
}

export default function NewsletterPreferencesPage({ params }: PageProps) {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-md">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <PreferencesContent params={params} />
        </Suspense>
      </div>
    </main>
  )
}
