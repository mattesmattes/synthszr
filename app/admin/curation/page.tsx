'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type {
  ArchiveMeta,
  CurationTier,
  Critique,
  RunLogEntry,
  RunMetrics,
  RunRow,
  RunSummary,
  UnitOutcome,
  UnitRow,
} from '@/lib/curation/types'

/**
 * Detail-Antwort der API: `brief` kommt gekuerzt (nur `meta`/`precedentIds`,
 * die Texte sind weg — Payload-Groesse, app/api/admin/curation/runs/route.ts),
 * `pool`/`cards` fehlen ganz, `log` bleibt (fuer das Protokoll unten).
 */
type ReducedBrief = { meta: ArchiveMeta; precedentIds: Record<string, string> }
type DetailRun = Omit<RunRow, 'pool' | 'cards' | 'brief'> & { brief: ReducedBrief | null }
interface Detail { run: DetailRun; units: UnitRow[]; titles: Record<string, string> }

const TIER_GROUPS: Array<{ tier: CurationTier; label: string }> = [
  { tier: 'recommended', label: 'Setzliste' },
  { tier: 'bench', label: 'Bank' },
  { tier: 'held', label: 'Zurückgestellt' },
]

const OUTCOME_LABEL: Record<UnitOutcome, string> = {
  kept: 'Behalten',
  relabeled: 'Umetikettiert',
  merged: 'Zusammengeführt',
  dropped_after_selection: 'Verworfen (nach Auswahl)',
  dropped_never_selected: 'Nie ausgewählt',
  added: 'Zugabe',
}
const OUTCOME_CLASS: Record<UnitOutcome, string> = {
  kept: 'border-green-300 bg-green-50 text-green-800',
  relabeled: 'border-blue-300 bg-blue-50 text-blue-800',
  merged: 'border-violet-300 bg-violet-50 text-violet-800',
  dropped_after_selection: 'border-red-300 bg-red-50 text-red-800',
  dropped_never_selected: 'border-gray-300 bg-gray-50 text-gray-600',
  added: 'border-amber-300 bg-amber-50 text-amber-800',
}

/** Erste 8 Zeichen einer ID als Platzhalter, wenn die Titel-Map keinen Titel kennt. */
const shortId = (id: string) => `${id.slice(0, 8)}…`
/** Zwei Dezimalstellen, „–" fuer null/undefined — wie im Brief verlangt (keine Prozent-Umrechnung). */
const num2 = (n: number | null | undefined) => (n == null ? '–' : n.toFixed(2))

export default function CurationAdminPage() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [errorRuns, setErrorRuns] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true)
    setErrorRuns(null)
    try {
      const res = await fetch('/api/admin/curation/runs?limit=30')
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      const body = await res.json()
      setRuns(body.runs)
    } catch (err) {
      setErrorRuns(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoadingRuns(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    setErrorDetail(null)
    try {
      const res = await fetch(`/api/admin/curation/runs?id=${id}`)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setDetail(await res.json())
    } catch (err) {
      setErrorDetail(err instanceof Error ? err.message : 'Unbekannter Fehler')
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => { loadRuns() }, [loadRuns])

  const select = (id: string) => {
    setSelectedId(id)
    loadDetail(id)
  }
  const refresh = () => {
    loadRuns()
    if (selectedId) loadDetail(selectedId)
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
            <ClipboardList className="h-8 w-8" />
            Morgenkonferenz
          </h1>
          <p className="mt-1 text-muted-foreground">
            Schatten-Läufe der Kurations-Engine — nur lesend, Phase 1
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Aktualisieren
        </Button>
      </div>

      {loadingRuns && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
        </div>
      )}
      {errorRuns && (
        <Card className="border-red-300">
          <CardContent className="pt-6 text-sm text-red-700">{errorRuns}</CardContent>
        </Card>
      )}

      {!loadingRuns && !errorRuns && (
        <div className="space-y-6">
          <RunsTable runs={runs} selectedId={selectedId} onSelect={select} />

          {loadingDetail && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lädt Detail…
            </div>
          )}
          {errorDetail && (
            <Card className="border-red-300">
              <CardContent className="pt-6 text-sm text-red-700">{errorDetail}</CardContent>
            </Card>
          )}
          {detail && !loadingDetail && !errorDetail && <RunDetail detail={detail} />}
        </div>
      )}
    </div>
  )
}

