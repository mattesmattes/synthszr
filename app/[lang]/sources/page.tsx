import Link from 'next/link'
import { ArrowLeft, Mail, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface NewsletterSource {
  id: string
  email: string
  name: string | null
  url: string | null
  enabled: boolean
}

interface PageProps {
  params: Promise<{ lang: string }>
}

// Try to derive a website URL from email domain
function deriveWebsiteFromEmail(email: string): string | null {
  const domain = email.split('@')[1]
  if (!domain) return null

  // Skip generic email providers
  const genericProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'googlemail.com']
  if (genericProviders.includes(domain.toLowerCase())) return null

  // Handle subdomains (e.g., newsletter.example.com -> example.com)
  const parts = domain.split('.')
  if (parts.length > 2) {
    // Keep last two parts for most domains (e.g., example.com)
    // But keep three for country TLDs (e.g., example.co.uk)
    const countryTlds = ['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br']
    const lastThree = parts.slice(-3).join('.')
    if (countryTlds.some(tld => lastThree.endsWith(tld))) {
      return `https://${parts.slice(-3).join('.')}`
    }
    return `https://${parts.slice(-2).join('.')}`
  }

  return `https://${domain}`
}

export default async function SourcesPage({ params }: PageProps) {
  const { lang } = await params
  const locale = lang as LanguageCode
  const supabase = await createClient()
  const t = await getTranslations(locale)

  // Fetch active newsletter sources
  const { data: sources, error } = await supabase
    .from('newsletter_sources')
    .select('id, email, name, url, enabled')
    .eq('enabled', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('[sources] Query error:', error)
  }

  // Sort alphabetically by name (or email if no name)
  const sortedSources = (sources || [])
    .map(s => ({
      ...s,
      displayName: s.name || s.email.split('@')[0],
      derivedUrl: s.url || deriveWebsiteFromEmail(s.email)
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <Link
          href={`/${locale}`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t['sources.back'] || t['companies.back'] || 'Zurück'}
        </Link>

        <div className="mb-12 border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t['sources.title'] || 'Newsletter-Quellen'}</h1>
          <p className="mt-2 text-muted-foreground">
            {(t['sources.description'] || '{count} Newsletter-Quellen für die tägliche Analyse').replace('{count}', String(sortedSources.length))}
          </p>
        </div>

        {sortedSources.length > 0 ? (
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t['sources.name'] || 'Newsletter'}
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t['sources.link'] || 'Website'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedSources.map((source) => (
                  <tr key={source.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{source.displayName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{source.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {source.derivedUrl ? (
                        <a
                          href={source.derivedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {new URL(source.derivedUrl).hostname.replace('www.', '')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-20 text-center">
            <Mail className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-muted-foreground">
              {t['sources.empty'] || 'Keine Newsletter-Quellen konfiguriert.'}
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <Link href={`/${locale}`} className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← {t['sources.back_home'] || t['companies.back_home'] || 'Zurück zur Startseite'}
          </Link>
        </div>
      </footer>
    </div>
  )
}
