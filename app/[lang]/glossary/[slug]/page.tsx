import { Suspense } from 'react'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getGlossaryTerm } from '@/lib/glossary/detail'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { RelatedTerms } from '@/components/glossary/related-terms'
import { TermProducts } from '@/components/glossary/term-products'
import { TermNews } from '@/components/glossary/term-news'
import { TermIndexNav } from '@/components/glossary/term-index-nav'
import { getPublishedTermList } from '@/lib/glossary/terms'
import { getCategoryCappedProducts } from '@/lib/rankings/leaderboard'
import type { LanguageCode } from '@/lib/types'

// ISR statt on-demand-only: der Erklärungstext ändert sich nur über den
// redaktionellen Monats-Cron (Design-Spec §I). Kein generateStaticParams →
// kein Build-time-Prerender, Seiten rendern on-demand und cachen 15 min am Edge.
export const revalidate = 900

// Leeres generateStaticParams aktiviert on-demand ISR: ohne diese Funktion
// behandelt Vercel Dynamic-Segment-Routen als voll dynamisch und ignoriert
// revalidate (in Prod verifiziert, vgl. app/[lang]/rankings/[slug]/page.tsx:32-34).
export async function generateStaticParams() {
  return []
}

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const term = await getGlossaryTerm(slug, lang)
  if (!term) {
    // Task 18: über getTranslations statt eines harten de/en-Ternarys — der
    // Schlüssel glossary.not_found existierte bereits (defaultTranslations),
    // hatte aber keinen Aufrufer. Löst nebenbei den DE-Fallback für cs/nds/fr
    // konsistent zum Rest der Seite (vorher liefen alle Nicht-de-Locales,
    // auch cs/nds/fr, auf den EN-Text).
    const t = await getTranslations(locale)
    return {
      title: `${t['glossary.not_found']} | Synthszr Lexikon`,
      robots: { index: false, follow: false },
    }
  }

  return generateLocalizedMetadata({
    title: locale === 'de'
      ? `${term.canonicalName} — einfach erklärt | Synthszr Lexikon`
      : `${term.canonicalName} — explained | Synthszr Lexikon`,
    description: term.summary,
    path: `/glossary/${slug}`,
    locale,
    // Lexikon-Content existiert nur de/en — cs/fr/nds gehören nicht in den
    // hreflang-Cluster (sonst Thin-Duplicate-Signale, gleiches Muster wie
    // rankings/[slug]).
    availableLocales: ['de', 'en'],
    // Dither-Illustration als OG-Bild, wenn vorhanden — sonst der
    // Standard-Fallback aus generateLocalizedMetadata.
    ogImage: term.illustrationUrl ?? undefined,
  })
}

