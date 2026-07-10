import { MetadataRoute } from 'next'
import { createAnonClient } from '@/lib/supabase/admin'
import { DEFAULT_LOCALE, SEO_LOCALES } from '@/lib/i18n/config'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { fetchAllCompanyMentions } from '@/lib/companies/mention-rows'
import { categorySlugsWithIntro } from '@/lib/rankings/category-intros'
import { AUTHOR } from '@/lib/data/author'

// ISR statt voll-dynamisch: der cookie-freie Anon-Client erlaubt Prerender +
// stündliche Regenerierung. Wichtig für Googlebot: schlägt eine Regenerierung
// fehl (DB-Hickup, Deploy), liefert Vercel die letzte gute XML-Version statt
// einer HTML-Fehlerseite — genau das hatte GSC als "Sitemap ist HTML" moniert.
export const revalidate = 3600

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.synthszr.com'

// Only SEO locales (de/en) appear as <url> entries. cs/nds/fr stay reachable
// for users but canonicalize to /de and are excluded here — listing them
// wasted crawl budget and produced "Crawled – currently not indexed" in GSC.
const FULL_CONTENT_LOCALES = SEO_LOCALES

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAnonClient()

  // Fetch active languages
  const { data: languages } = await supabase
    .from('languages')
    .select('code')
    .eq('is_active', true)

  const activeLocales = (languages?.map(l => l.code) || [DEFAULT_LOCALE])
    .filter(code => FULL_CONTENT_LOCALES.includes(code as typeof SEO_LOCALES[number]))

  // Fetch all published posts (id needed to match translations)
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, slug, created_at, updated_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })

  // Fetch completed translations for posts
  const { data: translations } = await supabase
    .from('content_translations')
    .select('generated_post_id, language_code, slug')
    .eq('translation_status', 'completed')

  // Map post ID → (locale → translated slug). The translated slug is what the
  // page actually serves under /{locale}/posts/… — previously the German slug
  // was written into every locale's <url>, producing duplicate/404 entries.
  const postTranslations = new Map<string, Map<string, string>>()
  translations?.forEach(t => {
    if (t.generated_post_id && t.slug) {
      if (!postTranslations.has(t.generated_post_id)) {
        postTranslations.set(t.generated_post_id, new Map())
      }
      postTranslations.get(t.generated_post_id)?.set(t.language_code, t.slug)
    }
  })

  // Build sitemap entries
  const sitemap: MetadataRoute.Sitemap = []

  // Static pages - available in all active languages
  const staticPages = ['', '/archive', '/why', '/datenschutz', '/impressum', '/companies', '/sources']

  // Static pages - each locale gets its own <url> entry with full alternates
  for (const page of staticPages) {
    const alternates: Record<string, string> = {}
    for (const locale of activeLocales) {
      alternates[locale] = `${BASE_URL}/${locale}${page}`
    }
    alternates['x-default'] = `${BASE_URL}/${DEFAULT_LOCALE}${page}`

    for (const locale of activeLocales) {
      sitemap.push({
        url: `${BASE_URL}/${locale}${page}`,
        changeFrequency: page === '' ? 'daily' : 'monthly',
        priority: page === '' ? 1 : (locale === DEFAULT_LOCALE ? 0.8 : 0.6),
        alternates: { languages: alternates },
      })
    }
  }

  // Posts - each available locale gets its own <url> entry with its own
  // (translated) slug.
  for (const post of posts || []) {
    const translationSlugs = postTranslations.get(post.id) || new Map<string, string>()

    // Collect all available locales for this post with their locale-specific slug
    const localeSlugs = new Map<string, string>([[DEFAULT_LOCALE, post.slug]])
    for (const locale of activeLocales) {
      if (locale !== DEFAULT_LOCALE && translationSlugs.has(locale)) {
        localeSlugs.set(locale, translationSlugs.get(locale)!)
      }
    }

    // Build alternates map
    const alternates: Record<string, string> = {
      'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/posts/${post.slug}`,
    }
    for (const [locale, slug] of localeSlugs) {
      alternates[locale] = `${BASE_URL}/${locale}/posts/${slug}`
    }

    // Create a <url> entry for each available locale
    for (const [locale, slug] of localeSlugs) {
      sitemap.push({
        url: `${BASE_URL}/${locale}/posts/${slug}`,
        lastModified: new Date(post.updated_at || post.created_at),
        changeFrequency: 'weekly',
        priority: locale === DEFAULT_LOCALE ? 0.9 : 0.7,
        alternates: { languages: alternates },
      })
    }
  }

  // Rankings-Übersicht: alle Public-Locales (UI ist übersetzt).
  const rankingsAlternates: Record<string, string> = {
    'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/rankings`,
  }
  for (const locale of activeLocales) {
    rankingsAlternates[locale] = `${BASE_URL}/${locale}/rankings`
  }
  for (const locale of activeLocales) {
    sitemap.push({
      url: `${BASE_URL}/${locale}/rankings`,
      changeFrequency: 'daily',
      priority: locale === DEFAULT_LOCALE ? 0.9 : 0.7,
      alternates: { languages: rankingsAlternates },
    })
  }

  // Produkt-Detailseiten: nur chartbare Produkte mit ≥2 Mentions (gleiches
  // Kriterium wie das Leaderboard) — dünnere Seiten bleiben draußen. Nur
  // de/en: andere Locales liefern EN-Fallback-Content (kein hreflang-Cluster).
  try {
    const products = await getRankedProducts({ limit: 10_000, minMentions: 2 })
    const PRODUCT_LOCALES = ['de', 'en'] as const
    for (const p of products) {
      const alternates: Record<string, string> = {
        'x-default': `${BASE_URL}/de/rankings/${p.slug}`,
        de: `${BASE_URL}/de/rankings/${p.slug}`,
        en: `${BASE_URL}/en/rankings/${p.slug}`,
      }
      for (const loc of PRODUCT_LOCALES) {
        sitemap.push({
          url: `${BASE_URL}/${loc}/rankings/${p.slug}`,
          ...(p.lastSeen ? { lastModified: new Date(p.lastSeen) } : {}),
          changeFrequency: 'daily',
          priority: loc === 'de' ? 0.7 : 0.5,
          alternates: { languages: alternates },
        })
      }
    }
  } catch (e) {
    // Sitemap darf bei DB-Hickup nicht komplett ausfallen — Posts/Static bleiben.
    console.error('sitemap: rankings section failed', e)
  }

  // Company-Detailseiten: distinct Slugs aus den Mentions veröffentlichter
  // Posts (gleiche Quelle wie der /companies-Index). Lowercase-normalisiert —
  // die Seite ist case-insensitiv (ilike), kanonisch ist die Kleinschreibung.
  try {
    const companyMentions = await fetchAllCompanyMentions(supabase)
    const companySlugs = [...new Set(
      companyMentions.map((m) => m.company_slug.toLowerCase())
    )]
    for (const slug of companySlugs) {
      const alternates: Record<string, string> = {
        'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/companies/${encodeURIComponent(slug)}`,
      }
      for (const locale of activeLocales) {
        alternates[locale] = `${BASE_URL}/${locale}/companies/${encodeURIComponent(slug)}`
      }
      for (const locale of activeLocales) {
        sitemap.push({
          url: `${BASE_URL}/${locale}/companies/${encodeURIComponent(slug)}`,
          changeFrequency: 'weekly',
          priority: locale === DEFAULT_LOCALE ? 0.6 : 0.4,
          alternates: { languages: alternates },
        })
      }
    }
  } catch (e) {
    console.error('sitemap: companies section failed', e)
  }

  // Kategorie-Landingpages (nur die mit gepflegtem Intro-Text — keine Thin
  // Pages): /{locale}/rankings?category={slug}. Query-Param-URLs, aber
  // self-canonical (siehe rankings/page.tsx) und mit echtem Content.
  for (const slug of categorySlugsWithIntro()) {
    const alternates: Record<string, string> = {
      'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/rankings?category=${slug}`,
    }
    for (const locale of activeLocales) {
      alternates[locale] = `${BASE_URL}/${locale}/rankings?category=${slug}`
    }
    for (const locale of activeLocales) {
      sitemap.push({
        url: `${BASE_URL}/${locale}/rankings?category=${slug}`,
        changeFrequency: 'daily',
        priority: locale === DEFAULT_LOCALE ? 0.6 : 0.4,
        alternates: { languages: alternates },
      })
    }
  }

  // Autorenseite (E-E-A-T).
  const authorAlternates: Record<string, string> = {
    'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/author/${AUTHOR.slug}`,
  }
  for (const locale of activeLocales) {
    authorAlternates[locale] = `${BASE_URL}/${locale}/author/${AUTHOR.slug}`
  }
  for (const locale of activeLocales) {
    sitemap.push({
      url: `${BASE_URL}/${locale}/author/${AUTHOR.slug}`,
      changeFrequency: 'monthly',
      priority: 0.4,
      alternates: { languages: authorAlternates },
    })
  }

  return sitemap
}
