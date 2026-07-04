import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import { getTranslations } from '@/lib/i18n/get-translations'
import { SiteFooter } from '@/components/site-footer'
import { AUTHOR, authorI18n } from '@/lib/data/author'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

// Statischer Inhalt (Autor-Daten aus dem Code) → langes ISR.
export const revalidate = 86400

interface PageProps {
  params: Promise<{ lang: string; slug: string }>
}

export function generateStaticParams() {
  return [{ slug: AUTHOR.slug }]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  if (slug !== AUTHOR.slug) return { title: 'Nicht gefunden', robots: { index: false, follow: false } }
  const locale = lang as LanguageCode
  const { jobTitle, bio } = authorI18n(locale)
  return generateLocalizedMetadata({
    title: `${AUTHOR.name} — ${jobTitle} | Synthszr`,
    description: bio[0].slice(0, 155),
    path: `/author/${slug}`,
    locale,
  })
}

export default async function AuthorPage({ params }: PageProps) {
  const { lang, slug } = await params
  if (slug !== AUTHOR.slug) notFound()
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const { jobTitle, bio } = authorI18n(locale)
  const url = `${SITE_URL}/${locale}/author/${AUTHOR.slug}`

  // Person-Schema (E-E-A-T): benannter Herausgeber mit Verknüpfung zu LinkedIn
  // und der Synthszr-Organisation.
  const personLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: AUTHOR.name,
    url,
    jobTitle,
    description: bio.join(' '),
    knowsAbout: AUTHOR.knowsAbout,
    sameAs: [AUTHOR.linkedin],
    worksFor: { '@type': 'Organization', name: 'Synthszr', url: `${SITE_URL}/de` },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(personLd) }} />
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto w-[704px] max-w-full px-6 py-12 md:py-20">
          <Link
            href={`/${locale}`}
            className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            {t['nav.home'] ?? 'Home'}
          </Link>

          <header className="mb-8 border-b border-border pb-8">
            <h1 className="text-3xl font-bold tracking-tight">{AUTHOR.name}</h1>
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">{jobTitle}</p>
          </header>

          <div className="space-y-4">
            {bio.map((p, i) => (
              <p key={i} className="leading-relaxed text-foreground">{p}</p>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-6 border-t border-border pt-6 text-sm">
            <a
              href={AUTHOR.linkedin}
              target="_blank"
              rel="noopener noreferrer me"
              className="hover:text-accent transition-colors"
            >
              LinkedIn
            </a>
            <Link href={`/${locale}/rankings`} className="hover:text-accent transition-colors">
              Synthszr Charts
            </Link>
            <Link href={`/${locale}/archive`} className="hover:text-accent transition-colors">
              {t['nav.archive'] ?? 'Archiv'}
            </Link>
          </div>
        </main>
        <SiteFooter locale={locale} />
      </div>
    </>
  )
}
