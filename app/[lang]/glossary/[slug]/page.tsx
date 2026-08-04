import { Suspense } from 'react'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getGlossaryTerm } from '@/lib/glossary/detail'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { shortenForMeta } from '@/lib/seo/meta-description'
import { buildGlossaryJsonLd } from '@/lib/glossary/structured-data'
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

  // "Lexikon" stand bis 2026-08-04 auch im englischen Titel. index_title traegt
  // die Uebersetzung schon ("Synthszr Lexikon" / "Synthszr Glossary"), sie war
  // hier nur nicht benutzt.
  const tMeta = await getTranslations(locale)
  const setName = tMeta['glossary.index_title'] ?? 'Synthszr Lexikon'

  return generateLocalizedMetadata({
    title: locale === 'de'
      ? `${term.canonicalName} — einfach erklärt | ${setName}`
      : `${term.canonicalName} — explained | ${setName}`,
    // Gekuerzt statt volles summary: an Prod gemessen waren es 280 Zeichen,
    // Google zeigt rund 155 und schnitt selbst ab — mitten im Satz.
    description: shortenForMeta(term.summary),
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
  // includeSummary=false: das Register zeigt nur Namen. Bei 500 Begriffen sind
  // das rund 20 KB statt 120 KB je Seitenaufbau.
  const allTerms = await getPublishedTermList(lang, { includeSummary: false })

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

  // DefinedTerm + BreadcrumbList (+ WebPage mit dateModified, falls vorhanden).
  // Die beiden letzten fehlten und sind die zwei Signale, die Lexikonseiten am
  // meisten bringen: eine echte Hierarchie und eine Aktualitaetsangabe.
  const jsonLd = buildGlossaryJsonLd({
    name: term.canonicalName,
    summary: term.summary,
    slug,
    lang,
    setName: t('glossary.index_title'),
    indexLabel: locale === 'de' ? 'Lexikon' : 'Glossary',
    updatedAt: term.updatedAt,
  })

  return (
    <>
      <main className="max-w-5xl mx-auto px-4 py-10">
        {/* Ein <script> je Block statt eines @graph: fuer Google gleichwertig, aber
            jeder Block bleibt einzeln lesbar und safeJsonLd behaelt seine
            Objekt-Signatur (es escaped </script> in Strings). */}
        {jsonLd.map((block, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: safeJsonLd(block) }}
          />
        ))}

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
        {/* Header INNERHALB der Textspalte, nicht über dem Grid: er zentriert
            sich per justify-center in seinem Container. Stand er über dem Grid,
            war seine Achse die volle max-w-5xl-Breite, die von Illustration und
            Text aber nur die rechte Spalte — der Header saß dadurch um die halbe
            Sidebar-Breite (11rem + 2.5rem gap, also rund 108px) nach links
            versetzt. Hier liegt er auf derselben Achse wie Bild und Fließtext.
            Ohne lg greift kein Grid, dort ändert sich nichts. */}
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>
        <article>
          {/* Illustration ÜBER der Überschrift: sie führt in den Begriff ein, wie
              das Cover in einen Artikel. GEO-unkritisch, anders als es der
              Kommentar oben für Navigation festhält — ein Bild ist kein
              Textblock, es verdrängt die zitierfähige Passage nicht, und sein
              alt-Attribut ist ein Satz.

              mt-8 zusätzlich zum mb-6 des Headers: der Sprachumschalter darüber
              ist eine schmale Zeile, ohne diesen Abstand klebt die Illustration
              daran und beide lesen sich als ein Block. */}
          {term.illustrationUrl && (
            <figure className="mt-8 mb-6">
              <Image
                src={term.illustrationUrl}
                // alt LEER, wenn eine Bildunterschrift daruntersteht: die
                // figcaption beschreibt das Bild dann bereits, und Screenreader
                // laesen sonst denselben Satz zweimal. Ohne Untertitel (kein
                // illustration_alt) traegt das alt weiter die Beschreibung.
                alt={term.illustrationAlt ? '' : term.canonicalName}
                width={768}
                height={768}
                // priority statt lazy: das Bild steht ueber der Ueberschrift, ist
                // also above the fold und mit 768px das groesste Element — mit
                // hoher Wahrscheinlichkeit das LCP-Element. lazy verzoegerte
                // genau das, was Core Web Vitals messen (an Prod gesehen).
                priority
                // 326px = max-w-sm (384px) minus 15%. Kein Tailwind-Preset trifft
                // das; die Zahl ist hier bewusst explizit, weil sie mit der
                // Rasterweite zusammenhängt: das 768px-Bild wird dadurch stärker
                // verkleinert, das Dither-Raster erscheint also rund 15% feiner
                // (s. generateGlossaryIllustration).
                className="mx-auto h-auto w-full max-w-[326px] dithered-cover"
              />
              {/* Bildunterschrift: zusaetzlicher, thematisch dichter Text direkt am
                  Bild — fuer die Bildsuche und fuer Sprachmodelle, die Bild und
                  Text zusammen lesen. */}
              {term.illustrationAlt && (
                <figcaption className="mx-auto mt-2 max-w-[326px] text-xs leading-snug text-gray-500">
                  {term.illustrationAlt}
                </figcaption>
              )}
            </figure>
          )}

          <header className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{term.canonicalName}</h1>
            <p className="mt-4 text-xl text-gray-700 leading-snug">{term.summary}</p>
          </header>

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
            allLabel={locale === 'de' ? 'Alle {count} Begriffe →' : 'All {count} terms →'}
          />
        </aside>

        {/* Newsletter und Footer IN der Textspalte, aus demselben Grund wie der
            Sprachumschalter oben: beide zentrieren sich intern per mx-auto
            (max-w-2xl bzw. w-[704px]), und weil SiteFooter sonst ausserhalb von
            <main> steht, ist ihre Achse die des Fensters — die des Lexikontexts
            liegt aber um die halbe Sidebar-Breite (rund 108px) weiter rechts.
            Hier liegen Text, Bild, Newsletter und Footer auf einer Achse.
            row-start-2 statt implizitem Fluss: sonst landete der Block neben dem
            <aside> in dessen Zeile. */}
        <div className="lg:col-start-2 lg:row-start-2">
          <SiteFooter locale={lang} />
        </div>
        </div>
      </main>
    </>
  )
}
