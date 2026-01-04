'use client'

import { useEffect, useState } from 'react'
import { Settings, Mail, Clock, Bell, CheckCircle, XCircle, Loader2, Save, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSearchParams } from 'next/navigation'

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
    // Legacy support for old format
    hours?: number[]
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

const DEFAULT_SCHEDULE: ScheduleConfig = {
  newsletterFetch: {
    enabled: true,
    hour: 6,
    minute: 0,
  },
  dailyAnalysis: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  postGeneration: {
    enabled: false,
    hour: 9,
    minute: 0,
  },
  newsletterSend: {
    enabled: false,
    hour: 9,
    minute: 30,
  },
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 10, 20, 30, 40, 50]

// Berlin timezone offset (simplified: +1 in winter, +2 in summer)
function getBerlinOffset(): number {
  const now = new Date()
  const jan = new Date(now.getFullYear(), 0, 1)
  const jul = new Date(now.getFullYear(), 6, 1)
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
  const isDST = now.getTimezoneOffset() < stdOffset
  // Berlin is UTC+1 (CET) or UTC+2 (CEST)
  return isDST ? 2 : 1
}

function utcToBerlin(hour: number): number {
  const offset = getBerlinOffset()
  return (hour + offset + 24) % 24
}

function berlinToUtc(hour: number): number {
  const offset = getBerlinOffset()
  return (hour - offset + 24) % 24
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleSuccess, setScheduleSuccess] = useState(false)

  const success = searchParams.get('success')
  const error = searchParams.get('error')

  useEffect(() => {
    fetchGmailStatus()
    fetchSchedule()
  }, [])

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
        // Convert UTC to Berlin time for display
        // Handle legacy format (hours array) by converting to single hour
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
    } catch (error) {
      console.error('Failed to fetch schedule:', error)
    } finally {
      setScheduleLoading(false)
    }
  }

  async function saveSchedule() {
    setSavingSchedule(true)
    setScheduleSuccess(false)
    try {
      // Convert Berlin time back to UTC for storage
      const utcSchedule: ScheduleConfig = {
        newsletterFetch: {
          ...schedule.newsletterFetch,
          hour: berlinToUtc(schedule.newsletterFetch.hour),
        },
        dailyAnalysis: {
          ...schedule.dailyAnalysis,
          hour: berlinToUtc(schedule.dailyAnalysis.hour),
        },
        postGeneration: {
          ...schedule.postGeneration,
          hour: berlinToUtc(schedule.postGeneration.hour),
        },
        newsletterSend: {
          ...schedule.newsletterSend,
          hour: berlinToUtc(schedule.newsletterSend.hour),
        },
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
    } catch (error) {
      console.error('Failed to save schedule:', error)
    } finally {
      setSavingSchedule(false)
    }
  }

  function handleConnectGmail() {
    window.location.href = '/api/gmail/authorize'
  }

  function formatTime(hour: number, minute: number): string {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`
  }

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
                    <p className="text-sm text-muted-foreground">
                      {gmailStatus.email}
                    </p>
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

        {/* Cron Schedule */}
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
                {/* Newsletter Fetch */}
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base">Daily Repo Crawl</Label>
                      <p className="text-sm text-muted-foreground">
                        Wann sollen Newsletter abgerufen werden?
                      </p>
                    </div>
                    <Switch
                      checked={schedule.newsletterFetch.enabled}
                      onCheckedChange={(enabled) =>
                        setSchedule({ ...schedule, newsletterFetch: { ...schedule.newsletterFetch, enabled } })
                      }
                    />
                  </div>
                  {schedule.newsletterFetch.enabled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={schedule.newsletterFetch.hour.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            newsletterFetch: { ...schedule.newsletterFetch, hour: parseInt(value) },
                          })
                        }
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
                        value={schedule.newsletterFetch.minute.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            newsletterFetch: { ...schedule.newsletterFetch, minute: parseInt(value) },
                          })
                        }
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

                {/* Daily Analysis */}
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base">News & Synthese Erstellung</Label>
                      <p className="text-sm text-muted-foreground">
                        Wann soll der Digest generiert werden?
                      </p>
                    </div>
                    <Switch
                      checked={schedule.dailyAnalysis.enabled}
                      onCheckedChange={(enabled) =>
                        setSchedule({ ...schedule, dailyAnalysis: { ...schedule.dailyAnalysis, enabled } })
                      }
                    />
                  </div>
                  {schedule.dailyAnalysis.enabled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={schedule.dailyAnalysis.hour.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            dailyAnalysis: { ...schedule.dailyAnalysis, hour: parseInt(value) },
                          })
                        }
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
                        value={schedule.dailyAnalysis.minute.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            dailyAnalysis: { ...schedule.dailyAnalysis, minute: parseInt(value) },
                          })
                        }
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

                {/* Post Generation */}
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        AI Artikel erstellen
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Wann soll aus dem Digest ein Blogpost mit Bildern generiert werden?
                      </p>
                    </div>
                    <Switch
                      checked={schedule.postGeneration.enabled}
                      onCheckedChange={(enabled) =>
                        setSchedule({ ...schedule, postGeneration: { ...schedule.postGeneration, enabled } })
                      }
                    />
                  </div>
                  {schedule.postGeneration.enabled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={schedule.postGeneration.hour.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            postGeneration: { ...schedule.postGeneration, hour: parseInt(value) },
                          })
                        }
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
                        value={schedule.postGeneration.minute.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            postGeneration: { ...schedule.postGeneration, minute: parseInt(value) },
                          })
                        }
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

                {/* Newsletter Send */}
                <div className="space-y-3 pb-4 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Newsletter-Versand
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Wann soll der Newsletter an Subscriber versendet werden?
                      </p>
                    </div>
                    <Switch
                      checked={schedule.newsletterSend.enabled}
                      onCheckedChange={(enabled) =>
                        setSchedule({ ...schedule, newsletterSend: { ...schedule.newsletterSend, enabled } })
                      }
                    />
                  </div>
                  {schedule.newsletterSend.enabled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={schedule.newsletterSend.hour.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            newsletterSend: { ...schedule.newsletterSend, hour: parseInt(value) },
                          })
                        }
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
                        value={schedule.newsletterSend.minute.toString()}
                        onValueChange={(value) =>
                          setSchedule({
                            ...schedule,
                            newsletterSend: { ...schedule.newsletterSend, minute: parseInt(value) },
                          })
                        }
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

                {/* Save Button */}
                <div className="flex items-center gap-4">
                  <Button onClick={saveSchedule} disabled={savingSchedule}>
                    {savingSchedule ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Zeitplan speichern
                  </Button>
                  {scheduleSuccess && (
                    <span className="text-sm text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" />
                      Gespeichert
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-4">
                  Hinweis: Zeiten in MEZ (Mitteleuropäische Zeit). Der Scheduler prüft alle 10 Minuten, ob ein Job ausgeführt werden soll.
                </p>
              </>
            )}
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
    </div>
  )
}
