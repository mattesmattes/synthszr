import { NextResponse } from 'next/server'
import { getCategoryCappedProducts } from '@/lib/rankings/leaderboard'
import { toDisplayScore } from '@/lib/rankings/score'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Liefert die in den Charts sichtbaren Produkte (Name + Slug + Momentum-Score +
 * 30-Tage-Sparkline) für die Produkt-Verlinkung im Blog-Renderer. Harter Cut:
 * nur Produkte in den Top 50 ihrer primären Kategorie (bzw. global Top 50 ohne
 * Kategorie) — Long-Tail-Produkte mit Rängen wie #82 tauchen in Artikeln nicht
 * mehr auf. Der Score ist KATEGORIE-relativ (konsistent zur Produktseite);
 * Ränge werden in getCategoryCappedProducts über den vollen Satz berechnet.
 */
export async function GET() {
  try {
    const capped = await getCategoryCappedProducts(50)

    // Nur recherchierte Produkte (mit Beschreibung) fürs Auto-Verlinken im Blog —
    // keine leeren Stubs. DB-Fehler → ungefiltert (nicht schlechter als vorher).
    let researched = capped
    try {
      const supabase = createAdminClient()
      const ids = capped.map((p) => p.id)
      const described = new Set<string>()
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase
          .from('product_features_current')
          .select('product_id')
          .eq('dimension_key', '__description')
          .in('product_id', ids.slice(i, i + 300))
        for (const r of data ?? []) described.add(r.product_id as string)
      }
      researched = capped.filter((p) => described.has(p.id))
    } catch {
      researched = capped
    }

    return NextResponse.json(
      {
        products: researched.map((p) => ({
          name: p.canonicalName,
          slug: p.slug,
          score: toDisplayScore(p.momentum, p.categoryMax), // log-skaliert, konsistent zum Leaderboard
          rank: p.catRank,
          spark: p.history.slice(-30).map((h) => Math.round(h.value * 100) / 100),
          trend: p.trend,
        })),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ products: [] }, { status: 200 })
  }
}
