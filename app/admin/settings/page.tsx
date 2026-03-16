'use client'

import { useEffect, useState } from 'react'
import { Mail, Clock, Bell, CheckCircle, XCircle, Loader2, Save, Sparkles, Play, RefreshCw, Settings2, AlertTriangle, ExternalLink, Cpu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

// --- Types ---

interface ModelInfo {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'google'
  pricing: { input: number; output: number }
}

interface UseCaseInfo {
  label: string
  description: string
  defaultModel: string
  allowedProviders: Array<'anthropic' | 'openai' | 'google'>
}

interface ApiKeyTestResult {
  valid: boolean
  error?: string
  lastChars?: string
}

interface ApiKeyTestResults {
  anthropic: ApiKeyTestResult
  google: ApiKeyTestResult
  openai: ApiKeyTestResult
}

interface GmailStatus {
  connected: boolean
  email: string | null
  messagesTotal?: number
  error?: string
}

interface ScheduleConfig {
  newsletterFetch: {
    enabled: boolean
    hour: number
    minute: number
    hours?: number[]
  }
  webcrawlFetch: {
    enabled: boolean
    hour: number
    minute: number
  }
  dailyAnalysis: {
    enabled: boolean
    hour: number
    minute: number
  }
  postGeneration: {
    enabled: boolean
    hour: number
    minute: number
  }
  newsletterSend: {
    enabled: boolean
    hour: number
    minute: number
  }
}

// --- Constants ---

const USE_CASE_DEFINITIONS: Record<string, UseCaseInfo> = {
  ghostwriter: {
    label: 'Ghostwriter',
    description: 'Blog-Artikel aus dem Digest generieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  synthesis_scoring: {
    label: 'Bewertung (Scoring)',
    description: 'Artikel nach Originalität und Relevanz bewerten',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  synthesis_development: {
    label: 'Synthese (Development)',
    description: 'Synthese-Texte aus Artikelpaaren entwickeln',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_script: {
    label: 'Podcast-Skript',
    description: 'Podcast-Skripte aus Blog-Artikeln generieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
  edit_analysis: {
    label: 'Edit-Analyse',
    description: 'Manuelle Edits klassifizieren und analysieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
  pattern_extraction: {
    label: 'Pattern-Extraktion',
    description: 'Muster aus wiederkehrenden Edits extrahieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
}

const USE_CASE_GROUPS = [
  {
    title: 'Content-Erstellung',
    useCases: ['ghostwriter', 'synthesis_development', 'podcast_script'],
  },
  {
    title: 'Analyse & Verarbeitung',
    useCases: ['synthesis_scoring', 'edit_analysis', 'pattern_extraction'],
  },
]

const DEFAULT_SCHEDULE: ScheduleConfig = {
  newsletterFetch: { enabled: true, hour: 4, minute: 0 },
  webcrawlFetch: { enabled: true, hour: 4, minute: 30 },
  dailyAnalysis: { enabled: true, hour: 5, minute: 0 },
  postGeneration: { enabled: false, hour: 9, minute: 0 },
  newsletterSend: { enabled: false, hour: 9, minute: 30 },
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 30]

// --- Helpers ---

function getBerlinOffset(): number {
  const now = new Date()
  const jan = new Date(now.getFullYear(), 0, 1)
  const jul = new Date(now.getFullYear(), 6, 1)
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
  const isDST = now.getTimezoneOffset() < stdOffset
  return isDST ? 2 : 1
}

function utcToBerlin(hour: number): number {
  return (hour + getBerlinOffset() + 24) % 24
}

function berlinToUtc(hour: number): number {
  return (hour - getBerlinOffset() + 24) % 24
}

function formatPricing(model: ModelInfo): string {
  if (model.pricing.input === 0 && model.pricing.output === 0) return ''
  return `$${model.pricing.input}/$${model.pricing.output}`
}

// --- Component ---

export default function SettingsPage() {
  const searchParams = useSearchParams()

  // Model config state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelConfig, setModelConfig] = useState<Record<string, string>>({})
  const [pricingLastUpdated, setPricingLastUpdated] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(true)
  const [savingModels, setSavingModels] = useState(false)
  const [modelsSaved, setModelsSaved] = useState(false)
  const [testingKeys, setTestingKeys] = useState(false)
  const [keyTestResults, setKeyTestResults] = useState<ApiKeyTestResults | null>(null)

  // Gmail state
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Schedule state
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleSuccess, setScheduleSuccess] = useState(false)
  const [triggeringSchedule, setTriggeringSchedule] = useState(false)
  const [triggerResult, setTriggerResult] = useState<{ success: boolean; message: string; details?: Record<string, string> } | null>(null)

  const success = searchParams.get('success')
  const error = searchParams.get('error')

  useEffect(() => {
    fetchModelsAndConfig()
    fetchGmailStatus()
    fetchSchedule()
  }, [])

  // --- Fetchers ---

  async function fetchModelsAndConfig() {
    setModelsLoading(true)
    try {
      const res = await fetch('/api/admin/available-models')
      const data = await res.json()
      setAvailableModels(data.models || [])
      setModelConfig(data.config || {})
      setPricingLastUpdated(data.pricingLastUpdated || null)
    } catch (err) {
      console.error('Error fetching models:', err)
    } finally {
      setModelsLoading(false)
    }
  }

  async function saveModelConfiguration() {
    setSavingModels(true)
    setModelsSaved(false)
    try {
      const res = await fetch('/api/admin/available-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelConfig),
      })
      if (res.ok) {
        setModelsSaved(true)
        setTimeout(() => setModelsSaved(false), 3000)
      }
    } catch (err) {
      console.error('Error saving model config:', err)
    } finally {
      setSavingModels(false)
    }
  }

  async function testApiKeys() {
    setTestingKeys(true)
    try {
      const res = await fetch('/api/admin/languages/test-keys', { method: 'POST' })
      const data = await res.json()
      setKeyTestResults(data)
    } catch (err) {
      console.error('Error testing API keys:', err)
    } finally {
      setTestingKeys(false)
    }
  }

  async function fetchGmailStatus() {
    try {
      const response = await fetch('/api/gmail/status')
      const data = await response.json()
      setGmailStatus(data)
    } catch {
      setGmailStatus({ connected: false, email: null })
    } finally {
      setLoading(false)
    }
  }

  async function fetchSchedule() {
    try {
      const response = await fetch('/api/admin/schedule')
      if (response.ok) {
        const data: ScheduleConfig = await response.json()
        const newsletterFetchHour = data.newsletterFetch.hour !== undefined
          ? data.newsletterFetch.hour
          : (data.newsletterFetch.hours?.[0] ?? 6)
        const newsletterFetchMinute = data.newsletterFetch.minute ?? 0

        setSchedule({
          newsletterFetch: {
            enabled: data.newsletterFetch.enabled,
            hour: utcToBerlin(newsletterFetchHour),
            minute: newsletterFetchMinute,
          },
          webcrawlFetch: data.webcrawlFetch ? {
            ...data.webcrawlFetch,
            hour: utcToBerlin(data.webcrawlFetch.hour),
          } : DEFAULT_SCHEDULE.webcrawlFetch,
          dailyAnalysis: {
            ...data.dailyAnalysis,
            hour: utcToBerlin(data.dailyAnalysis.hour),
          },
          postGeneration: {
            ...data.postGeneration,
            hour: utcToBerlin(data.postGeneration.hour),
          },
          newsletterSend: data.newsletterSend ? {
            ...data.newsletterSend,
            hour: utcToBerlin(data.newsletterSend.hour),
          } : DEFAULT_SCHEDULE.newsletterSend,
        })
      }
    } catch (err) {
      console.error('Failed to fetch schedule:', err)
    } finally {
      setScheduleLoading(false)
    }
  }

  async function saveSchedule() {
    setSavingSchedule(true)
    setScheduleSuccess(false)
    try {
      const utcSchedule: ScheduleConfig = {
        newsletterFetch: { ...schedule.newsletterFetch, hour: berlinToUtc(schedule.newsletterFetch.hour) },
        webcrawlFetch: { ...schedule.webcrawlFetch, hour: berlinToUtc(schedule.webcrawlFetch.hour) },
        dailyAnalysis: { ...schedule.dailyAnalysis, hour: berlinToUtc(schedule.dailyAnalysis.hour) },
        postGeneration: { ...schedule.postGeneration, hour: berlinToUtc(schedule.postGeneration.hour) },
        newsletterSend: { ...schedule.newsletterSend, hour: berlinToUtc(schedule.newsletterSend.hour) },
      }
      const response = await fetch('/api/admin/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(utcSchedule),
      })
      if (response.ok) {
        setScheduleSuccess(true)
        setTimeout(() => setScheduleSuccess(false), 3000)
      }
    } catch (err) {
      console.error('Failed to save schedule:', err)
    } finally {
      setSavingSchedule(false)
    }
  }

  async function triggerScheduledTasks() {
    setTriggeringSchedule(true)
    setTriggerResult(null)
    try {
      const response = await fetch('/api/admin/trigger-schedule', { method: 'POST' })
      const data = await response.json()
      if (response.ok && data.success) {
        const results = data.results || {}
        const statusLabels: Record<string, string> = {
          'completed': '✓ Fertig',
          'triggered': '✓ Gestartet',
          'skipped': '⏭ Übersprungen',
          'already_ran': '⏭ Bereits gelaufen',
          'not_scheduled': '○ Nicht geplant',
          'error': '✗ Fehler',
          'no_post': '○ Kein Post',
        }
        const taskLabels: Record<string, string> = {
          'newsletterFetch': 'Newsletter Abruf',
          'webcrawlFetch': 'WebCrawl Abruf',
          'dailyAnalysis': 'News & Synthese',
          'postGeneration': 'Post Generierung',
          'newsletterSend': 'Newsletter Versand',
        }
        const details: Record<string, string> = {}
        for (const [task, status] of Object.entries(results)) {
          if (taskLabels[task]) {
            details[taskLabels[task]] = statusLabels[status as string] || String(status)
          }
        }
        setTriggerResult({
          success: true,
          message: data.currentTime ? `Ausgeführt um ${data.currentTime}` : 'Tasks ausgeführt',
          details,
        })
      } else {
        setTriggerResult({ success: false, message: data.error || 'Fehler beim Ausführen der Tasks' })
      }
    } catch {
      setTriggerResult({ success: false, message: 'Netzwerkfehler beim Triggern der Tasks' })
    } finally {
      setTriggeringSchedule(false)
      setTimeout(() => setTriggerResult(null), 15000)
    }
  }

  function handleConnectGmail() {
    window.location.href = '/api/gmail/authorize'
  }

  // Get models available for a specific use case
  function getModelsForUseCase(useCaseKey: string): ModelInfo[] {
    const info = USE_CASE_DEFINITIONS[useCaseKey]
    if (!info) return []
    return availableModels.filter(m => info.allowedProviders.includes(m.provider))
  }

  // --- Render ---

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter">Einstellungen</h1>
        <p className="mt-1 text-muted-foreground">
          Allgemeine Konfiguration der Newsletter-Aggregation
        </p>
      </div>

      {/* Success/Error Messages */}
      {success === 'gmail_connected' && (
        <Alert className="mb-6 border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            Gmail wurde erfolgreich verbunden!
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert className="mb-6 border-red-500 bg-red-50 dark:bg-red-950">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700 dark:text-red-300">
            {error === 'oauth_denied' && 'Die Gmail-Autorisierung wurde abgelehnt.'}
            {error === 'no_code' && 'Kein Autorisierungscode erhalten.'}
            {error === 'no_refresh_token' && 'Kein Refresh-Token erhalten. Bitte erneut verbinden.'}
            {error === 'db_error' && 'Fehler beim Speichern der Verbindung.'}
            {error === 'token_exchange_failed' && 'Fehler beim Token-Austausch.'}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="models" className="space-y-6">
        <TabsList>
          <TabsTrigger value="models" className="gap-1.5">
            <Cpu className="h-4 w-4" />
            KI-Modelle
          </TabsTrigger>
          <TabsTrigger value="schedule" className="gap-1.5">
            <Clock className="h-4 w-4" />
            Zeitplan
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Verbindungen
          </TabsTrigger>
        </TabsList>

        {/* ========== KI-Modelle Tab ========== */}
        <TabsContent value="models">
          <div className="space-y-6">
            {/* API Key Status */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">API-Verbindungen</CardTitle>
                  <Button variant="outline" size="sm" onClick={testApiKeys} disabled={testingKeys}>
                    {testingKeys ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Keys testen
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {keyTestResults && (
                  <div className="space-y-2">
                    {(['anthropic', 'google', 'openai'] as const).map(provider => {
                      const result = keyTestResults[provider]
                      const labels: Record<string, string> = {
                        anthropic: 'Anthropic (Claude)',
                        google: 'Google (Gemini)',
                        openai: 'OpenAI (GPT)',
                      }
                      return (
                        <div key={provider}>
                          <div className="flex items-center gap-2">
                            {result.valid ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : result.error === 'API key not configured' ? (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            )}
                            <span className="text-sm">{labels[provider]}</span>
                            {result.valid ? (
                              <Badge variant="outline" className="text-green-600 border-green-300">OK</Badge>
                            ) : result.lastChars ? (
                              <Badge variant="destructive" className="text-xs">Fehler (Key ...{result.lastChars})</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Nicht konfiguriert</Badge>
                            )}
                          </div>
                          {result.error && result.error !== 'API key not configured' && (
                            <p className="text-xs text-destructive ml-6">{result.error}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {!keyTestResults && (
                  <p className="text-sm text-muted-foreground">
                    Klicke &quot;Keys testen&quot; um den Status der API-Verbindungen zu prüfen.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Model Selection per Use Case */}
            {modelsLoading ? (
              <Card>
                <CardContent className="py-8">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Lade verfügbare Modelle...</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {USE_CASE_GROUPS.map(group => (
                  <Card key={group.title}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{group.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {group.useCases.map(useCaseKey => {
                        const info = USE_CASE_DEFINITIONS[useCaseKey]
                        if (!info) return null
                        const models = getModelsForUseCase(useCaseKey)
                        const currentModel = modelConfig[useCaseKey] || info.defaultModel

                        return (
                          <div key={useCaseKey} className="flex items-center justify-between gap-4 py-2 border-b last:border-0">
                            <div className="min-w-0">
                              <Label className="text-sm font-medium">{info.label}</Label>
                              <p className="text-xs text-muted-foreground">{info.description}</p>
                            </div>
                            <Select
                              value={currentModel}
                              onValueChange={(value) =>
                                setModelConfig(prev => ({ ...prev, [useCaseKey]: value }))
                              }
                            >
                              <SelectTrigger className="w-[320px] shrink-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {models.map(model => {
                                  const pricing = formatPricing(model)
                                  return (
                                    <SelectItem key={model.id} value={model.id}>
                                      <span className="flex items-center gap-2">
                                        {model.name}
                                        {pricing && (
                                          <span className="text-xs text-muted-foreground">
                                            {pricing}
                                          </span>
                                        )}
                                      </span>
                                    </SelectItem>
                                  )
                                })}
                                {models.length === 0 && (
                                  <SelectItem value={info.defaultModel} disabled>
                                    Keine Modelle verfügbar
                                  </SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                ))}

                {/* Translation — Link to Languages page */}
                <Card>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">Übersetzung</Label>
                        <p className="text-xs text-muted-foreground">
                          Modell-Auswahl pro Sprache in der Sprachverwaltung
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/admin/languages">
                          Sprachen verwalten
                          <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Save Button + Pricing Freshness */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Button onClick={saveModelConfiguration} disabled={savingModels}>
                      {savingModels ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Modelle speichern
                    </Button>
                    {modelsSaved && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Gespeichert
                      </span>
                    )}
                  </div>
                  {pricingLastUpdated && (() => {
                    const daysSince = Math.floor((Date.now() - new Date(pricingLastUpdated).getTime()) / 86400000)
                    const isStale = daysSince > 30
                    return (
                      <span className={`text-xs flex items-center gap-1 ${isStale ? 'text-orange-500' : 'text-muted-foreground'}`}>
                        {isStale && <AlertTriangle className="h-3 w-3" />}
                        Preise aktualisiert: {new Date(pricingLastUpdated).toLocaleDateString('de-DE')}
                        {isStale && ` (${daysSince} Tage)`}
                      </span>
                    )
                  })()}
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* ========== Zeitplan Tab ========== */}
        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Zeitplan
              </CardTitle>
              <CardDescription>
                Wann sollen Newsletter abgerufen, analysiert und Blogposts generiert werden?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {scheduleLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Lade Zeitplan...</span>
                </div>
              ) : (
                <>
                  <ScheduleRow
                    label="Daily Repo Crawl"
                    description="Wann sollen Newsletter und WebCrawl-Artikel abgerufen werden?"
                    config={schedule.newsletterFetch}
                    onChange={(config) => setSchedule({ ...schedule, newsletterFetch: config })}
                  />
                  <ScheduleRow
                    label="WebCrawl Abruf"
                    description="Wann sollen WebCrawl-Artikel aus Gmail abgerufen werden?"
                    config={schedule.webcrawlFetch}
                    onChange={(config) => setSchedule({ ...schedule, webcrawlFetch: config })}
                  />
                  <ScheduleRow
                    label="News & Synthese Erstellung"
                    description="Wann soll der Digest generiert werden?"
                    config={schedule.dailyAnalysis}
                    onChange={(config) => setSchedule({ ...schedule, dailyAnalysis: config })}
                  />
                  <ScheduleRow
                    label={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Artikel erstellen</span>}
                    description="Wann soll aus dem Digest ein Blogpost mit Bildern generiert werden?"
                    config={schedule.postGeneration}
                    onChange={(config) => setSchedule({ ...schedule, postGeneration: config })}
                  />
                  <ScheduleRow
                    label={<span className="flex items-center gap-2"><Mail className="h-4 w-4" /> Newsletter-Versand</span>}
                    description="Wann soll der Newsletter an Subscriber versendet werden?"
                    config={schedule.newsletterSend}
                    onChange={(config) => setSchedule({ ...schedule, newsletterSend: config })}
                  />

                  {/* Save Button */}
                  <div className="flex items-center gap-4">
                    <Button onClick={saveSchedule} disabled={savingSchedule}>
                      {savingSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Zeitplan speichern
                    </Button>
                    {scheduleSuccess && (
                      <span className="text-sm text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Gespeichert
                      </span>
                    )}
                  </div>

                  {/* Manual Trigger */}
                  <div className="mt-6 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-base">Manuell ausführen</Label>
                        <p className="text-sm text-muted-foreground">
                          Alle aktivierten Tasks jetzt ausführen (überspringt Zeitplan)
                        </p>
                      </div>
                      <Button variant="outline" onClick={triggerScheduledTasks} disabled={triggeringSchedule}>
                        {triggeringSchedule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        Jetzt ausführen
                      </Button>
                    </div>
                    {triggerResult && (
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-center gap-2 text-sm ${triggerResult.success ? 'text-green-600' : 'text-red-600'}`}>
                          {triggerResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          {triggerResult.message}
                        </div>
                        {triggerResult.details && Object.keys(triggerResult.details).length > 0 && (
                          <div className="rounded-md bg-muted p-3 text-xs space-y-1">
                            {Object.entries(triggerResult.details).map(([task, status]) => (
                              <div key={task} className="flex justify-between">
                                <span className="text-muted-foreground">{task}</span>
                                <span>{status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Hinweis: Zeiten in MEZ (Mitteleuropäische Zeit). Der Scheduler prüft alle 10 Minuten, ob ein Job ausgeführt werden soll.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== Verbindungen Tab ========== */}
        <TabsContent value="connections">
          <div className="space-y-6">
            {/* Gmail Connection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Gmail-Verbindung
                </CardTitle>
                <CardDescription>
                  Status der Gmail API Verbindung
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    {loading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Prüfe Verbindung...</span>
                      </div>
                    ) : gmailStatus?.connected ? (
                      <>
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <p className="text-sm font-medium text-green-600">Verbunden</p>
                        </div>
                        <p className="text-sm text-muted-foreground">{gmailStatus.email}</p>
                        {gmailStatus.messagesTotal && (
                          <p className="text-xs text-muted-foreground">
                            {gmailStatus.messagesTotal.toLocaleString()} E-Mails im Postfach
                          </p>
                        )}
                      </>
                    ) : gmailStatus?.error ? (
                      <>
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-orange-500" />
                          <p className="text-sm font-medium text-orange-600">Token abgelaufen</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {gmailStatus.email && `${gmailStatus.email} - `}
                          Bitte neu verbinden um fortzufahren
                        </p>
                        <p className="text-xs text-orange-600 mt-1">
                          Hinweis: Bei Google Cloud Apps im &quot;Testing&quot;-Modus läuft der Token nach 7 Tagen ab.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                          <p className="text-sm font-medium">Nicht verbunden</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Verbinde Gmail, um Newsletter automatisch zu sammeln
                        </p>
                      </>
                    )}
                  </div>
                  <Button
                    variant={gmailStatus?.connected ? 'outline' : 'default'}
                    onClick={handleConnectGmail}
                  >
                    {gmailStatus?.connected ? 'Neu verbinden' : 'Verbinden'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Benachrichtigungen
                </CardTitle>
                <CardDescription>
                  E-Mail-Benachrichtigungen für neue Digests
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>E-Mail-Benachrichtigungen</Label>
                    <p className="text-sm text-muted-foreground">
                      Erhalte eine E-Mail wenn ein neuer Digest erstellt wurde
                    </p>
                  </div>
                  <Switch />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notification-email">Benachrichtigungs-E-Mail</Label>
                  <Input
                    id="notification-email"
                    type="email"
                    placeholder="deine@email.de"
                  />
                </div>
                <Button>Einstellungen speichern</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- Schedule Row Sub-Component ---

function ScheduleRow({
  label,
  description,
  config,
  onChange,
}: {
  label: React.ReactNode
  description: string
  config: { enabled: boolean; hour: number; minute: number }
  onChange: (config: { enabled: boolean; hour: number; minute: number }) => void
}) {
  return (
    <div className="space-y-3 pb-4 border-b">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base">{label}</Label>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onChange({ ...config, enabled })}
        />
      </div>
      {config.enabled && (
        <div className="flex items-center gap-2">
          <Select
            value={config.hour.toString()}
            onValueChange={(value) => onChange({ ...config, hour: parseInt(value) })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((hour) => (
                <SelectItem key={hour} value={hour.toString()}>
                  {hour.toString().padStart(2, '0')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select
            value={config.minute.toString()}
            onValueChange={(value) => onChange({ ...config, minute: parseInt(value) })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((minute) => (
                <SelectItem key={minute} value={minute.toString()}>
                  {minute.toString().padStart(2, '0')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">Uhr (MEZ)</span>
        </div>
      )}
    </div>
  )
}
