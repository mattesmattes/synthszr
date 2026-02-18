import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { TiptapRenderer } from '@/components/tiptap-renderer'
import { ConsentSettingsButton } from '@/components/consent-banner'
import { LanguageSwitcher } from '@/components/language-switcher'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const t = await getTranslations(lang as LanguageCode)

  return generateLocalizedMetadata({
    title: t['privacy.title'] || 'Datenschutz | Synthszr',
    description: t['privacy.description'] || 'Datenschutzerklärung und Informationen zur Datenverarbeitung',
    path: '/datenschutz',
  })
}

export default async function DatenschutzPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = await createClient()

  // Fetch original page
  const { data: page } = await supabase
    .from('static_pages')
    .select('*')
    .eq('slug', 'datenschutz')
    .single()

  // Try to get translation if not default locale
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

  // Use translation if available, otherwise fall back to original
  const title = translatedTitle || page?.title || 'Datenschutzerklärung'
  const content = translatedContent || page?.content || {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Datenschutzerklärung wird geladen...' }] }]
  }

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
            <TiptapRenderer content={content} />
          </div>

          {/* Consent Settings Button - not part of translated content */}
          <section className="mt-8 pt-6 border-t border-border">
            <h2 className="text-lg font-semibold mb-2">
              {locale === 'de' ? 'Einstellungen ändern' : 'Change Settings'}
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              {locale === 'de'
                ? 'Sie können Ihre Datenschutz-Einstellungen jederzeit ändern:'
                : 'You can change your privacy settings at any time:'}
            </p>
            <ConsentSettingsButton />
          </section>

          <div className="mt-8 pt-6 border-t text-xs text-muted-foreground">
            <p>Stand: Januar 2026</p>
          </div>
        </article>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-6">
              <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                <img src="/oh-so-logo.svg" alt="OH-SO" className="h-9" />
              </a>
              <LanguageSwitcher currentLocale={locale} />
            </div>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href={`/${locale}/sources`} className="hover:text-accent transition-colors">
                {t['footer.sources'] || 'Sources'}
              </a>
              <Link href={`/${locale}/impressum`} className="hover:text-accent transition-colors">
                {t['footer.imprint'] || 'Impressum'}
              </Link>
              <Link href={`/${locale}/datenschutz`} className="font-bold">
                {t['footer.privacy'] || 'Datenschutz'}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
