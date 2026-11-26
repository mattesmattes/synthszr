import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { buildMomentumMapData } from '@/lib/rankings/momentum-map'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { MomentumMapViewer } from '@/components/rankings/momentum-map-viewer'
import { MomentumMapArticle } from '@/components/rankings/momentum-map-article'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const locale = lang as LanguageCode
  return generateLocalizedMetadata({
    title: 'SYNTHSZR MOMENTUM MAP — Monthly A2 AI Poster | Synthszr Charts',
    description:
      'Monthly collectible DIN A2 vector poster mapping 90 days of AI product momentum across 16 categories and 80 tracked products from Synthszr Charts.',
    path: '/rankings/poster',
    locale,
  })
}

export default async function MomentumMapPosterPage({ params }: PageProps) {
  const { lang } = await params
  const data = await buildMomentumMapData()
  const de = lang === 'de'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
          <Link
            href={`/${lang}/rankings`}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {de ? 'Zurück zu Synthszr Charts' : 'Back to Synthszr Charts'}
          </Link>
          <Suspense fallback={null}>
            <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
          </Suspense>
        </div>

        <MomentumMapViewer data={data} locale={lang} />
        <MomentumMapArticle data={data} locale={lang} />
      </main>
      <div className="print:hidden">
        <SiteFooter locale={lang as LanguageCode} />
      </div>
    </div>
  )
}
