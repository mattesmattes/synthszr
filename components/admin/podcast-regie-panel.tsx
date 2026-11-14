'use client'

/**
 * Karte „Tagesregie“ im Podcast Studio (Betreiber 2026-11-15): macht sichtbar,
 * was sich von Folge zu Folge ändert. Die Stimmen selbst (Tonalität v2) sind
 * fest; die Tagesregie zieht je Folge Form, Temperatur, Stilmittel, Bildwelt,
 * Segment, Derbheit und Schluss, der Regisseur macht daraus einen Plan.
 * Daten: GET /api/admin/podcast-regie (nur lesend, die Vorschau speichert nichts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Compass, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { LabeledPicks, RegieOverview, RegieOverviewEntry } from '@/lib/podcast/regie/overview'

/** So viele Folgen zeigt die Karte zunächst; die Historie hält bis zu 21. */
const VISIBLE_DEFAULT = 5

interface Props {
  /** Im Podcast Studio ausgewählter Post: für ihn zeigt die Karte die Vorschau. */
  postId?: string
  /** Sprache der Podcast-Erzeugung (de oder andere → englisches Skript). */
  locale: string
  /** Ändert sich nach jeder Skript-Erzeugung, damit die Karte neu lädt. */
  refreshKey?: number
}

function formatDate(iso: string | null, fallback: string): string {
  const d = new Date(iso ?? `${fallback}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
}

function PicksGrid({ picks, names }: { picks: LabeledPicks; names: Array<{ id: string; name: string }> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      {names.map(({ id, name }) => {
        const values = picks[id as keyof LabeledPicks]
        if (!values?.length) return null
        return (
          <div key={id} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{values.join(', ')}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function EntryDetails({ entry, deviceLabel }: { entry: RegieOverviewEntry; deviceLabel: (id: string) => string }) {
  if (entry.legacy) {
    return <p className="text-xs text-muted-foreground">Vor dem 15.11.2026 erzeugt: nur die gezogenen Werte sind gespeichert.</p>
  }
  const fill = entry.fill
  const worn = entry.worn
  const hasWorn = !!worn && (worn.phrases.length > 0 || worn.shortLines.length > 0 || worn.directions.length > 0)
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium">Plan des Regisseurs</p>
        {fill ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {fill.fight && <li><span className="text-muted-foreground">Hauptstreit:</span> {fill.fight.story}: {fill.fight.conflict}</li>}
            {fill.rants.map((r, i) => (
              <li key={`r${i}`}><span className="text-muted-foreground">Emmas Ausbruch gegen {r.target}</span> ({r.story}): {r.charge}</li>
            ))}
            {fill.devicePlans.map((d, i) => (
              <li key={`d${i}`}><span className="text-muted-foreground">{deviceLabel(d.device)}:</span> {d.story}: {d.idea}</li>
            ))}
            {fill.quickStories.length > 0 && <li><span className="text-muted-foreground">Kurz abgehandelt:</span> {fill.quickStories.join('; ')}</li>}
            {fill.segmentPlan && <li><span className="text-muted-foreground">Vor dem Schluss:</span> {fill.segmentPlan}</li>}
          </ul>
        ) : (
          <p className="text-muted-foreground">Kein Plan: Der Regisseur-Aufruf lieferte nichts, das Skript lief mit der Regie ohne Ausgestaltung.</p>
        )}
      </div>
      <div>
        <p className="font-medium">Verbraucht (für diese Folge tabu)</p>
        {hasWorn ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {worn!.phrases.length > 0 && <li><span className="text-muted-foreground">Wendungen:</span> {worn!.phrases.map((p) => `„${p}“`).join(', ')}</li>}
            {worn!.shortLines.length > 0 && <li><span className="text-muted-foreground">Kurzzeilen:</span> {worn!.shortLines.map((p) => `„${p}“`).join(', ')}</li>}
            {worn!.directions.length > 0 && <li><span className="text-muted-foreground">Sprechanweisungen:</span> {worn!.directions.join(', ')}</li>}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nichts: In den letzten Folgen wiederholte sich keine Wendung oft genug.</p>
        )}
      </div>
      {entry.echoes.length > 0 && (
        <div>
          <p className="font-medium">Wörtlich aus dem Artikel (an den Texturdurchgang zum Umformulieren)</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {entry.echoes.map((e, i) => <li key={i}>„{e}“</li>)}
          </ul>
        </div>
      )}
      {entry.texture && !entry.texture.applied && entry.texture.problems.length > 0 && (
        <div>
          <p className="font-medium">Warum die Textur verworfen wurde</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {entry.texture.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export function PodcastRegiePanel({ postId, locale, refreshKey = 0 }: Props) {
  const lang = locale === 'de' ? 'de' : 'en'
  const [data, setData] = useState<RegieOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ lang })
      if (postId) params.set('postId', postId)
      const res = await fetch(`/api/admin/podcast-regie?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as RegieOverview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [lang, postId])

  useEffect(() => { void load() }, [load, refreshKey])

  const names = useMemo(() => (data?.axes ?? []).map((a) => ({ id: a.id, name: a.name })), [data])
  const deviceLabel = useCallback((id: string) => {
    const devices = data?.axes.find((a) => a.id === 'devices')
    return devices?.options.find((o) => o.id === id)?.label ?? id
  }, [data])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Compass className="h-5 w-5" />
              Tagesregie
            </CardTitle>
            <CardDescription className="mt-1.5">
              Die Stimmen sind fest (Tonalität v2). Was sich je Folge ändert, zieht die Tagesregie: Form, Temperatur, drei Stilmittel, zwei Bildwelten, Segment vor dem Schluss, Derbheit und Schluss. Was in den letzten Folgen dran war, ist eine Zeit lang gesperrt; seltener Genutztes hat Vorrang. Der Regisseur macht daraus mit den Meldungen des Tages einen Plan. Skript-Sprache: {lang === 'de' ? 'Deutsch' : 'Englisch'}.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="Tagesregie neu laden">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">Tagesregie nicht ladbar ({error}).</p>}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Nächste Folge</h3>
          {data?.preview ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                Vorschau für „{data.preview.title ?? data.preview.postId}“ (Ziehung für den {formatDate(null, data.preview.date)}). Die Vorschau speichert nichts; gespeichert wird erst beim Generieren des Skripts. Der Plan des Regisseurs entsteht dann mit.
              </p>
              <PicksGrid picks={data.preview.picks} names={names} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Wähle oben einen Post aus, dann steht hier, welche Regie die Folge bekäme.</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Letzte Folgen{data ? ` (${data.history.length})` : ''}</h3>
          {data && data.history.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Folge mit Tagesregie erzeugt.</p>
          )}
          <ul className="space-y-2">
            {(showAll ? data?.history : data?.history.slice(0, VISIBLE_DEFAULT))?.map((entry) => {
              const key = `${entry.postId}-${entry.date}`
              const isOpen = open === key
              return (
                <li key={key} className="rounded-md border">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 p-3 text-left"
                    onClick={() => setOpen(isOpen ? null : key)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{formatDate(entry.createdAt, entry.date)}</span>
                        <span className="truncate text-sm text-muted-foreground">{entry.title ?? `Post ${entry.postId.slice(0, 8)}`}</span>
                        {entry.directed !== null && (
                          <Badge variant={entry.directed ? 'secondary' : 'outline'}>{entry.directed ? 'mit Regisseur' : 'ohne Regisseur'}</Badge>
                        )}
                        {entry.texture && (
                          <Badge variant={entry.texture.applied ? 'secondary' : 'destructive'}>
                            {entry.texture.applied ? 'Textur übernommen' : 'Textur verworfen'}
                          </Badge>
                        )}
                      </div>
                      <PicksGrid picks={entry.picks} names={names} />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t px-3 pb-3 pt-2">
                      <EntryDetails entry={entry} deviceLabel={deviceLabel} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {data && data.history.length > VISIBLE_DEFAULT && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Weniger anzeigen' : `Alle ${data.history.length} anzeigen`}
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <button type="button" className="flex items-center gap-1 text-sm font-semibold" onClick={() => setShowCatalog((v) => !v)} aria-expanded={showCatalog}>
            {showCatalog ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Katalog: alle Optionen, Nutzung in den letzten 14 Folgen, Sperren
          </button>
          {showCatalog && data && (
            <div className="space-y-4">
              {data.axes.map((axis) => (
                <div key={axis.id} className="space-y-1">
                  <p className="text-sm font-medium">
                    {axis.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {axis.pick > 1 ? `${axis.pick} je Folge` : '1 je Folge'}{axis.cooldown > 0 ? `, danach ${axis.cooldown} ${axis.cooldown === 1 ? 'Folge' : 'Folgen'} gesperrt` : ', keine Sperre'}
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {axis.options.map((opt) => (
                      <li key={opt.id} className="text-sm">
                        <span className={opt.blocked ? 'text-muted-foreground line-through' : ''}>{opt.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{opt.uses}× zuletzt</span>
                        {opt.blocked && <Badge variant="outline" className="ml-2">gesperrt</Badge>}
                        {opt.weight > 1 && <Badge variant="outline" className="ml-2">häufiger ({opt.weight}×)</Badge>}
                        <p className="text-xs text-muted-foreground">{opt.text}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
