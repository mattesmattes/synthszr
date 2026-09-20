'use client'

import { useCallback, useEffect, useState } from 'react'
import { Coins, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatModelLabel } from '@/lib/ai/model-pricing'

/**
 * Was die Modellaufrufe kosten, aufgeschlüsselt nach Job (Betreiber-Frage
 * 2026-09-20). Die Anthropic-Rechnung kennt nur Modell und Tag; welcher Job
 * dahintersteckt, steht ausschließlich hier.
 */
interface Bucket {
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  unpricedCalls: number
}
interface Report {
  days: number
  totalCostUsd: number
  totalCalls: number
  byUseCase: (Bucket & { useCase: string })[]
  byModel: (Bucket & { model: string })[]
  byDay: { day: string; costUsd: number; calls: number }[]
}

const usd = (n: number) => `${n.toFixed(2)} $`
const num = (n: number) => n.toLocaleString('de-DE')
const RANGES = [1, 7, 30]

export default function LlmCostsPage() {
  const [days, setDays] = useState(7)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (range: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/llm-usage?days=${range}`)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setReport(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days) }, [days, load])

  const perDay = report && report.byDay.length > 0 ? report.totalCostUsd / report.byDay.length : 0

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
            <Coins className="h-8 w-8" />
            KI-Kosten
          </h1>
          <p className="mt-1 text-muted-foreground">
            Token und Kosten je Modellaufruf, protokolliert seit dem 20.09.2026
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Button key={r} variant={r === days ? 'default' : 'outline'} size="sm" onClick={() => setDays(r)}>
              {r === 1 ? 'Heute' : `${r} Tage`}
            </Button>
          ))}
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lädt…</div>}
      {error && (
        <Card className="border-red-300">
          <CardContent className="pt-6 text-sm text-red-700">
            {error.includes('llm_usage') || error.includes('schema cache')
              ? 'Die Tabelle llm_usage fehlt noch — Migration supabase/migrations/20260920090000_llm_usage.sql einspielen.'
              : error}
          </CardContent>
        </Card>
      )}

      {report && !loading && !error && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Gesamt</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold">{usd(report.totalCostUsd)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ø pro Tag</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold">{usd(perDay)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Aufrufe</CardTitle></CardHeader>
              <CardContent><div className="text-3xl font-bold">{num(report.totalCalls)}</div></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nach Job</CardTitle>
              <CardDescription>Teuerster zuerst. Output enthält die Thinking-Token — bei Opus 5 meist der größte Posten.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table
                head={['Job', 'Kosten', 'Anteil', 'Aufrufe', 'Input', 'Output', 'Cache gelesen']}
                rows={report.byUseCase.map((u) => [
                  <span key="n" className="font-medium">{u.useCase}{u.unpricedCalls > 0 && <span className="ml-2 text-[10px] text-orange-600">{u.unpricedCalls} ohne Preis</span>}</span>,
                  usd(u.costUsd),
                  report.totalCostUsd > 0 ? `${Math.round((u.costUsd / report.totalCostUsd) * 100)} %` : '—',
                  num(u.calls), num(u.inputTokens), num(u.outputTokens), num(u.cacheReadTokens),
                ])}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Nach Modell</CardTitle></CardHeader>
              <CardContent>
                <Table
                  head={['Modell', 'Kosten', 'Aufrufe']}
                  rows={report.byModel.map((m) => [formatModelLabel(m.model), usd(m.costUsd), num(m.calls)])}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Nach Tag</CardTitle></CardHeader>
              <CardContent>
                <Table
                  head={['Tag', 'Kosten', 'Aufrufe']}
                  rows={report.byDay.map((d) => [d.day, usd(d.costUsd), num(d.calls)])}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch keine Aufrufe protokolliert.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            {head.map((h, i) => <th key={h} className={`pb-2 font-medium ${i === 0 ? '' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-b last:border-0">
              {cells.map((c, i) => (
                <td key={i} className={`py-2 ${i === 0 ? '' : 'text-right tabular-nums'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
