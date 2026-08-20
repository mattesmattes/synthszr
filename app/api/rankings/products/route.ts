import { NextResponse } from 'next/server'
import { getCategoryCappedProducts } from '@/lib/rankings/leaderboard'
import { toDisplayScore } from '@/lib/rankings/score'
import { createAdminClient } from '@/lib/supabase/admin'

// ISR statt force-dynamic: force-dynamic verwarf den Cache-Control-Header unten —
// prod antwortete mit `max-age=0, must-revalidate`, also lief praktisch jeder
// Aufruf bis in die DB. Der Renderer holt diese Route bei JEDEM Artikelaufruf
// (tiptap-renderer.tsx), das war damit der groesste Posten der Egress-Overage
// (Befund 2026-08-20). Die Daten aendern sich nur per taeglichem precompute-Cron,
// 10 Minuten Frische reichen also reichlich.
export const revalidate = 600

/**
 * Liefert die in den Charts sichtbaren Produkte (Name + Slug + Momentum-Score,
 * seit 2026-08-20 OHNE Sparkline — s. includeHistory unten) für die
 * Produkt-Verlinkung im Blog-Renderer. Harter Cut:
 * nur Produkte in den Top 50 ihrer primären Kategorie (bzw. global Top 50 ohne
 * Kategorie) — Long-Tail-Produkte mit Rängen wie #82 tauchen in Artikeln nicht
 * mehr auf. Der Score ist KATEGORIE-relativ (konsistent zur Produktseite);
 * Ränge werden in getCategoryCappedProducts über den vollen Satz berechnet.
 */
export async function GET() {
  try {
    // includeHistory=FALSE: der history-JSONB machte 4450 der 4709 Bytes je Zeile aus
    // — bei 2875 chartbaren Produkten 12,9 MB statt 0,7 MB pro Aufruf (gemessen
    // 2026-08-20). Genutzt wurden davon ohnehin nur die letzten 30 von 90 Punkten.
    // Preis: die Pill zeigt keine Sparkline mehr, nur noch den Rang in Trend-Farbe.
    // buildVotePill (lib/tiptap/dom-processors/product-links.ts) laesst die Kurve
    // bei leerem spark von selbst weg.
    const capped = await getCategoryCappedProducts(50, false)

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
          spark: [], // history wird nicht mehr geladen, s. includeHistory=false oben
          trend: p.trend,
        })),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ products: [] }, { status: 200 })
  }
}
