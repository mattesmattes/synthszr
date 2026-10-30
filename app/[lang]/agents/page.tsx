import { Suspense } from 'react'
import type { Metadata } from 'next'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { SiteFooter } from '@/components/site-footer'
import { ALL_LOCALES, DEFAULT_LOCALE, LANGUAGE_NAMES } from '@/lib/i18n/config'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { skillUrl } from '@/lib/agents/discovery'
import { AGENT_SKILL_INSTALL, AGENT_SKILL_REPOSITORY, agentReadingCopy } from '@/lib/agents/reading'
import type { LanguageCode } from '@/lib/types'

export const revalidate = 86400

interface PageProps {
  params: Promise<{ lang: string }>
}

const languages = ALL_LOCALES.map((code) => ({
  code,
  name: LANGUAGE_NAMES[code].name,
  native_name: LANGUAGE_NAMES[code].native,
  is_default: code === DEFAULT_LOCALE,
}))

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const copy = agentReadingCopy(lang)
  return generateLocalizedMetadata({
    title: `${copy.navLabel} | Synthszr`,
    description: copy.intro,
    path: '/agents',
    locale: lang as LanguageCode,
  })
}

export default async function AgentsPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode // validated by the locale layout
  const copy = agentReadingCopy(locale)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto w-[704px] max-w-full px-6 pt-12 md:pt-20">
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={locale} languages={languages} />
        </Suspense>
      </header>
      <main className="mx-auto w-[704px] max-w-full px-6 pb-12 pt-6 md:pb-20">
        <article>
          <header className="mb-8 border-b border-border pb-6">
            <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
            <p className="mt-4 leading-relaxed text-muted-foreground">{copy.intro}</p>
            <a href={skillUrl('agentpage')} className="mt-4 inline-block font-medium underline underline-offset-4">{copy.skillLabel} →</a>
          </header>
          <section aria-labelledby="agent-installation" className="space-y-4">
            <h2 id="agent-installation" className="text-xl font-semibold">{copy.detailsLabel}</h2>
            <p className="leading-relaxed">{copy.installLabel}</p>
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-secondary/40 p-4 font-mono text-xs leading-relaxed"><code>{AGENT_SKILL_INSTALL}</code></pre>
            <a href={AGENT_SKILL_REPOSITORY} className="inline-block underline underline-offset-4">{copy.installHelp} →</a>
            <p className="leading-relaxed text-muted-foreground">{copy.manualHelp}</p>
          </section>
          <section aria-labelledby="agent-example" className="mt-10 space-y-4">
            <h2 id="agent-example" className="text-xl font-semibold">{copy.exampleLabel}</h2>
            <blockquote className="break-words border-l-2 border-foreground/30 pl-4 leading-relaxed">{copy.example}</blockquote>
            <p className="text-sm leading-relaxed text-muted-foreground">{copy.consent}</p>
          </section>
        </article>
      </main>
      <SiteFooter locale={locale} showNewsletter={false} languages={languages} />
    </div>
  )
}
