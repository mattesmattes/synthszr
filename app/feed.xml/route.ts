import { createAnonClient } from '@/lib/supabase/admin'
import { SITE_URL } from '@/lib/seo/site'
import { cleanMetaDescription } from '@/lib/i18n/metadata'

export const revalidate = 600

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** RSS 2.0 der letzten 50 veröffentlichten Posts (de) — Crawl-Frische-Signal
 *  für Google und Kanal für Feedreader/Aggregatoren. */
export async function GET() {
  const supabase = createAnonClient()
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('title, slug, excerpt, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(50)

  const items = (posts ?? [])
    .map(
      (p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE_URL}/de/posts/${p.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/de/posts/${p.slug}</guid>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>${
        p.excerpt ? `\n      <description>${esc(cleanMetaDescription(p.excerpt, 300))}</description>` : ''
      }
    </item>`,
    )
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Synthszr</title>
    <link>${SITE_URL}/de</link>
    <description>Die tägliche News-Synthese zu KI: Business, Design und Technologie.</description>
    <language>de</language>${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  })
}
