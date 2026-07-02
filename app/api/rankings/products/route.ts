import { NextResponse } from 'next/server'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { toDisplayScore } from '@/lib/rankings/score'
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
    // Über den VOLLEN Satz ranken (nicht global top-500 abschneiden), sonst zählt der
    // Kategorie-Rang zu niedrig und weicht von der Produktseite ab.
    const all = await getRankedProducts({ limit: 10_000, minMentions: 2 })

    // primäre Kategorie je Produkt → Score/Rang relativ zum Kategorie-Spitzenreiter
    const supabase = createAdminClient()
    // WICHTIG: paginieren — .eq() ohne range() cappt bei 1000 Zeilen (PostgREST) →
    // sonst gelten ~3700 Produkte fälschlich als uncategorisiert → falsche Ränge.
    const membRows: Array<{ product_id: string; category: string }> = []
    for (let off = 0; ; off += 1000) {
      const { data } = await supabase
        .from('product_category_membership')
        .select('product_id, category')
        .eq('is_primary', true)
        .order('product_id')
        .range(off, off + 999)
      if (!data?.length) break
      membRows.push(...(data as Array<{ product_id: string; category: string }>))
      if (data.length < 1000) break
    }
    const primaryCat = new Map(membRows.map((m) => [m.product_id, m.category]))

    // all ist global nach Momentum sortiert → die laufende Position innerhalb der
    // primären Kategorie ist der Kategorie-Rang (#1, #2, …), über den vollen Satz.
    // WICHTIG: Produkte OHNE primäre Kategorie NICHT in einen Sammel-Bucket ranken
    // (das ergab bedeutungslose Ränge wie #119 unter 1546 Uncategorisierten) — sie
    // bekommen den GLOBALEN Rang (konsistent zur „Alle"-Ansicht der Charts).
    const globalMax = all.length ? all[0].momentum : 0
    const maxByCat = new Map<string, number>()
    const catCounter = new Map<string, number>()
    const rankByProduct = new Map<string, number>()
    all.forEach((p, i) => {
      const cat = primaryCat.get(p.id)
      if (cat) {
        maxByCat.set(cat, Math.max(maxByCat.get(cat) ?? 0, p.momentum))
        const n = (catCounter.get(cat) ?? 0) + 1
        catCounter.set(cat, n)
        rankByProduct.set(p.id, n)
      } else {
        rankByProduct.set(p.id, i + 1) // globaler Rang als Fallback
      }
    })

    // Payload begrenzen (Blog-Verlinkung braucht die relevanten Produkte); die Ränge
    // sind bereits über den vollen Satz berechnet und damit korrekt.
    const products = all.slice(0, 800)

    return NextResponse.json(
      {
        products: products.map((p) => {
          const cat = primaryCat.get(p.id)
          const max = cat ? (maxByCat.get(cat) ?? 0) : globalMax
          return {
            name: p.canonicalName,
            slug: p.slug,
            score: toDisplayScore(p.momentum, max), // log-skaliert, konsistent zum Leaderboard
            rank: rankByProduct.get(p.id) ?? null,
            spark: p.history.slice(-30).map((h) => Math.round(h.value * 100) / 100),
            trend: p.trend,
          }
        }),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ products: [] }, { status: 200 })
  }
}
