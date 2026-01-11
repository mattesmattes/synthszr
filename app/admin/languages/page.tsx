'use client'

import { useEffect, useState } from 'react'
import { Globe, CheckCircle, XCircle, Loader2, Play, Settings2, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { Language } from '@/lib/types'
import type { TranslationModel } from '@/lib/i18n/translation-service'

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-haiku-3.5': 'Claude Haiku 3.5',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
}

interface ApiKeyTestResult {
  valid: boolean
  error?: string
  lastChars?: string
}

interface ApiKeyTestResults {
  anthropic: ApiKeyTestResult
  google: ApiKeyTestResult
}

export default function LanguagesPage() {
  const [languages, setLanguages] = useState<Language[]>([])
  const [availableModels, setAvailableModels] = useState<TranslationModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState<string | null>(null)
  const [testingKeys, setTestingKeys] = useState(false)
  const [keyTestResults, setKeyTestResults] = useState<ApiKeyTestResults | null>(null)

  useEffect(() => {
    fetchLanguages()
  }, [])

  async function fetchLanguages() {
    try {
      const res = await fetch('/api/admin/languages')
      const data = await res.json()
      setLanguages(data.languages || [])
      setAvailableModels(data.availableModels || [])
    } catch (error) {
      console.error('Error fetching languages:', error)
    } finally {
      setLoading(false)
    }
  }

  async function testApiKeys() {
    setTestingKeys(true)
    try {
      const res = await fetch('/api/admin/languages/test-keys', {
        method: 'POST',
      })
      const data = await res.json()
      setKeyTestResults(data)
    } catch (error) {
      console.error('Error testing API keys:', error)
    } finally {
      setTestingKeys(false)
    }
  }

  async function updateLanguage(code: string, updates: Partial<Language>) {
    setSaving(code)
    try {
      const res = await fetch('/api/admin/languages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ...updates }),
      })

      if (res.ok) {
        const data = await res.json()
        setLanguages(prev =>
          prev.map(lang => (lang.code === code ? data.language : lang))
        )
      }
    } catch (error) {
      console.error('Error updating language:', error)
    } finally {
      setSaving(null)
    }
  }

  async function triggerBackfill(code: string, fromDate: string | null) {
    setBackfilling(code)
    try {
      const res = await fetch('/api/admin/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, from_date: fromDate }),
      })

      const data = await res.json()

      if (res.ok) {
        alert(`Backfill gestartet: ${data.queued} Artikel zur Übersetzung in Queue${data.skipped ? ` (${data.skipped} übersprungen)` : ''}`)
      } else {
        alert(`Fehler: ${data.error}`)
      }
    } catch (error) {
      console.error('Error triggering backfill:', error)
      alert('Fehler beim Starten des Backfills')
    } finally {
      setBackfilling(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const defaultLanguage = languages.find(l => l.is_default)
  const otherLanguages = languages.filter(l => !l.is_default)

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <Globe className="h-8 w-8" />
          Sprachen
        </h1>
        <p className="mt-1 text-muted-foreground">
          Verwalte die verfügbaren Sprachen und Übersetzungseinstellungen
        </p>
      </div>

      {/* Default Language */}
      {defaultLanguage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="secondary">Standard</Badge>
              {defaultLanguage.native_name || defaultLanguage.name}
            </CardTitle>
            <CardDescription>
              Die Standardsprache kann nicht deaktiviert werden. Alle Originalinhalte sind in dieser Sprache.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Available Models Info */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Verfügbare Übersetzungsmodelle
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={testApiKeys}
              disabled={testingKeys}
            >
              {testingKeys ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Keys testen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* API Key Test Results */}
          {keyTestResults && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50 space-y-2">
              <p className="text-xs font-medium mb-2">API Key Validierung:</p>

              {/* Anthropic */}
              <div className="flex items-center gap-2">
                {keyTestResults.anthropic.valid ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : keyTestResults.anthropic.error === 'API key not configured' ? (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm">Anthropic (Claude)</span>
                {keyTestResults.anthropic.valid ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">OK</Badge>
                ) : keyTestResults.anthropic.lastChars ? (
                  <Badge variant="destructive" className="text-xs">
                    Fehler (Key ...{keyTestResults.anthropic.lastChars})
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Nicht konfiguriert</Badge>
                )}
              </div>
              {keyTestResults.anthropic.error && keyTestResults.anthropic.error !== 'API key not configured' && (
                <p className="text-xs text-destructive ml-6">{keyTestResults.anthropic.error}</p>
              )}

              {/* Google */}
              <div className="flex items-center gap-2">
                {keyTestResults.google.valid ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : keyTestResults.google.error === 'API key not configured' ? (
                  <XCircle className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
                <span className="text-sm">Google (Gemini)</span>
                {keyTestResults.google.valid ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">OK</Badge>
                ) : keyTestResults.google.lastChars ? (
                  <Badge variant="destructive" className="text-xs">
                    Fehler (Key ...{keyTestResults.google.lastChars})
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Nicht konfiguriert</Badge>
                )}
              </div>
              {keyTestResults.google.error && keyTestResults.google.error !== 'API key not configured' && (
                <p className="text-xs text-destructive ml-6">{keyTestResults.google.error}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {availableModels.length > 0 ? (
              availableModels.map(model => (
                <Badge key={model} variant="outline" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {MODEL_LABELS[model] || model}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Keine Modelle verfügbar. Bitte API-Keys in .env.local konfigurieren.
              </p>
            )}
          </div>
          {availableModels.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Modelle werden basierend auf konfigurierten API-Keys erkannt. Klicke "Keys testen" um zu prüfen, ob sie funktionieren.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Other Languages */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Zielsprachen</h2>

        {otherLanguages.map(language => (
          <Card key={language.code}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">
                    {language.native_name || language.name}
                  </CardTitle>
                  <Badge variant="outline">{language.code.toUpperCase()}</Badge>
                  {language.is_active ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                      Aktiv
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Inaktiv</Badge>
                  )}
                </div>
                <Switch
                  checked={language.is_active}
                  disabled={saving === language.code}
                  onCheckedChange={(checked) => updateLanguage(language.code, { is_active: checked })}
                />
              </div>
            </CardHeader>

            {language.is_active && (
              <CardContent className="space-y-4">
                {/* Model Selection */}
                <div className="grid gap-2">
                  <Label htmlFor={`model-${language.code}`}>Übersetzungsmodell</Label>
                  <Select
                    value={language.llm_model || 'default'}
                    onValueChange={(value) => updateLanguage(language.code, { llm_model: value === 'default' ? null : value })}
                    disabled={saving === language.code || availableModels.length === 0}
                  >
                    <SelectTrigger id={`model-${language.code}`}>
                      <SelectValue placeholder="Standard (Gemini 2.0 Flash)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Standard (Gemini 2.0 Flash)</SelectItem>
                      {availableModels.map(model => (
                        <SelectItem key={model} value={model}>
                          {MODEL_LABELS[model] || model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Backfill Section */}
                <div className="border-t pt-4">
                  <Label>Bestehende Artikel übersetzen</Label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Fügt alle veröffentlichten Artikel zur Übersetzungs-Queue hinzu.
                    Manuell bearbeitete Übersetzungen werden übersprungen.
                  </p>

                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label htmlFor={`backfill-date-${language.code}`} className="text-xs">
                        Ab Datum (optional)
                      </Label>
                      <Input
                        id={`backfill-date-${language.code}`}
                        type="date"
                        value={language.backfill_from_date || ''}
                        onChange={(e) => updateLanguage(language.code, { backfill_from_date: e.target.value || null })}
                        disabled={saving === language.code}
                      />
                    </div>
                    <Button
                      onClick={() => triggerBackfill(language.code, language.backfill_from_date)}
                      disabled={backfilling === language.code}
                      variant="outline"
                    >
                      {backfilling === language.code ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Backfill starten
                    </Button>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Queue Processing Hint */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Hinweis:</strong> Übersetzungen werden in der Queue gespeichert und können über{' '}
            <a href="/admin/translations" className="text-primary hover:underline">
              Übersetzungs-Dashboard
            </a>{' '}
            verwaltet werden. Die Queue wird automatisch per Cron oder manuell verarbeitet.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
