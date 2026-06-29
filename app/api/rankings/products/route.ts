import { NextResponse } from 'next/server'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Liefert die in den Charts sichtbaren Produkte (Name + Slug + Momentum-Score +
 * 30-Tage-Sparkline) für die Produkt-Verlinkung im Blog-Renderer. Nur Produkte
 * mit ≥2 Erwähnungen (= echtes Chart-Profil). Der Score ist KATEGORIE-relativ
 * (konsistent zur Produktseite): pro primärer Kategorie auf den Spitzenreiter
 * normalisiert, statt global.
 */
export async function GET() {
  try {
    const products = await getRankedProducts({ limit: 500, minMentions: 2 })

    // primäre Kategorie je Produkt → Score relativ zum Kategorie-Spitzenreiter
    const supabase = createAdminClient()
    const { data: memb } = await supabase
      .from('product_category_membership')
      .select('product_id, category')
      .eq('is_primary', true)
    const primaryCat = new Map((memb ?? []).map((m) => [m.product_id as string, m.category as string]))

    const maxByCat = new Map<string, number>()
    for (const p of products) {
      const cat = primaryCat.get(p.id) ?? '__none'
      maxByCat.set(cat, Math.max(maxByCat.get(cat) ?? 0, p.momentum))
    }

    return NextResponse.json(
      {
        products: products.map((p) => {
          const cat = primaryCat.get(p.id) ?? '__none'
          const max = maxByCat.get(cat) ?? 0
          return {
            name: p.canonicalName,
            slug: p.slug,
            score: max > 0 ? Math.round((p.momentum / max) * 100) : 0,
            spark: p.history.slice(-30).map((h) => Math.round(h.value * 100) / 100),
          }
        }),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ products: [] }, { status: 200 })
  }
}
