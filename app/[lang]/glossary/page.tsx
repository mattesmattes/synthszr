import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublishedTermListShared } from '@/lib/glossary/terms'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import type { LanguageCode } from '@/lib/types'

// ISR wie die Detailseite (Design-Spec §D) — die Begriffsliste ändert sich nur
// über den redaktionellen Monats-Cron, kein generateStaticParams nötig: die
// Route hat kein dynamisches Segment und wird nicht dadurch voll-dynamisch.
export const revalidate = 3600

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const locale = lang as LanguageCode
  return generateLocalizedMetadata({
    title: locale === 'de'
      ? 'Synthszr Lexikon — Fachbegriffe einfach erklärt'
      : 'Synthszr Glossary — key terms explained',
    description: locale === 'de'
      ? 'Fachbegriffe aus unseren Artikeln, kurz und verständlich erklärt.'
      : 'Terms from our articles, explained briefly and clearly.',
    path: '/glossary',
    locale,
    // Lexikon-Content existiert nur de/en — gleiches Muster wie die
    // Detailseite (app/[lang]/glossary/[slug]/page.tsx).
    availableLocales: ['de', 'en'],
  })
}

export default async function GlossaryIndexPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode

  // Slug ist locale-unabhängig, aber Name/Summary sollen übersetzt sein.
  // PostgREST cappt Ergebnisse bei 1000 Zeilen (kein .range() in
  // getPublishedTermList) — der Bestand liegt heute weit darunter; braucht
  // die Funktion Range-Pagination, sobald sich das Lexikon dieser
  // Größenordnung nähert.
  const terms = await getPublishedTermListShared(lang)

  const translations = await getTranslations(locale)
  const t = (key: string) => translations[key] ?? key

  const grouped = new Map<string, typeof terms>()
  for (const term of terms) {
    const letter = term.canonicalName.charAt(0).toUpperCase()
    if (!grouped.has(letter)) grouped.set(letter, [])
    grouped.get(letter)!.push(term)
  }
  const letters = [...grouped.keys()].sort((a, b) => a.localeCompare(b, locale))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: 'Synthszr Lexikon',
    url: `${SITE_URL}/${lang}/glossary`,
    hasDefinedTerm: terms.map((term) => ({
      '@type': 'DefinedTerm',
      name: term.canonicalName,
      url: `${SITE_URL}/${lang}/glossary/${term.slug}`,
    })),
  }

  return (
    <>
      <main className="max-w-3xl mx-auto px-4 py-10">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} />
        </Suspense>

        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('glossary.index_title')}</h1>
          <p className="mt-4 text-xl text-foreground/80 leading-snug">{t('glossary.index_intro')}</p>
        </header>

        {terms.length === 0 ? (
          <p className="text-muted-foreground">{t('glossary.index_empty')}</p>
        ) : (
          <div className="space-y-10">
            {/* Sprungleiste erst ab 8 Buchstaben: die A-Z-Gliederung selbst gibt es
                schon (eine Sektion je Anfangsbuchstabe), aber solange fast jeder
                Buchstabe nur einen Eintrag hat, wäre eine Navigation länger als
                die Liste, die sie erschließt. Reine Anker-Links, kein Client-JS. */}
            {letters.length >= 8 && (
              <nav aria-label={t('glossary.index_title')} className="flex flex-wrap gap-x-3 gap-y-1 border-b pb-4">
                {letters.map((letter) => (
                  <a
                    key={letter}
                    href={`#letter-${letter}`}
                    className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {letter}
                  </a>
                ))}
              </nav>
            )}
            {letters.map((letter) => (
              <section key={letter} id={`letter-${letter}`} className="scroll-mt-6">
                <h2 className="mb-3 font-mono text-sm text-muted-foreground/70">{letter}</h2>
                <ul className="space-y-4">
                  {grouped.get(letter)!.map((term) => (
                    <li key={term.slug}>
                      <Link
                        href={`/${lang}/glossary/${term.slug}`}
                        className="text-lg font-medium hover:underline"
                      >
                        {term.canonicalName}
                      </Link>
                      <p className="text-foreground/80">{term.summary}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
      <SiteFooter locale={lang} />
    </>
  )
}
