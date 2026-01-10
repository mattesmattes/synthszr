'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp,
  Loader2,
  Search,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Calendar,
  Info,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { PremarketItem, PremarketApiResponse, PremarketPagination } from '@/lib/premarket/types'

const RATING_COLORS: Record<string, string> = {
  BUY: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  HOLD: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  SELL: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const TREND_ICONS: Record<string, React.ReactNode> = {
  RISING: <ArrowUpRight className="h-4 w-4 text-green-600" />,
  STABLE: <Minus className="h-4 w-4 text-yellow-600" />,
  DECLINING: <ArrowDownRight className="h-4 w-4 text-red-600" />,
}

const ITEMS_PER_PAGE = 25

export default function PremarketPage() {
  const [items, setItems] = useState<PremarketItem[]>([])
  const [pagination, setPagination] = useState<PremarketPagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [withSynthesis, setWithSynthesis] = useState(true)
  const [offset, setOffset] = useState(0)
  const [selectedItem, setSelectedItem] = useState<PremarketItem | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (withSynthesis) params.set('withSynthesis', 'true')
      params.set('limit', String(ITEMS_PER_PAGE))
      params.set('offset', String(offset))

      const res = await fetch(`/api/premarket?${params}`, { credentials: 'include' })
      const data: PremarketApiResponse = await res.json()

      if (!data.ok) {
        setError(data.error || 'Unbekannter Fehler')
        setItems([])
        setPagination(null)
      } else {
        setItems(data.data || [])
        setPagination(data.pagination || null)
      }
    } catch (err) {
      console.error('[premarket] Fetch error:', err)
      setError('Netzwerkfehler beim Laden der Daten')
      setItems([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [search, withSynthesis, offset])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Reset offset when search or filter changes
  useEffect(() => {
    setOffset(0)
  }, [search, withSynthesis])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setOffset(0)
      fetchData()
    }
  }

  const currentPage = Math.floor(offset / ITEMS_PER_PAGE) + 1
  const totalPages = pagination ? Math.ceil(pagination.total / ITEMS_PER_PAGE) : 1

  return (
    <div className="p-4 md:p-8 max-w-full overflow-x-hidden">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter flex items-center gap-3">
          <TrendingUp className="h-8 w-8" />
          Premarket AI Synthesen
        </h1>
        <p className="mt-1 text-muted-foreground">
          AI-generierte Analysen für Pre-IPO & Private Market Instrumente von Forge Global
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Suche nach Name, Symbol, ISIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="with-synthesis"
                checked={withSynthesis}
                onCheckedChange={setWithSynthesis}
              />
              <Label htmlFor="with-synthesis" className="text-sm cursor-pointer">
                Nur mit AI-Synthese
              </Label>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Aktualisieren
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Fehler</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Keine Ergebnisse
            </CardTitle>
            <CardDescription>
              {search
                ? `Keine Premarket-Instrumente für "${search}" gefunden.`
                : withSynthesis
                  ? 'Keine Instrumente mit AI-Synthese gefunden.'
                  : 'Keine Premarket-Instrumente gefunden.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* Stats */}
          <div className="mb-4 text-sm text-muted-foreground">
            {pagination?.total ?? items.length} Instrumente gefunden
            {pagination && pagination.total > ITEMS_PER_PAGE && (
              <span className="ml-2">
                (Seite {currentPage} von {totalPages})
              </span>
            )}
          </div>

          {/* Items Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Card
                key={item.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedItem(item)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">
                        {item.instrument.name || item.premarket.name}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.instrument.symbol && (
                          <span className="font-mono">{item.instrument.symbol}</span>
                        )}
                        {item.instrument.symbol && item.instrument.isin && ' · '}
                        {item.instrument.isin && (
                          <span className="font-mono">{item.instrument.isin}</span>
                        )}
                      </p>
                    </div>
                    {item.synthesis?.rating && (
                      <Badge className={RATING_COLORS[item.synthesis.rating]}>
                        {item.synthesis.rating}
                      </Badge>
                    )}
                  </div>

                  {item.latestPrice !== null && (
                    <p className="text-lg font-semibold mb-2">
                      {item.latestPrice.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: item.instrument.currency || 'USD',
                      })}
                    </p>
                  )}

                  {item.synthesis && (
                    <div className="space-y-2">
                      {item.synthesis.rationale && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {item.synthesis.rationale}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.synthesis.googleTrends && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs gap-1">
                                  {TREND_ICONS[item.synthesis.googleTrends.trend_direction]}
                                  Trend
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{item.synthesis.googleTrends.trend_summary}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {item.synthesis.updatedAt && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(item.synthesis.updatedAt).toLocaleDateString('de-DE')}
                          </Badge>
                        )}
                        {item.synthesis.model && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Sparkles className="h-3 w-3" />
                            {item.synthesis.model}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {!item.synthesis && (
                    <p className="text-sm text-muted-foreground italic">
                      Keine AI-Synthese verfügbar
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.total > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(Math.max(0, offset - ITEMS_PER_PAGE))}
                disabled={offset === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Zurück
              </Button>
              <span className="text-sm text-muted-foreground px-4">
                Seite {currentPage} von {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(offset + ITEMS_PER_PAGE)}
                disabled={!pagination.hasMore}
              >
                Weiter
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedItem && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedItem.instrument.name || selectedItem.premarket.name}
                  {selectedItem.synthesis?.rating && (
                    <Badge className={RATING_COLORS[selectedItem.synthesis.rating]}>
                      {selectedItem.synthesis.rating}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {selectedItem.instrument.symbol && (
                    <span className="font-mono">{selectedItem.instrument.symbol}</span>
                  )}
                  {selectedItem.instrument.symbol && ' · '}
                  <span className="font-mono">{selectedItem.instrument.isin}</span>
                  {' · '}
                  {selectedItem.premarket.name}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* Price */}
                {selectedItem.latestPrice !== null && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Aktueller Kurs</h4>
                    <p className="text-2xl font-bold">
                      {selectedItem.latestPrice.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: selectedItem.instrument.currency || 'USD',
                      })}
                    </p>
                  </div>
                )}

                {selectedItem.synthesis ? (
                  <>
                    {/* Rationale */}
                    {selectedItem.synthesis.rationale && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Begründung</h4>
                        <p className="text-sm">{selectedItem.synthesis.rationale}</p>
                      </div>
                    )}

                    {/* Key Takeaways */}
                    {selectedItem.synthesis.keyTakeaways.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Key Takeaways</h4>
                        <ul className="space-y-2">
                          {selectedItem.synthesis.keyTakeaways.map((takeaway, i) => (
                            <li key={i} className="text-sm flex gap-2">
                              <span className="text-primary font-mono">{i + 1}.</span>
                              {takeaway}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Action Ideas */}
                    {selectedItem.synthesis.actionIdeas.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Action Ideas</h4>
                        <div className="space-y-3">
                          {selectedItem.synthesis.actionIdeas.map((idea, i) => (
                            <div key={i} className="border rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge className={RATING_COLORS[idea.rating]}>{idea.rating}</Badge>
                                {idea.time_horizon_months && (
                                  <span className="text-xs text-muted-foreground">
                                    {idea.time_horizon_months} Monate
                                  </span>
                                )}
                              </div>
                              <p className="text-sm">{idea.thesis}</p>
                              {idea.risk_flags && idea.risk_flags.length > 0 && (
                                <div className="flex gap-1 mt-2 flex-wrap">
                                  {idea.risk_flags.map((flag, j) => (
                                    <Badge key={j} variant="outline" className="text-xs">
                                      {flag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Contrarian Insights */}
                    {selectedItem.synthesis.contrarianInsights.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Contrarian Insights</h4>
                        <ul className="space-y-2">
                          {selectedItem.synthesis.contrarianInsights.map((insight, i) => (
                            <li key={i} className="text-sm flex gap-2">
                              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                              {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Google Trends */}
                    {selectedItem.synthesis.googleTrends && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Google Trends</h4>
                        <div className="border rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            {TREND_ICONS[selectedItem.synthesis.googleTrends.trend_direction]}
                            <span className="font-medium">
                              {selectedItem.synthesis.googleTrends.trend_direction}
                            </span>
                          </div>
                          <p className="text-sm">{selectedItem.synthesis.googleTrends.trend_summary}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Peak: {selectedItem.synthesis.googleTrends.peak_interest_period}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Sources */}
                    {selectedItem.synthesis.sources.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">
                          Quellen ({selectedItem.synthesis.sources.length})
                        </h4>
                        <ul className="space-y-1">
                          {selectedItem.synthesis.sources.map((source, i) => (
                            <li key={i}>
                              <a
                                href={source}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-primary hover:underline flex items-center gap-1 truncate"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                {source.replace(/^https?:\/\//, '').slice(0, 60)}
                                {source.length > 60 && '...'}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Meta Info */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                      {selectedItem.synthesis.model && (
                        <span className="flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {selectedItem.synthesis.model}
                        </span>
                      )}
                      {selectedItem.synthesis.updatedAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(selectedItem.synthesis.updatedAt).toLocaleString('de-DE')}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    <TrendingUp className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>Keine AI-Synthese für dieses Instrument verfügbar.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
