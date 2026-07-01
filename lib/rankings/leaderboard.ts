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
  opts: { limit?: number; category?: string; minMentions?: number } = {},
): Promise<RankedProduct[]> {
  const { limit, category, minMentions = 1 } = opts
  const supabase = createAdminClient()

  let q = supabase
    .from('product_metrics')
    .select('momentum, trend, mention_count, last_seen, history, products!inner(id, canonical_name, vendor_namespace, slug)')
    .eq('chartable', true)
    .gte('mention_count', Math.max(1, minMentions))
    .order('momentum', { ascending: false })
  if (category) q = q.eq('primary_category', category)
  q = q.limit(limit ?? 1000)

  const { data, error } = await q
  if (error) throw new Error(`leaderboard: ${error.message}`)
  const rows = data ?? []
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
