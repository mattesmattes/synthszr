import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAnonClient } from '@/lib/supabase/admin'
import { PostContentView } from '@/components/post-content-view'
import { SiteFooter } from '@/components/site-footer'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import type { LanguageCode } from '@/lib/types'
import type { Metadata } from 'next'

// ISR statt force-dynamic: Anon-Client (kein cookies()) erlaubt Prerender +
// Edge-Cache. Inhalte ändern sich selten; Frische kommt über revalidate.
export const revalidate = 86400

interface PageProps {
  params: Promise<{ lang: string }>
}

// Eigene Seite statt nur ein Verweis im Impressum (is-agentic-Scan
// 2026-09-16, "Trust anchor pages" — About/Privacy erkannt, Contact fehlte).
// Kontaktdaten sind dieselben bereits öffentlichen Angaben wie im Impressum.
const DEFAULT_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Fragen, Presseanfragen oder Feedback zu Synthszr erreichen uns per E-Mail:' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'hi@oh-so.com', marks: [{ type: 'bold' }] }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Vollständige Firmen- und Registerangaben stehen im ' },
        { type: 'text', text: 'Impressum', marks: [{ type: 'link', attrs: { href: '/impressum' } }] },
        { type: 'text', text: '.' },
      ],
    },
  ],
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params

  return generateLocalizedMetadata({
    title: 'Kontakt | Synthszr',
    description: 'Kontakt zu Synthszr — Fragen, Presseanfragen und Feedback.',
    path: '/contact',
    locale: lang as LanguageCode,
  })
}

export default async function ContactPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = createAnonClient()

  const { data: page } = await supabase
    .from('static_pages')
    .select('*')
    .eq('slug', 'contact')
    .single()

  let translatedTitle: string | null = null
  let translatedContent: Record<string, unknown> | null = null

  if (page && locale !== 'de') {
    const { data: translation } = await supabase
      .from('content_translations')
      .select('title, content')
      .eq('static_page_id', page.id)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .single()

    if (translation) {
      translatedTitle = translation.title
      translatedContent = translation.content as Record<string, unknown>
    }
  }

  const title = translatedTitle || page?.title || 'Kontakt'
  const content = translatedContent || page?.content || DEFAULT_CONTENT

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <article>
          <header className="mb-8 border-b border-border pb-6">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-3 w-3" />
              {t['common.back_home'] || 'Zurück zur Startseite'}
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </header>

          <div className="prose prose-sm dark:prose-invert max-w-none">
            <PostContentView content={content as Record<string, unknown>} locale={locale} />
          </div>
        </article>
      </main>

      <SiteFooter locale={locale} showNewsletter={false} />
    </div>
  )
}
