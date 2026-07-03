import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAnonClient } from '@/lib/supabase/admin'
import { fetchAllCompanyMentions } from '@/lib/companies/mention-rows'
import { CompaniesListClient } from '@/app/companies/companies-list-client'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { SITE_URL, safeJsonLd } from '@/lib/seo/site'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

export const revalidate = 7200

interface CompanyAggregation {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
}

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  return generateLocalizedMetadata({
    title: 'Companies — Synthszr',
    description: 'Alle erwähnten Unternehmen mit Synthszr-Bewertungen',
    path: '/companies',
    locale: lang as LanguageCode,
  })
}

export default async function CompaniesPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const supabase = createAnonClient()
  const t = await getTranslations(locale)

  // Fetch all company mentions from published posts
  let mentions: Awaited<ReturnType<typeof fetchAllCompanyMentions>> = []
  try {
    mentions = await fetchAllCompanyMentions(supabase)
  } catch (error) {
    console.error('[companies] Query error:', error)
  }

  // Aggregate by company (case-insensitive slug to merge duplicates like "Anthropic" and "anthropic")
  const companyMap = new Map<string, CompanyAggregation>()

  for (const mention of mentions) {
    const normalizedSlug = mention.company_slug.toLowerCase()
    const existing = companyMap.get(normalizedSlug)
    if (existing) {
      existing.mentionCount++
    } else {
      companyMap.set(normalizedSlug, {
        name: mention.company_name,
        slug: normalizedSlug, // Use normalized slug
        type: mention.company_type,
        mentionCount: 1,
      })
    }
  }

  // Sort alphabetically
  const companies = Array.from(companyMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'Companies' },
    ],
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />
        <Link
          href={`/${locale}`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t['companies.back']}
        </Link>

        <div className="mb-12 border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t['companies.title']}</h1>
          <p className="mt-2 text-muted-foreground">
            {t['companies.description'].replace('{count}', String(companies.length))}
          </p>
        </div>

        {companies.length > 0 ? (
          <CompaniesListClient companies={companies} locale={locale} />
        ) : (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">
              {t['companies.empty']}
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href={`/${locale}`} className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← {t['companies.back_home']}
          </Link>
        </div>
      </footer>
    </div>
  )
}
