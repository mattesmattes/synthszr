import { NextResponse } from 'next/server'
import { getCategoryCappedProducts } from '@/lib/rankings/leaderboard'
import { toDisplayScore } from '@/lib/rankings/score'

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

    return NextResponse.json(
      {
        products: capped.map((p) => ({
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
