import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { COMPANY_TICKERS } from '@/lib/data/company-tickers'
import { getVendorStockSynthszr } from '@/lib/rankings/vendor-stock-synthesis'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { StocksBanner } from '@/components/stocks/stocks-banner'
import { StockSynthesisBlock } from '@/components/rankings/stock-synthesis-block'
import { CompanyPostList } from '@/components/companies/company-post-list'
import { getRecentPostsForCompany } from '@/lib/companies/recent-posts'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LanguageCode } from '@/lib/types'

// ISR wie die Lexikon- und Ranking-Seiten: die Analyse wird vom Cron bzw.
// on-view erneuert, nicht bei jedem Aufruf.
export const revalidate = 900

// Leeres generateStaticParams aktiviert on-demand ISR — ohne diese Funktion
// behandelt Vercel Dynamic-Segment-Routen als voll dynamisch und ignoriert
// revalidate (in Prod verifiziert, vgl. app/[lang]/rankings/[slug]/page.tsx).
export async function generateStaticParams() {
  return []
}

/**
 * Ticker → Firmenschlüssel. COMPANY_TICKERS bildet Firma → Ticker ab, hier wird
 * die Richtung gedreht.
 *
 * Mehrere Firmennamen können auf denselben Ticker zeigen ("google" und
 * "alphabet" beide auf GOOGL). Der ERSTE Treffer gewinnt und ist damit die
 * kanonische Firma für diesen Ticker — das hält /de/stocks/googl stabil, statt
 * es von der Objektreihenfolge abhängig zu machen, und der Loader liefert für
 * beide Schlüssel dieselbe Analyse.
 */
function companyForTicker(ticker: string): string | null {
  const upper = ticker.trim().toUpperCase()
  for (const [company, { symbol }] of Object.entries(COMPANY_TICKERS)) {
    if (symbol.toUpperCase() === upper) return company
  }
  return null
}

interface PageProps {
  params: Promise<{ lang: string; ticker: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, ticker } = await params
  const locale = lang as LanguageCode
  const company = companyForTicker(ticker)
  if (!company) return { title: 'Not found' }

  const stock = await getVendorStockSynthszr(company)
  const name = stock?.company ?? company
  const symbol = ticker.toUpperCase()

  return generateLocalizedMetadata({
    title: locale === 'de'
      ? `${name} (${symbol}) — Aktienanalyse | Synthszr Stocks`
      : `${name} (${symbol}) — Stock Analysis | Synthszr Stocks`,
    description: locale === 'de'
      ? `KI-gestützte Analyse zu ${name}: Bewertung, Zusammenfassung, Handlungsideen und Gegenargumente.`
      : `AI-assisted analysis of ${name}: rating, summary, action ideas and counterarguments.`,
    path: `/stocks/${ticker.toLowerCase()}`,
    locale,
    availableLocales: ['de', 'en'],
  })
}

export default async function StockPage({ params }: PageProps) {
  const { lang, ticker } = await params
  const locale = lang as LanguageCode
  const company = companyForTicker(ticker)
  // Unbekannter Ticker → 404. Die Route ist bewusst auf COMPANY_TICKERS
  // beschränkt: für alles andere existiert keine Analyse, und eine leere Seite
  // wäre schlechter als ein ehrlicher 404.
  if (!company) notFound()

  const stock = await getVendorStockSynthszr(company)
  if (!stock) notFound()

  const translations = await getTranslations(locale)
  const t = (key: string) => translations[key] ?? key
  const symbol = ticker.toUpperCase()

  // Die letzten Artikel, in denen die Firma vorkam. service_role, weil
  // post_company_mentions RLS-gesperrt ist — mit dem anon-Key käme still null
  // zurück und der Block wäre unsichtbar, ohne Fehler.
  const recentPosts = await getRecentPostsForCompany(createAdminClient(), stock.companyKey, 7)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Corporation',
    name: stock.company,
    tickerSymbol: symbol,
    url: `${SITE_URL}/${lang}/stocks/${ticker.toLowerCase()}`,
  }

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        <StocksBanner />

        <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">
          {locale === 'de' ? 'Unternehmens-Analyse' : 'Company analysis'}: {stock.company}
        </h1>

        {/* Derselbe Block wie auf den Ranking-Produktseiten — Vote, Zusammenfassung,
            Handlungsideen, Gegenargumente, Quellen. Er lädt Kurs und (falls
            abgelaufen) eine frische Analyse selbst nach; als Client-Komponente
            braucht er hier keine weitere Verdrahtung. */}
        <StockSynthesisBlock
          company={stock.company}
          companyKey={stock.companyKey}
          initial={stock.data}
          createdAt={stock.createdAt}
          stale={stock.stale}
          locale={lang}
        />

        <CompanyPostList
          posts={recentPosts}
          lang={lang}
          heading={locale === 'de'
            ? `${stock.company} bei Synthszr`
            : `${stock.company} at Synthszr`}
        />

        {stock.data === null && (
          <p className="mt-6 text-sm text-muted-foreground">
            {t('stocks.generating') !== 'stocks.generating'
              ? t('stocks.generating')
              : locale === 'de'
                ? 'Die Analyse wird beim ersten Aufruf erzeugt — das dauert einen Moment.'
                : 'The analysis is generated on first view — this takes a moment.'}
          </p>
        )}
      </main>
      <SiteFooter locale={lang} />
    </>
  )
}
