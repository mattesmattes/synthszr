import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, ExternalLink, Sparkles } from 'lucide-react'
import type { MomentumMapData, MomentumMover } from '@/lib/rankings/momentum-map'

function fmtDelta(m: MomentumMover, de: boolean): string {
  if (m.deltaPct === null) return de ? 'NEU' : 'NEW'
  const sign = m.deltaPct > 0 ? '+' : ''
  return `${sign}${m.deltaPct}%`
}

function MoverCard({
  mover,
  locale,
  kind,
}: {
  mover: MomentumMover
  locale: string
  kind: 'riser' | 'new' | 'faller'
}) {
  const de = locale === 'de'
  const badgeClass =
    kind === 'riser'
      ? 'bg-[#CCFF00] text-black border-black/20'
      : kind === 'new'
        ? 'bg-foreground text-background border-foreground'
        : 'bg-secondary text-foreground border-border'

  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/${locale}/rankings/${mover.slug}`}
              className="text-lg font-bold tracking-tight hover:underline underline-offset-4"
            >
              {mover.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{mover.vendor}</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
              {mover.categoryName}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {de
              ? `30-Tage-Schnitt: ${mover.prev30Avg} → ${mover.curr30Avg} (${mover.deltaAbs >= 0 ? '+' : ''}${mover.deltaAbs} Momentum) · aktuell ${mover.currentMomentum}`
              : `30-day avg: ${mover.prev30Avg} → ${mover.curr30Avg} (${mover.deltaAbs >= 0 ? '+' : ''}${mover.deltaAbs} momentum) · now ${mover.currentMomentum}`}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs font-bold ${badgeClass}`}>
          {kind === 'riser' && <ArrowUpRight className="h-3.5 w-3.5" />}
          {kind === 'new' && <Sparkles className="h-3 w-3" />}
          {kind === 'faller' && <ArrowDownRight className="h-3.5 w-3.5" />}
          {fmtDelta(mover, de)}
        </span>
      </div>

      {mover.evidence.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {de ? 'Belege aus den News (letzte 30 Tage)' : 'News evidence (last 30 days)'}
          </p>
          <ul className="space-y-2.5">
            {mover.evidence.map((ev, idx) => (
              <li key={idx} className="text-sm leading-relaxed">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {ev.date && <span className="font-mono text-[11px] text-muted-foreground">{ev.date}</span>}
                  {ev.url ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                    >
                      <span>{ev.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="font-medium text-foreground">{ev.title}</span>
                  )}
                </div>
                {ev.excerpt && ev.excerpt !== ev.title && (
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">“{ev.excerpt}”</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

export function MomentumMapArticle({ data, locale }: { data: MomentumMapData; locale: string }) {
  const de = locale === 'de'
  const { monthlyReport } = data
  const topRiser = monthlyReport.risers[0]
  const topNew = monthlyReport.newEntrants[0]
  const topFaller = monthlyReport.fallers[0]

  return (
    <section
      aria-labelledby="momentum-monthly-report"
      className="mx-auto mt-14 max-w-[960px] border-t-2 border-foreground pt-10 print:hidden"
    >
      {/* Editorial Header */}
      <header className="mb-8">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {data.issueCode} · {data.monthLabel} · {monthlyReport.previousPeriodLabel} → {monthlyReport.currentPeriodLabel}
        </p>
        <h1 id="momentum-monthly-report" className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {de
            ? `Monatsanalyse ${data.monthLabel}: Die größten Verschiebungen im KI-Momentum`
            : `Monthly Analysis ${data.monthLabel}: Biggest Shifts in AI Product Momentum`}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-foreground/85">
          {de ? (
            <>
              Für die <strong>SYNTHSZR MOMENTUM MAP · {data.monthLabel}</strong> haben wir{' '}
              <strong>{data.totalArticles90d.toLocaleString('de-DE')} Artikel</strong> aus{' '}
              <strong>{data.totalNewsSources} kuratierten News-Quellen</strong> ({data.totalMentions90d.toLocaleString('de-DE')}{' '}
              Produkt-Erwähnungen in 90 Tagen) ausgewertet. Der Monatsvergleich ({monthlyReport.currentPeriodLabel} gegenüber{' '}
              {monthlyReport.previousPeriodLabel}) zeigt, welche KI-Produkte durch konkrete Releases, Benchmarks oder Plattform-Shifts
              massiv an Aufmerksamkeit gewonnen haben — und wo der Post-Launch-Hype wieder abkühlt.
            </>
          ) : (
            <>
              For <strong>SYNTHSZR MOMENTUM MAP · {data.monthLabel}</strong>, we analyzed{' '}
              <strong>{data.totalArticles90d.toLocaleString('en-US')} articles</strong> across{' '}
              <strong>{data.totalNewsSources} curated news sources</strong> ({data.totalMentions90d.toLocaleString('en-US')}{' '}
              product mentions over 90 days). Comparing the last 30 days ({monthlyReport.currentPeriodLabel}) against the prior
              30-day window ({monthlyReport.previousPeriodLabel}) reveals which AI products surged on real launches and platform
              shifts — and where post-launch hype is cooling down.
            </>
          )}
        </p>

        {/* Synthszr Take Executive Summary */}
        <div className="mt-5 rounded-md border border-foreground/15 bg-secondary/40 p-4 text-sm leading-relaxed">
          <span className="mr-2 inline-block bg-[#CCFF00] px-1.5 py-0.5 font-mono text-xs font-bold uppercase tracking-wide text-black">
            SYNTHSZR TAKE:
          </span>
          {de ? (
            <>
              <strong>{data.heroTop12[0]?.name}</strong> und <strong>{data.heroTop12[1]?.name}</strong> zementieren die Dominanz der
              Coding-Agenten an der Weltspitze. Die stärkste Aufwärtsdynamik im Monatsvergleich liefert{' '}
              <strong>{topRiser?.name ?? 'das Spitzenfeld'}</strong>
              {topNew ? (
                <>
                  , während <strong>{topNew.name}</strong> ({topNew.categoryName}) als stärkster Neueinsteiger aus dem Stand in die Charts schießt
                </>
              ) : null}
              {topFaller ? (
                <>
                  . Auf der anderen Seite zeigt <strong>{topFaller.name}</strong> den deutlichsten Rückgang zum Vormonat — ein klassisches
                  Muster nach einem großen Release-Peak.
                </>
              ) : (
                '.'
              )}
            </>
          ) : (
            <>
              <strong>{data.heroTop12[0]?.name}</strong> and <strong>{data.heroTop12[1]?.name}</strong> cement coding agents at the
              top of global AI attention. Month-over-month, <strong>{topRiser?.name ?? 'the leading cohort'}</strong> posts the
              sharpest momentum gain
              {topNew ? (
                <>
                  , while <strong>{topNew.name}</strong> ({topNew.categoryName}) breaks straight into the charts as the biggest new entrant
                </>
              ) : null}
              {topFaller ? (
                <>
                  . Meanwhile, <strong>{topFaller.name}</strong> records the steepest month-over-month cool-down following its prior
                  launch wave.
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </div>
      </header>

      {/* 1. Biggest Risers */}
      {monthlyReport.risers.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-wider">
            <span className="inline-block h-2.5 w-2.5 bg-[#CCFF00] ring-1 ring-black/30" />
            {de ? '1. Größte Aufsteiger zum Vormonat' : '1. Biggest Risers (Month-over-Month)'}
          </h2>
          <div className="space-y-4">
            {monthlyReport.risers.map((m) => (
              <MoverCard key={m.id} mover={m} locale={locale} kind="riser" />
            ))}
          </div>
        </div>
      )}

      {/* 2. Breakout New Entrants */}
      {monthlyReport.newEntrants.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-wider">
            <span className="inline-block h-2.5 w-2.5 bg-foreground" />
            {de ? '2. Stärkste Neueinsteiger & Launches' : '2. Breakout New Entrants & Launches'}
          </h2>
          <div className="space-y-4">
            {monthlyReport.newEntrants.map((m) => (
              <MoverCard key={m.id} mover={m} locale={locale} kind="new" />
            ))}
          </div>
        </div>
      )}

      {/* 3. Biggest Cool-Downs */}
      {monthlyReport.fallers.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-wider">
            <span className="inline-block h-2.5 w-2.5 bg-muted-foreground" />
            {de ? '3. Deutlichste Abkühlungen zum Vormonat' : '3. Biggest Cool-Downs (Month-over-Month)'}
          </h2>
          <div className="space-y-4">
            {monthlyReport.fallers.map((m) => (
              <MoverCard key={m.id} mover={m} locale={locale} kind="faller" />
            ))}
          </div>
        </div>
      )}

      <footer className="border-t border-border pt-4 font-mono text-xs text-muted-foreground">
        {de ? (
          <>
            Methodik: Vergleich des durchschnittlichen täglichen Momentum-Scores der letzten 30 Tage ({monthlyReport.currentPeriodLabel})
            gegenüber den 30 Tagen davor ({monthlyReport.previousPeriodLabel}). Belege stammen direkt aus den zugeordneten
            Original-Erwähnungen in der Synthszr-Datenbank.{' '}
            <Link href={`/${locale}/rankings`} className="underline underline-offset-2 hover:text-foreground">
              Alle Live-Rankings ansehen →
            </Link>
          </>
        ) : (
          <>
            Methodology: Compares average daily exponential-decay momentum over the last 30 days ({monthlyReport.currentPeriodLabel})
            against the prior 30-day period ({monthlyReport.previousPeriodLabel}). Evidence citations are pulled directly from
            matched news mentions in the Synthszr database.{' '}
            <Link href={`/${locale}/rankings`} className="underline underline-offset-2 hover:text-foreground">
              Explore full live rankings →
            </Link>
          </>
        )}
      </footer>
    </section>
  )
}
