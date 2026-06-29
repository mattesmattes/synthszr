import { NextResponse } from 'next/server'
import { getRankedProducts } from '@/lib/rankings/leaderboard'

export const dynamic = 'force-dynamic'

/**
 * Liefert die in den Charts sichtbaren Produkte (Name + Slug) für die
 * Produkt-Verlinkung im Blog-Renderer. Nur Produkte mit ≥2 Erwähnungen
 * (wie das öffentliche Leaderboard).
 */
export async function GET() {
  try {
    const products = await getRankedProducts({ limit: 500, minMentions: 2 })
    return NextResponse.json(
      { products: products.map((p) => ({ name: p.canonicalName, slug: p.slug })) },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ products: [] }, { status: 200 })
  }
}
