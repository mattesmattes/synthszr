import { Suspense } from 'react'
import Link from 'next/link'
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
import { CurrencyConverter } from '@/components/glossary/currency-converter'
import { CurrencyChart } from '@/components/glossary/currency-chart'
import { KornCanvas } from '@/components/glossary/korn-canvas'
import { waehrungFuerSlug } from '@/lib/currency/currencies'
import { fetchEcbRates } from '@/lib/currency/ecb-rates'
import { fetchKursverlauf, ausduennen } from '@/lib/currency/history'
import { getPublishedTermListShared, termListCacheKey, matcherCacheKey } from '@/lib/glossary/terms'
import { prewarmSharedCache } from '@/lib/cache/shared-cache'
import { getCategoryCappedProductsShared, cappedProductsCacheKey } from '@/lib/rankings/leaderboard'
import type { LanguageCode } from '@/lib/types'

// ISR statt on-demand-only: der Erklärungstext ändert sich nur über den
// redaktionellen Monats-Cron (Design-Spec §I). Kein generateStaticParams →
// kein Build-time-Prerender, Seiten rendern on-demand und cachen 6h am Edge.
// Vorher 900s (15 Min) — bei einem Monats-Rhythmus für Inhalts-Updates war das
// unnötig knapp und der Haupttreiber der Egress-Eskalation vom 2026-08-19: bei
// 2171 Begriffsseiten prüft ein kurzes Fenster viel öfter auf Änderungen, als
// welche vorkommen. 6h balanciert Egress gegen die Reaktionszeit auf manuelle
// Korrekturen (Bild, Text) außerhalb des Monats-Crons.
export const revalidate = 21600

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

  // Diese Seite braucht drei Cache-Eintraege: die Matcher-Liste (in
  // getGlossaryTerm, fuer die verwandten Begriffe), die Begriffsliste (fuer die
  // A-Z-Navigation) und die Chart-Produkte. Einzeln geholt sind das drei
  // Redis-Kommandos je Seitenaufbau — bei 2360 Begriffen x 5 Sprachen 35.400
  // pro Vollcrawl, womit das Upstash-Kontingent (500.000/Monat) nach 14 Crawls
  // aufgebraucht ist. Genau das trat am 28.08.2026 ein. Vorgewaermt ist es ein
  // einziges MGET; die drei Aufrufe unten treffen danach die Speicher-Ebene.
  // Ein Fehlschlag bleibt folgenlos, dann holen sie ihre Werte eben selbst.
  await prewarmSharedCache([
    matcherCacheKey(lang),
    termListCacheKey(lang, false),
    cappedProductsCacheKey(50, false),
  ])

  const term = await getGlossaryTerm(slug, lang)
  if (!term) notFound()

  const translations = await getTranslations(locale)
  const t = (key: string) => translations[key] ?? key

  const bodyHtml = renderStaticArticleHtml(term.body as Record<string, unknown> | string, lang)

  // Ist dieser Begriff eine Fremdwährung, bekommt er einen Umrechner. Die
  // Zuordnung steht im Code, nicht in der Datenbank (Begründung in
  // lib/currency/currencies.ts).
  //
  // Die Kurse werden HIER geladen, nicht im Bauteil: die Seite ist ohnehin
  // ISR-gecacht, damit kommt der Kurs ohne einen zusätzlichen Client-Aufruf
  // mit — und ohne eine eigene API-Route. Dass er dadurch bis zu 15 Minuten
  // alt sein kann, ist bei einem Tagesreferenzkurs bedeutungslos.
  //
  // Schlägt der Abruf fehl oder führt die EZB die Währung nicht, bleibt der
  // Umrechner einfach weg. Der Erklärtext ist der Hauptinhalt; er darf an
  // einer fremden Datenquelle nicht scheitern.
  // Tageskurs und Verlauf parallel: sie hängen nicht voneinander ab, und in
  // Reihe geladen addierten sich zwei fremde Latenzen auf den Seitenaufbau.
  const waehrung = waehrungFuerSlug(slug)
  const [kurse, verlauf] = waehrung
    ? await Promise.all([fetchEcbRates(), fetchKursverlauf(waehrung.code, 3)])
    : [null, []]
  const kurs = waehrung && kurse ? kurse.rates[waehrung.code] : undefined
  // Drei Jahre Tageskurse sind rund 780 Werte — mehr, als die Kurve auflösen
  // kann, und jeder Punkt kostet Zeichen im ausgelieferten HTML.
  const verlaufKurz = ausduennen(verlauf, 160)
  // A-Z-Navigation über alle Begriffe: von jeder Begriffsseite aus soll das
  // ganze Lexikon erreichbar sein, ohne den Umweg über den Index.
  // includeSummary=false: das Register zeigt nur Namen. Bei 500 Begriffen sind
  // das rund 20 KB statt 120 KB je Seitenaufbau.
  const allTerms = await getPublishedTermListShared(lang, { includeSummary: false })

  // Logo und Score für die Produktkarten, damit die Darstellung der in den
  // Rankings entspricht. includeHistory=FALSE ist wesentlich: der history-JSONB
  // war die Hauptursache der Egress-Overage, und für Logo und Score braucht man
  // ihn nicht (nur die Sparkline würde ihn brauchen — die zeigen wir deshalb
  // nicht). Fehlschlag ist unkritisch: dann fehlen Logo und Zahl, die Namen
  // stehen trotzdem da.
  let chartBySlug = new Map<string, { vendor: string | null; score: number | null }>()
  try {
    const chartProducts = await getCategoryCappedProductsShared(50, false)
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
        {/* SICHTBARER Breadcrumb als Entsprechung zum BreadcrumbList-Schema:
            Google erwartet, dass strukturierte Daten im Inhalt wiederzufinden
            sind — ein Breadcrumb, den es nur im Markup gibt, ist ein
            Mismatch-Risiko. Gleiche Stufen und gleiche Reihenfolge wie dort
            (buildGlossaryJsonLd). Die aktuelle Seite ist bewusst KEIN Link,
            sondern per aria-current markiert. */}
        <nav aria-label={locale === 'de' ? 'Brotkrumen' : 'Breadcrumb'} className="mb-4">
          <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <li>
              <Link href={`/${lang}`} className="transition-colors hover:text-accent">Synthszr</Link>
            </li>
            <li aria-hidden className="text-muted-foreground/50">/</li>
            <li>
              <Link href={`/${lang}/glossary`} className="transition-colors hover:text-accent">
                {locale === 'de' ? 'Lexikon' : 'Glossary'}
              </Link>
            </li>
            <li aria-hidden className="text-muted-foreground/50">/</li>
            <li aria-current="page" className="text-foreground">{term.canonicalName}</li>
          </ol>
        </nav>

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
              {/* Der Wrapper traegt Groesse/Zentrierung (vorher Klassen am
                  Image selbst); das Image bekommt dadurch eine Box, ueber die
                  der Animations-Canvas exakt deckungsgleich gelegt werden kann.
                  Ohne WebGPU bleibt der Canvas unsichtbar (opacity 0), das
                  Image darunter ist unveraendert der Ist-Zustand. */}
              <span className="relative mx-auto block w-full max-w-[326px]">
              <Image
                src={term.illustrationUrl}
                // Der Alt-Text traegt die Beschreibung — SICHTBARE Bildunterschrift
                // gibt es nicht mehr (Betreiber-Entscheidung 2026-08-05). Sie war
                // als zusaetzlicher Text am Bild fuer Bildsuche und Sprachmodelle
                // gedacht, stand aber unter jeder Illustration im Weg.
                alt={term.illustrationAlt || term.canonicalName}
                width={768}
                height={768}
                // priority statt lazy: das Bild steht ueber der Ueberschrift, ist
                // also above the fold und mit 768px das groesste Element — mit
                // hoher Wahrscheinlichkeit das LCP-Element. lazy verzoegerte
                // genau das, was Core Web Vitals messen (an Prod gesehen).
                priority
                // sizes IST HIER KEIN DETAIL. Ohne sizes baut next/image ein
                // srcSet mit x-Deskriptoren und laedt auf Retina die Variante
                // w=1920 — fuer ein 326px breites Bild rund sechsfache
                // Auflaesung, mehr Bytes als das Lazy-Loading je gekostet hat
                // (in Prod im srcSet nachgelesen). Ausserdem erzeugt Next den
                // <link rel="preload" as="image" fetchPriority="high"> nur mit
                // sizes; auf den Artikelseiten ist er deshalb vorhanden, hier
                // fehlte er trotz priority.
                sizes="326px"
                // 326px = max-w-sm (384px) minus 15%. Kein Tailwind-Preset trifft
                // das; die Zahl ist hier bewusst explizit, weil sie mit der
                // Rasterweite zusammenhängt: das 768px-Bild wird dadurch stärker
                // verkleinert, das Dither-Raster erscheint also rund 15% feiner
                // (s. generateGlossaryIllustration).
                //
                // mx-auto/max-w-[326px] sitzen jetzt am Wrapper-<span>, nicht
                // mehr hier — der Animations-Canvas braucht dieselbe Box.
                className="h-auto w-full dithered-cover dithered-invert"
                // Unoptimiert: der Optimizer liefert per srcset eine 652er-
                // Variante aus, in der das Dither-Raster nicht mehr zu erkennen
                // waere. Die Korn-Animation holt ihre Pixel per eigenem fetch()
                // (s. korn-canvas.tsx) — dieselbe URL wie hier, ueblicherweise
                // aus dem HTTP-Cache bedient statt erneut uebers Netz. Kein
                // crossOrigin mehr noetig: das <img> selbst wird von der
                // Animation nicht mehr gelesen (Safari tainted sonst den Canvas,
                // s. Commit-Historie 5a53c23/danach). Bei einem palettierten
                // 1-Bit-PNG von 7-40 kB gewinnt der Optimizer ohnehin nichts:
                // er reicht es unveraendert durch.
                unoptimized
              />
              {term.animationParams?.verfahren === 'korn' && (
                <KornCanvas
                  src={term.illustrationUrl}
                  animation={term.animationParams}
                  className="dithered-cover dithered-invert"
                />
              )}
              </span>
            </figure>
          )}

          <header className="mb-6">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{term.canonicalName}</h1>
            <p className="mt-4 text-xl text-foreground/80 leading-snug">{term.summary}</p>
          </header>

          {/* DIREKT UNTER DER EINLEITUNG, noch vor dem Erklärtext
              (Betreiber-Vorgabe 2026-08-15): Der Rechner ist der Grund, warum
              jemand diese Seite aus einem Artikel heraus aufruft — er soll ohne
              Scrollen dastehen, nicht am Ende einer Erklärung.

              Die GEO-Regel aus Design-Spec §I bleibt dabei gewahrt: der erste
              substanzielle Textblock ist die Zusammenfassung im <header>
              darüber, und die steht weiterhin an erster Stelle. Verschoben ist
              nur der Erklärtext, der ohnehin nachrangig zitiert wird. */}
          {waehrung && kurs && kurse && (
            <CurrencyConverter
              waehrung={waehrung}
              kurs={kurs}
              stand={kurse.date}
              lang={lang}
              labels={{
                ueberschrift: t('glossary.converter_title'),
                stand: t('glossary.converter_date'),
                quelle: t('glossary.converter_source'),
              }}
            />
          )}

          {/* Verlauf direkt unter dem Rechner: erst „was ist es wert", dann
              „wie hat es sich entwickelt". Fehlt die Reihe, entfällt nur die
              Kurve. */}
          {waehrung && verlaufKurz.length > 1 && (
            <CurrencyChart
              punkte={verlaufKurz}
              code={waehrung.code}
              lang={lang}
              labels={{
                ueberschrift: t('glossary.chart_title'),
                spanne: t('glossary.chart_range'),
                jahr: t('glossary.chart_year'),
                jahre: t('glossary.chart_years'),
                monate: t('glossary.chart_months'),
              }}
            />
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
