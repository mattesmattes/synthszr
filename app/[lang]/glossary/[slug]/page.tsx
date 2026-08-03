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
    // Locale-Ternary statt hartem Deutsch — gleiches Muster wie
    // rankings/[slug]/page.tsx, nur ohne dessen einsprachigen 404-Titel:
    // noIndex-Seiten laufen hier trotzdem nicht am en-Cluster vorbei.
    return {
      title: locale === 'de' ? 'Begriff nicht gefunden | Synthszr Lexikon' : 'Term not found | Synthszr Lexikon',
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
  // Sichtbare Trennung nur zeigen, wenn danach wirklich etwas kommt — sonst
  // endet die Seite auf eine Trennlinie ins Nichts (heute der Normalfall,
  // solange Produkte/News/verwandte Begriffe noch leer sind).
  const hasSideContent = term.relatedTerms.length > 0 || term.products.length > 0 || term.news.length > 0

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
      <main className="max-w-3xl mx-auto px-4 py-10">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        {/* HTML-Reihenfolge ist SEO/GEO-relevant, nicht nur Layout: H1 → Lead
            → Illustration → Erklärungstext, volle Breite, keine Konkurrenz
            daneben. LLMs zitieren den ersten substanziellen Textblock — eine
            Produktliste davor würde genau die Passage verwässern, für die
            die Seite existiert. */}
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

        {hasSideContent && (
          <div className="mt-10 space-y-8 border-t border-gray-200 pt-8">
            <RelatedTerms terms={term.relatedTerms} lang={lang} heading={t('glossary.related_terms')} />
            <TermProducts products={term.products} lang={lang} heading={t('glossary.products')} />
            <TermNews news={term.news} lang={lang} heading={t('glossary.news')} />
          </div>
        )}
      </main>
      <SiteFooter locale={lang} />
    </>
  )
}