export default async function GlossaryTermPage({ params }: PageProps) {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const term = await getGlossaryTerm(slug, lang)
  if (!term) notFound()

  const translations = await getTranslations(locale)
  const t = (key: string) => translations[key] ?? key

  const bodyHtml = renderStaticArticleHtml(term.body as Record<string, unknown> | string, lang)
  // A-Z-Navigation über alle Begriffe: von jeder Begriffsseite aus soll das
  // ganze Lexikon erreichbar sein, ohne den Umweg über den Index.
  const allTerms = await getPublishedTermList(lang)

  // Logo und Score für die Produktkarten, damit die Darstellung der in den
  // Rankings entspricht. includeHistory=FALSE ist wesentlich: der history-JSONB
  // war die Hauptursache der Egress-Overage, und für Logo und Score braucht man
  // ihn nicht (nur die Sparkline würde ihn brauchen — die zeigen wir deshalb
  // nicht). Fehlschlag ist unkritisch: dann fehlen Logo und Zahl, die Namen
  // stehen trotzdem da.
  let chartBySlug = new Map<string, { vendor: string | null; score: number | null }>()
  try {
    const chartProducts = await getCategoryCappedProducts(50, false)
    chartBySlug = new Map(chartProducts.map((p) => [p.slug, { vendor: p.vendor ?? null, score: p.score ?? null }]))
  } catch (err) {
    console.error('[Glossary] Chart-Daten für Produkte nicht ladbar:', err)
  }
  const productsWithChartData = term.products.map((p) => ({
    ...p,
    vendor: chartBySlug.get(p.slug)?.vendor ?? null,
    score: chartBySlug.get(p.slug)?.score ?? null,
  }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: term.canonicalName,
    description: term.summary,
    url: `${SITE_URL}/${lang}/glossary/${slug}`,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Synthszr Lexikon',
      url: `${SITE_URL}/${lang}/glossary`,
    },
  }

  return (
    <>
      <main className="max-w-5xl mx-auto px-4 py-10">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        {/* Zweispaltig ab lg: Navigation links, Text rechts. Die
            HTML-Reihenfolge bleibt dabei Artikel ZUERST — das ist SEO/GEO-relevant
            und nicht nur Layout: LLMs zitieren den ersten substanziellen
            Textblock, eine Navigationsliste davor würde genau die Passage
            verwässern, für die die Seite existiert. Deshalb explizite
            Grid-Platzierung (col-start) statt der DOM-Reihenfolge: das <aside>
            steht im Markup hinter dem <article> und erscheint trotzdem links.
            Ohne lg (mobil) greift kein Grid — dann gilt die DOM-Reihenfolge und
            die Navigation landet unter dem Artikel, wie gewünscht. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] lg:gap-10 lg:items-start">
        <div className="lg:col-start-2 lg:row-start-1">
        <article>
          <header className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{term.canonicalName}</h1>
            <p className="mt-4 text-xl text-gray-700 leading-snug">{term.summary}</p>
          </header>

          {term.illustrationUrl && (
            <div className="mb-8">
              <Image
                src={term.illustrationUrl}
                alt={term.illustrationAlt || term.canonicalName}
                width={768}
                height={768}
                className="mx-auto h-auto w-full max-w-sm dithered-cover"
              />
            </div>
          )}

          {bodyHtml && (
            <div
              // Gleiche Klassen wie der Artikel-Renderer
              // (components/post-content-view.tsx) — Lesetypografie, volle
              // Spaltenbreite, keine Sidebar.
              className="prose prose-neutral max-w-none font-serif text-base leading-relaxed tiptap-content"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          )}
        </article>

        {/* Produkte und News bleiben im Textbereich: beides ist Inhalt, keine
            Navigation. Die Produktkarten brauchen Breite für Logo, Name und
            Score, die News-Einträge für Titel, Datum und Einordnungssatz — in
            der 11rem-Spalte wäre beides unlesbar. Dort stehen nur verwandte
            Begriffe und das A-Z-Register. */}
        {(term.products.length > 0 || term.news.length > 0) && (
          <div className="mt-10 space-y-8 border-t border-border pt-8">
            <TermProducts products={productsWithChartData} lang={lang} heading={t('glossary.products')} />
            <TermNews news={term.news} lang={lang} heading={t('glossary.news')} />
          </div>
        )}
        </div>

        {/* Linke Spalte (Desktop) bzw. unter dem Artikel (Mobile). sticky, damit
            die Navigation beim Lesen langer Erklärtexte sichtbar bleibt. */}
        {/* border-border statt gray-200: Design-System-Token, trägt den Dark Mode.
            Auf Desktop trennt eine feine vertikale Linie die Navigation vom Text —
            dieselbe Aufgabe wie die horizontale Linie auf Mobile. */}
        <aside className="lg:col-start-1 lg:row-start-1 lg:sticky lg:top-6 mt-10 lg:mt-0 space-y-8 border-t border-border pt-8 lg:border-t-0 lg:pt-0 lg:border-r lg:pr-6">
          <RelatedTerms
            terms={term.relatedTerms}
            lang={lang}
            heading={t('glossary.related_terms')}
            variant="sidebar"
          />
          <TermIndexNav
            terms={allTerms}
            lang={lang}
            currentSlug={slug}
            heading={t('glossary.index_title')}
          />
        </aside>
        </div>
      </main>
      <SiteFooter locale={lang} />
    </>
  )
}
