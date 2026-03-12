import { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_LOCALE } from '@/lib/i18n/config'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://synthszr.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient()

  // Fetch active languages
  const { data: languages } = await supabase
    .from('languages')
    .select('code')
    .eq('is_active', true)

  const activeLocales = languages?.map(l => l.code) || [DEFAULT_LOCALE]

  // Fetch all published posts
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('slug, created_at, updated_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })

  // Fetch completed translations for posts
  const { data: translations } = await supabase
    .from('content_translations')
    .select('generated_post_id, language_code, slug')
    .eq('translation_status', 'completed')

  // Create a map of post ID to available translations
  const postTranslations = new Map<string, Set<string>>()
  translations?.forEach(t => {
    if (t.generated_post_id) {
      if (!postTranslations.has(t.generated_post_id)) {
        postTranslations.set(t.generated_post_id, new Set())
      }
      postTranslations.get(t.generated_post_id)?.add(t.language_code)
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
        lastModified: new Date(),
        changeFrequency: page === '' ? 'daily' : 'monthly',
        priority: page === '' ? 1 : (locale === DEFAULT_LOCALE ? 0.8 : 0.6),
        alternates: { languages: alternates },
      })
    }
  }

  // Posts - each available locale gets its own <url> entry
  for (const post of posts || []) {
    const availableTranslations = postTranslations.get(post.slug) || new Set()

    // Collect all available locales for this post
    const availableLocales = [DEFAULT_LOCALE]
    for (const locale of activeLocales) {
      if (locale !== DEFAULT_LOCALE && availableTranslations.has(locale)) {
        availableLocales.push(locale)
      }
    }

    // Build alternates map
    const alternates: Record<string, string> = {
      'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/posts/${post.slug}`,
    }
    for (const locale of availableLocales) {
      alternates[locale] = `${BASE_URL}/${locale}/posts/${post.slug}`
    }

    // Create a <url> entry for each available locale
    for (const locale of availableLocales) {
      sitemap.push({
        url: `${BASE_URL}/${locale}/posts/${post.slug}`,
        lastModified: new Date(post.updated_at || post.created_at),
        changeFrequency: 'weekly',
        priority: locale === DEFAULT_LOCALE ? 0.9 : 0.7,
        alternates: { languages: alternates },
      })
    }
  }

  return sitemap
}
