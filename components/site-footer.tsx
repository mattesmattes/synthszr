import Link from 'next/link'
import { Suspense } from 'react'
import { FooterBrands } from './footer-brands'
import { LanguageSwitcher } from './language-switcher'
import { Newsletter } from './newsletter'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'

/** Vollständiger Seiten-Footer (wie auf /home): Newsletter-Anmeldung + Brand-Footer
 *  mit Sprach-Switcher und rechtlichen Links. */
export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations(locale as LanguageCode)
  return (
    <>
      <Newsletter locale={locale as LanguageCode} />
      <footer className="border-t border-border mt-12">
        <div className="mx-auto w-[704px] max-w-full px-6 py-12">
          <div className="flex flex-col items-center gap-6">
            <FooterBrands />
            <div className="flex flex-wrap items-center justify-center gap-6 text-xs">
              <Suspense fallback={null}>
                <LanguageSwitcher currentLocale={locale as LanguageCode} />
              </Suspense>
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href={`/${locale}/sources`} className="hover:text-accent transition-colors">
                {t['footer.sources'] || 'Sources'}
              </a>
              <Link href={`/${locale}/impressum`} className="hover:text-accent transition-colors">
                Imprint
              </Link>
              <Link href={`/${locale}/datenschutz`} className="hover:text-accent transition-colors">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
