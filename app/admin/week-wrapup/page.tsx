'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CalendarRange, AlertCircle } from 'lucide-react'

/**
 * AI-Week Wrap-up: fasst die „Thema des Tages"-Nachrichten der letzten
 * abgeschlossenen Woche zu einem Post zusammen.
 *
 * Bewusst KEINE Kopie von create-article/page.tsx (über 1.000 Zeilen): die
 * gesamte Queue-Auswahl entfällt, weil die Themen durch den Zeitraum
 * feststehen. Es bleibt ein Knopf.
 */
export default function WeekWrapupPage() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    postId: string
    title: string
    topicCount: number
    weekLabel: string
    weekdays: string[]
  } | null>(null)

  async function generate() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/week-wrapup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarRange className="h-6 w-6" />
          AI-Week Wrap-up
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fasst die „Thema des Tages"-Nachrichten der letzten abgeschlossenen Woche
          (Montag bis Sonnabend) zu einem Rückblick zusammen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rückblick erzeugen</CardTitle>
          <CardDescription className="text-xs">
            Ein Modell-Aufruf über alle Themen der Woche — die Abschnitte werden neu
            formuliert, aufeinander bezogen und mit einem kurzen Vorlauf versehen.
            Das Ergebnis ist ein Entwurf, den du vor dem Veröffentlichen prüfst.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={generate} disabled={running}>
            {running
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <CalendarRange className="mr-2 h-4 w-4" />}
            {running ? 'Erzeuge Rückblick…' : 'Wrap-up erzeugen'}
          </Button>

          {/* Der Aufruf laeuft synchron, anders als der Tagesartikel. Ohne diesen
              Hinweis wirkt eine Minute Wartezeit wie ein Haenger. */}
          {running && (
            <p className="text-xs text-muted-foreground">
              Das dauert etwa eine Minute. Das Fenster muss so lange offen bleiben.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{result.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.topicCount} {result.topicCount === 1 ? 'Thema' : 'Themen'} zusammengefasst
                {result.weekdays?.length ? ` (${result.weekdays.join(', ')})` : ''}.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => router.push(`/admin/generated-articles/edit/${result.postId}`)}
              >
                Im Editor öffnen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
