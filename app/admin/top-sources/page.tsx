'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Trophy } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Top sources (Betreiber 2026-11-12): welche Quellen am Ende tatsächlich als
 * Links hinter den Meldungen der veröffentlichten Posts stehen, gerankt nach
 * Zahl der Links. Rechnung: lib/admin/top-sources.ts.
 */
interface SourceRank { host: string; links: number; posts: number; lastUsed: string }
interface Report {
  days: number
  postCount: number
  totalLinks: number
  distinctSources: number
  firstPostAt: string | null
  sources: SourceRank[]
}

const RANGES = [30, 90, 365, 0] as const
const fmt = (n: number) => n.toLocaleString('de-DE')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default function TopSourcesPage() {
  const [days, setDays] = useState<number>(90)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (d: number) => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/admin/top-sources?days=${d}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setReport(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days) }, [days, load])

  const r = report
  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
            <Trophy className="h-8 w-8" />
            Top sources
          </h1>
          <p className="mt-1 text-muted-foreground">
            Die 50 Quellen, auf die die veröffentlichten Posts am häufigsten verlinken, gezählt je Domain
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((d) => (
            <Button key={d} variant={d === days ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)} disabled={loading}>
              {d === 0 ? 'Gesamt' : `${d} Tage`}
            </Button>
          ))}
        </div>
      </div>

      {loading && <div className="mb-4 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lädt…</div>}
      {error && (
        <Card className="mb-4 border-red-300">
          <CardContent className="pt-6 text-sm text-red-700">Fehler: {error}</CardContent>
        </Card>
      )}

      {r && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Veröffentlichte Posts" value={fmt(r.postCount)} />
            <Stat label="Links auf Quellen" value={fmt(r.totalLinks)} />
            <Stat label="Verschiedene Quellen" value={fmt(r.distinctSources)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ranking</CardTitle>
              <CardDescription>
                {r.days === 0 ? 'Alle veröffentlichten Posts' : `Posts der letzten ${r.days} Tage`}
                {r.firstPostAt ? ` (ab ${fmtDate(r.firstPostAt)})` : ''}. Jede URL zählt einmal je Post; interne Links zählen nicht.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {r.sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Quellen im Zeitraum.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">#</th>
                        <th className="pb-2 font-medium">Quelle</th>
                        <th className="pb-2 text-right font-medium">Links</th>
                        <th className="pb-2 text-right font-medium">Posts</th>
                        <th className="pb-2 text-right font-medium">Anteil Posts</th>
                        <th className="pb-2 text-right font-medium">Zuletzt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.sources.map((s, i) => (
                        <tr key={s.host} className="border-b last:border-0">
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="py-2">
                            <a href={`https://${s.host}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                              {s.host} <ExternalLink className="h-3 w-3 text-muted-foreground" />
                            </a>
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums">{fmt(s.links)}</td>
                          <td className="py-2 text-right tabular-nums">{fmt(s.posts)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {r.postCount > 0 ? `${Math.round((s.posts / r.postCount) * 100)} %` : '—'}
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{fmtDate(s.lastUsed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