function RunsTable({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RunSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Läufe</CardTitle>
        <CardDescription>Zeile anklicken für Details.</CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Läufe.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Modus</TableHead>
                <TableHead>Status / Phase</TableHead>
                <TableHead>Degradiert</TableHead>
                <TableHead className="text-right">Kosten</TableHead>
                <TableHead className="text-right">Unit-Recall@20</TableHead>
                <TableHead>Attribution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  onClick={() => onSelect(run.id)}
                  className={`cursor-pointer ${run.id === selectedId ? 'bg-muted' : ''}`}
                >
                  <TableCell>{run.day}</TableCell>
                  <TableCell>{run.mode}</TableCell>
                  <TableCell>{run.status} / {run.phase}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {run.degraded.length === 0
                        ? <span className="text-muted-foreground">–</span>
                        : run.degraded.map((d) => (
                          <Badge key={d} variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">{d}</Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{run.spend_usd.toFixed(2)} $</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num2(run.metrics?.unit_recall_20)}
                    {run.metrics?.baseline_total_score_unit_recall_20 != null && (
                      <span className="ml-1 text-muted-foreground">
                        (Baseline {num2(run.metrics.baseline_total_score_unit_recall_20)})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{run.metrics?.attribution ?? '–'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/** Die acht KPI aus dem Brief, in der dort genannten Reihenfolge. */
function kpiItems(metrics: RunMetrics): Array<{ label: string; value: string }> {
  return [
    { label: 'Unit-Recall@20', value: num2(metrics.unit_recall_20) },
    { label: 'Setzlisten-Recall@10', value: num2(metrics.setzlisten_recall_10) },
    { label: 'Setzlisten-Precision@10', value: num2(metrics.setzlisten_precision_10) },
    { label: 'Dubletten-Rate (Setzliste)', value: num2(metrics.duplicate_rate_recommended) },
    { label: 'Streichquote', value: num2(metrics.cut_rate) },
    { label: 'Zugaben', value: String(metrics.additions) },
    { label: 'Zurückgestellt-Quote', value: num2(metrics.held_rate) },
    { label: 'Diff vs. total_score@20', value: num2(metrics.diff_vs_total_score_20) },
  ]
}

function RunDetail({ detail }: { detail: Detail }) {
  const { run, units, titles } = detail

  return (
    <div className="space-y-6">
      {run.status === 'error' && run.error_message?.startsWith('pool_small') && (
        <Card className="border-amber-300">
          <CardContent className="pt-6 text-sm text-amber-800">
            Konferenz ausgefallen — zu wenige Items im Tages-Pool ({run.error_message}).
          </CardContent>
        </Card>
      )}

      {run.metrics ? (
        <div className="grid gap-4 md:grid-cols-3">
          {kpiItems(run.metrics).map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{kpi.value}</div></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch keine Metriken — der Lauf ist noch nicht mit einem veröffentlichten Post abgeglichen.
        </p>
      )}

      {run.plan?.thesis && (
        <Card>
          <CardHeader><CardTitle className="text-base">These</CardTitle></CardHeader>
          <CardContent className="text-sm">{run.plan.thesis}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {TIER_GROUPS.map(({ tier, label }) => (
          <UnitGroup key={tier} label={label} units={units.filter((u) => u.tier === tier)} titles={titles} />
        ))}
      </div>

      <AdditionsCard units={units} titles={titles} />
      <CritiqueCard critique={run.critique} />

      {run.degraded.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Degradiert</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {run.degraded.map((d) => (
              <Badge key={d} variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">{d}</Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <LogCard log={run.log} />
    </div>
  )
}

function UnitGroup({ label, units, titles }: { label: string; units: UnitRow[]; titles: Record<string, string> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>{units.length} Einheiten</CardDescription>
      </CardHeader>
      <CardContent>
        {units.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Einheiten.</p>
        ) : (
          <div className="space-y-3">
            {units.map((unit) => (
              <div key={unit.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">#{unit.rank ?? '–'}</span>
                  <Badge variant="outline">{unit.role ?? 'ohne Label'}</Badge>
                  {unit.is_hand && (
                    <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800">Hand</Badge>
                  )}
                  {unit.outcome && (
                    <Badge variant="outline" className={OUTCOME_CLASS[unit.outcome]}>{OUTCOME_LABEL[unit.outcome]}</Badge>
                  )}
                </div>
                <div className="mt-1">
                  {unit.member_ids.map((id, i) => (
                    <span key={id} className={i === 0 ? 'font-medium' : 'ml-2 text-muted-foreground'}>
                      {titles[id] ?? shortId(id)}
                    </span>
                  ))}
                </div>
                {unit.reason && <p className="mt-1 text-muted-foreground">{unit.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Einheiten, die der Betreiber nachtraeglich im veroeffentlichten Post ergaenzt hat — der Lauf hat sie nicht vorgeschlagen. */
function AdditionsCard({ units, titles }: { units: UnitRow[]; titles: Record<string, string> }) {
  const added = units.filter((u) => u.outcome === 'added')
  if (added.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Zugaben des Betreibers</CardTitle>
        <CardDescription>Im veröffentlichten Post, aber nicht vom Lauf vorgeschlagen.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {added.map((unit) => (
            <li key={unit.id}>
              {unit.matched_heading ?? (unit.member_ids[0] ? (titles[unit.member_ids[0]] ?? shortId(unit.member_ids[0])) : '–')}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function CritiqueCard({ critique }: { critique: Critique | null }) {
  if (!critique) return null
  const total = critique.hard.length + critique.soft.length + critique.model_hard.length + critique.model_soft.length
  if (total === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Kritik</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <CritiqueList label="Hart (deterministisch)" items={critique.hard} tone="text-red-700" />
        <CritiqueList label="Weich (deterministisch)" items={critique.soft} tone="text-yellow-700" />
        <CritiqueList label="Hart (Modell)" items={critique.model_hard} tone="text-red-700" />
        <CritiqueList label="Weich (Modell)" items={critique.model_soft} tone="text-yellow-700" />
      </CardContent>
    </Card>
  )
}

function CritiqueList({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null
  return (
    <div className="text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className={`mt-1 list-disc space-y-0.5 pl-5 ${tone}`}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

function LogCard({ log }: { log: RunLogEntry[] }) {
  if (log.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Protokoll</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-1 font-mono text-xs">
          {log.map((entry, i) => (
            <li key={i} className={entry.ok ? '' : 'text-red-700'}>{entry.at} — {entry.text}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
