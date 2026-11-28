import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAnonClient } from '@/lib/supabase/admin'
import { PostContentView } from '@/components/post-content-view'
import { ConsentSettingsButton } from '@/components/consent-banner'
import { SiteFooter } from '@/components/site-footer'
import { getTranslations } from '@/lib/i18n/get-translations'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import type { LanguageCode } from '@/lib/types'

// ISR statt force-dynamic: Anon-Client (kein cookies()) erlaubt Prerender +
// Edge-Cache. Inhalte ändern sich selten; Frische kommt über revalidate.
export const revalidate = 86400

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
    locale: lang as LanguageCode,
  })
}

export default async function DatenschutzPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const t = await getTranslations(locale)
  const supabase = createAnonClient()

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
            <PostContentView content={content as Record<string, unknown>} locale={locale} />
          </div>

          {/* Synthszr Browser Extension & App Privacy Notice */}
          <section id="browser-extension" className="mt-10 pt-6 border-t border-border space-y-3 text-sm leading-relaxed">
            <h2 className="text-lg font-semibold">
              {locale === 'de'
                ? 'Synthszr Lexikon Browser-Erweiterung & Safari-App'
                : 'Synthszr Lexikon Browser Extension & Safari App'}
            </h2>
            {locale === 'de' ? (
              <>
                <p className="text-muted-foreground">
                  Die Erweiterung <strong>Synthszr Lexikon</strong> (für Safari auf macOS/iOS sowie Google Chrome) erkennt KI- und Tech-Begriffe direkt auf den von Ihnen geöffneten Webseiten.
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                  <li>
                    <strong>100 % lokale Begriffserkennung:</strong> Der gesamte Abgleich zwischen Webseiten-Text und Lexikon-Begriffen läuft ausschließlich lokal im Arbeitsspeicher Ihres Browsers. Es werden zu keinem Zeitpunkt besuchte URLs, Ihr Browserverlauf oder Seiteninhalte an Synthszr oder Dritte übertragen.
                  </li>
                  <li>
                    <strong>Abruf des Begriffs-Index &amp; einzelner Einträge:</strong> Die Erweiterung lädt regelmäßig den öffentlichen Begriffs-Index über <code>synthszr.com/api/glossary/extension-index</code> und speichert ihn lokal im Browser (<code>storage.local</code>). Erst wenn Sie aktiv auf einen markierten Begriff klicken, wird der zugehörige Eintrag (<code>/api/glossary/term/[slug]</code>) inklusive Illustration abgerufen — ohne Benutzerkonto, Cookies oder Tracking-IDs.
                  </li>
                  <li>
                    <strong>Lokale Einstellungen:</strong> Ihre Präferenzen (Aktivierungsstatus, Sprache, Markierungsstil, pausierte Domains) werden ausschließlich lokal bzw. über Ihren Browser-Sync (<code>storage.sync</code> / <code>storage.local</code>) gespeichert.
                  </li>
                  <li>
                    <strong>Kein Tracking, keine Werbung:</strong> Die Erweiterung und die dazugehörige Safari-App enthalten keinerlei Analyse-, Telemetrie-, Werbe- oder Tracking-SDKs und geben keine Daten an Dritte weiter.
                  </li>
                </ul>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  The <strong>Synthszr Lexikon</strong> browser extension (for Safari on macOS/iOS and Google Chrome) highlights and explains AI and technology terms directly on webpages you view.
                </p>
                <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                  <li>
                    <strong>100% Local On-Device Matching:</strong> All text scanning and term matching run exclusively inside your browser&apos;s local memory. Browsing history, visited URLs, and webpage contents are never transmitted to Synthszr or any third party.
                  </li>
                  <li>
                    <strong>Glossary Index &amp; On-Click Requests:</strong> The extension fetches the public glossary term index from <code>synthszr.com/api/glossary/extension-index</code> and caches it locally (<code>storage.local</code>). Network requests for full definitions and illustrations (<code>/api/glossary/term/[slug]</code>) happen strictly on demand when you explicitly click a term — without accounts, cookies, or user identifiers.
                  </li>
                  <li>
                    <strong>Local Preferences Only:</strong> Your settings (enabled state, language mode, highlight style, paused domains) are stored solely in your browser&apos;s extension storage (<code>storage.sync</code> / <code>storage.local</code>).
                  </li>
                  <li>
                    <strong>Zero Tracking or Third-Party Sharing:</strong> Neither the browser extension nor the companion Safari app includes any analytics, telemetry, advertising, or tracking SDKs, and no personal data is collected or shared.
                  </li>
                </ul>
              </>
            )}
          </section>

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
            <p>{locale === 'de' ? 'Stand: November 2026' : 'Last updated: November 2026'}</p>
          </div>
        </article>
      </main>

      <SiteFooter locale={locale} showNewsletter={false} />
    </div>
  )
}
