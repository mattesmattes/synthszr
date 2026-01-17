import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CompaniesListClient } from '@/app/companies/companies-list-client'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CompanyMention {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  created_at: string
}

interface CompanyAggregation {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
}

interface PageProps {
  params: Promise<{ lang: string }>
}

export default async function CompaniesPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()
  const t = await getTranslations(locale)

  // Fetch all company mentions from published posts
  const { data: mentions, error } = await supabase
    .from('post_company_mentions')
    .select(`
      company_name,
      company_slug,
      company_type,
      created_at,
      post:generated_posts!inner(status)
    `)
    .eq('post.status', 'published')

  if (error) {
    console.error('[companies] Query error:', error)
  }

  // Aggregate by company
  const companyMap = new Map<string, CompanyAggregation>()

  for (const mention of (mentions || []) as unknown as CompanyMention[]) {
    const existing = companyMap.get(mention.company_slug)
    if (existing) {
      existing.mentionCount++
    } else {
      companyMap.set(mention.company_slug, {
        name: mention.company_name,
        slug: mention.company_slug,
        type: mention.company_type,
        mentionCount: 1,
      })
    }
  }

  // Sort alphabetically
  const companies = Array.from(companyMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
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
