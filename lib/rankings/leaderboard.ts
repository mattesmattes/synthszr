import { createAdminClient } from '@/lib/supabase/admin'
import { toDisplayScore } from '@/lib/rankings/score'

export interface RankedProduct {
  id: string
  rank: number
  canonicalName: string
  vendor: string
  slug: string
  score: number       // 0–100, relativ zum Spitzenreiter (Anzeige)
  momentum: number    // roher Sortier-Wert
  mentionCount: number
  lastSeen: string | null
  history: Array<{ t: number; value: number }> // Momentum-Verlauf (Sparkline)
  trend: 'up' | 'down' | 'flat' // aus der Erwähnungs-Rate (7d vs. 7d davor)
}

/**
 * Leaderboard aus vorberechneten product_metrics (precompute.ts): EIN indexierter
 * Query mit Server-Filter (chartable + primäre Kategorie + Mindest-Mentions),
 * Server-Sort nach Momentum und Server-Limit. Keine On-the-fly-Aggregation von
 * ~43k Mentions mehr (~12s → <1s). chartable enthält bereits den Ausschluss von
 * Herstellernamen und Modell-Familien-Oberbegriffen.
 */
export async function getRankedProducts(
  opts: { limit?: number; category?: string; categoryIn?: string[]; minMentions?: number } = {},
): Promise<RankedProduct[]> {
  const { limit, category, categoryIn, minMentions = 1 } = opts
  const supabase = createAdminClient()

  // Paginiert laden — PostgREST cappt eine einzelne Antwort bei 1000 Zeilen, egal was
  // `limit` sagt. Ohne Pagination fehlen Produkte jenseits Rang 1000 → falsche
  // Kategorie-Ränge in der Pill-/Blog-Verlinkung (Leaderboard≠Produktseite).
  const target = limit ?? 1000
  const rows: Array<Record<string, unknown>> = []
  for (let off = 0; off < target; off += 1000) {
    let q = supabase
      .from('product_metrics')
      .select('momentum, trend, mention_count, last_seen, history, products!inner(id, canonical_name, vendor_namespace, slug)')
      .eq('chartable', true)
      .gte('mention_count', Math.max(1, minMentions))
      .order('momentum', { ascending: false })
      .order('product_id', { ascending: true }) // stabiler Tiebreaker für konsistente Pagination
    if (category) q = q.eq('primary_category', category)
    else if (categoryIn && categoryIn.length) q = q.in('primary_category', categoryIn)
    const { data, error } = await q.range(off, Math.min(off + 1000, target) - 1)
    if (error) throw new Error(`leaderboard: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const maxMomentum = (rows[0]?.momentum as number) ?? 0

  return rows.map((r, i) => {
    const p = (Array.isArray(r.products) ? r.products[0] : r.products) as {
      id: string; canonical_name: string; vendor_namespace: string; slug: string
    }
    const momentum = (r.momentum as number) ?? 0
    return {
      id: p.id,
      rank: i + 1,
      canonicalName: p.canonical_name,
      vendor: p.vendor_namespace,
      slug: p.slug,
      score: toDisplayScore(momentum, maxMomentum),
      momentum,
      mentionCount: (r.mention_count as number) ?? 0,
      lastSeen: (r.last_seen as string | null) ?? null,
      history: ((r.history as Array<{ t: number; value: number }>) ?? []),
      trend: ((r.trend as string) ?? 'flat') as 'up' | 'down' | 'flat',
    }
  })
}

export interface CategoryCappedProduct extends RankedProduct {
  /** Rang innerhalb der primären Kategorie (bzw. globaler Rang ohne Kategorie). */
  catRank: number
  primaryCategory: string | null
  /** Momentum des Kategorie-Spitzenreiters (für kategorie-relative Scores). */
  categoryMax: number
}

/**
 * Chartbare Produkte mit hartem Cut bei `cap` pro primärer Kategorie —
 * die kanonische Menge für alle Anzeigen außerhalb der Ranking-Listen
 * (Artikel-Produktlinks, Vote-Blocks). Produkte ohne primäre Kategorie
 * werden am globalen Rang gemessen. Ränge werden über den VOLLEN Satz
 * berechnet (nicht über eine abgeschnittene Liste), damit sie mit den
 * Produktseiten übereinstimmen.
 */
export async function getCategoryCappedProducts(cap = 50): Promise<CategoryCappedProduct[]> {
  const all = await getRankedProducts({ limit: 10_000, minMentions: 2 })
  const supabase = createAdminClient()
  // Paginieren — PostgREST cappt bei 1000 Zeilen, sonst gelten tausende
  // Produkte fälschlich als uncategorisiert.
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

  const globalMax = all.length ? all[0].momentum : 0
  const maxByCat = new Map<string, number>()
  const catCounter = new Map<string, number>()
  const out: CategoryCappedProduct[] = []
  all.forEach((p, i) => {
    const cat = primaryCat.get(p.id) ?? null
    let catRank: number
    let categoryMax: number
    if (cat) {
      maxByCat.set(cat, Math.max(maxByCat.get(cat) ?? 0, p.momentum))
      catRank = (catCounter.get(cat) ?? 0) + 1
      catCounter.set(cat, catRank)
      categoryMax = maxByCat.get(cat) ?? 0
    } else {
      catRank = i + 1 // globaler Rang als Fallback
      categoryMax = globalMax
    }
    if (catRank <= cap) out.push({ ...p, catRank, primaryCategory: cat, categoryMax })
  })
  return out
}

/** Aktive Kategorien für die Ranking-Filter (nach Anzeigereihenfolge). */
export async function getActiveCategories(): Promise<Array<{ slug: string; name: string }>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select('slug, name')
    .eq('status', 'active')
    .order('display_order')
  if (error) throw new Error(`categories: ${error.message}`)
  return (data ?? []).map((c) => ({ slug: c.slug as string, name: c.name as string }))
}
