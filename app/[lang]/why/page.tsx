import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { Newsletter } from "@/components/newsletter"
import { LanguageSwitcher } from "@/components/language-switcher"
import { ArrowLeft } from "lucide-react"
import { getTranslations } from "@/lib/i18n/get-translations"
import { generateLocalizedMetadata } from "@/lib/i18n/metadata"
import type { LanguageCode } from "@/lib/types"
import type { Metadata } from "next"

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const t = await getTranslations(lang as LanguageCode)

  return generateLocalizedMetadata({
    title: t['why.title'] || 'Feed the Soul. Run the System. | Synthszr',
    description: t['why.description'] || 'Die News Synthese zum Start in den Tag.',
    path: '/why',
  })
}

export default async function WhyPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = await createClient()

  // Fetch original page
  const { data: page } = await supabase
    .from("static_pages")
    .select("*")
    .eq("slug", "why")
    .single()

  // Try to get translation if not default locale
  let translatedTitle: string | null = null
  let translatedContent: Record<string, unknown> | null = null

  if (page && locale !== 'de') {
    const { data: translation } = await supabase
      .from("content_translations")
      .select("title, content")
      .eq("static_page_id", page.id)
      .eq("language_code", locale)
      .eq("translation_status", "completed")
      .single()

    if (translation) {
      translatedTitle = translation.title
      translatedContent = translation.content as Record<string, unknown>
    }
  }

  // Use translation if available, otherwise fall back to original
  const title = translatedTitle || page?.title || "Feed the Soul. Run the System."
  const content = translatedContent || page?.content || {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: t['why.default_content'] || "Die News Synthese zum Start in den Tag." }]
      }
    ]
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <article>
          <header className="mb-12 border-b border-border pb-8">
            <Link
              href={`/${locale}`}
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-3 w-3" />
              {t['common.back_home'] || 'Zurück zur Startseite'}
            </Link>
            <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{title}</h1>
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-p:mb-5 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
            <div className="prose-article">
              <TiptapRenderer content={content} />
            </div>
          </div>
        </article>

        <Newsletter locale={locale} />
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
              <Link href={`/${locale}/datenschutz`} className="hover:text-accent transition-colors">
                {t['footer.privacy'] || 'Datenschutz'}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
