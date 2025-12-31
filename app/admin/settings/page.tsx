'use client'

import { useEffect, useState } from 'react'
import { Settings, Mail, Clock, Bell, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useSearchParams } from 'next/navigation'

interface GmailStatus {
  connected: boolean
  email: string | null
  messagesTotal?: number
  error?: string
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const success = searchParams.get('success')
  const error = searchParams.get('error')

  useEffect(() => {
    fetchGmailStatus()
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

  function handleConnectGmail() {
    window.location.href = '/api/gmail/authorize'
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
              Wann sollen Newsletter abgerufen und analysiert werden?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Newsletter-Abruf</Label>
                <p className="text-sm text-muted-foreground">Alle 6 Stunden</p>
              </div>
              <code className="rounded bg-secondary px-2 py-1 text-sm">0 */6 * * *</code>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Tägliche Analyse</Label>
                <p className="text-sm text-muted-foreground">Täglich um 8:00 Uhr</p>
              </div>
              <code className="rounded bg-secondary px-2 py-1 text-sm">0 8 * * *</code>
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
    </div>
  )
}
