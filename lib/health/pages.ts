import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Die zu prüfenden öffentlichen Seiten.
 *
 * Bewusst QUER durch alle Seitentypen, nicht nur die Startseite: Beim Ausfall
 * am 2026-08-25 lieferten die Locale-Startseiten weiter 200 aus dem Edge-Cache,
 * während sämtliche Artikelseiten 500 warfen. Eine Prüfung, die nur „/de"
 * abfragt, hätte den Totalausfall der Artikel nicht bemerkt.
 *
 * Artikel, Begriff und Produkt werden zur Laufzeit aus der Datenbank gezogen,
 * damit die Liste mit dem Bestand mitwandert statt auf gelöschte Slugs zu zeigen.
 */
export async function buildPageList(supabase: AdminClient, baseUrl: string): Promise<string[]> {
  const paths: string[] = [
    '/de',
    '/en',
    '/de/rankings',
    '/de/glossary',
    '/de/archive',
    '/sitemap.xml',
    '/feed.xml',
  ]

  const [post, term, product] = await Promise.all([
    supabase.from('generated_posts').select('slug').eq('status', 'published')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('glossary_terms').select('slug').eq('status', 'published')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('products').select('slug').eq('visibility_status', 'visible')
      .limit(1).maybeSingle(),
  ])

  // Der jüngste Artikel in zwei Sprachen: die Übersetzungsstrecke ist ein
  // eigener Renderpfad und kann getrennt kaputtgehen.
  if (post.data?.slug) {
    paths.push(`/de/posts/${post.data.slug}`)
    paths.push(`/en/posts/${post.data.slug}`)
  }
  if (term.data?.slug) paths.push(`/de/glossary/${term.data.slug}`)
  if (product.data?.slug) paths.push(`/de/rankings/${product.data.slug}`)

  const base = baseUrl.replace(/\/$/, '')
  return paths.map((p) => `${base}${p}`)
}
