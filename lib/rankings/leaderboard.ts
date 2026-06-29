import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, toDisplayScore } from '@/lib/rankings/score'

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
}

/**
 * MVP-Leaderboard: berechnet den Momentum-Score on-the-fly aus product_mentions
 * für alle SICHTBAREN Produkte (visibility_status='visible' — RLS erlaubt zwar
 * öffentliches Lesen, der Filter ist die eigentliche Sichtbarkeitskontrolle).
 * - opts.category: nur Produkte dieser Kategorie (via product_category_membership).
 * - opts.minMentions: blendet 1×-Noise/FPs aus den öffentlichen Ansichten aus.
 * Precompute (product_rankings) folgt in 1c-voll.
 */
export async function getRankedProducts(
  opts: { limit?: number; category?: string; minMentions?: number } = {},
): Promise<RankedProduct[]> {
  const { limit = 50, category, minMentions = 1 } = opts
  const supabase = createAdminClient()
  const now = new Date()

  let productQuery = supabase
    .from('products')
    .select('id, canonical_name, vendor_namespace, slug')
    .eq('visibility_status', 'visible')

  if (category) {
    const { data: mem, error: memErr } = await supabase
      .from('product_category_membership')
      .select('product_id')
      .eq('category', category)
    if (memErr) throw new Error(`leaderboard membership: ${memErr.message}`)
    const ids = (mem ?? []).map((m) => m.product_id as string)
    if (!ids.length) return []
    productQuery = productQuery.in('id', ids)
  }

  const { data: products, error: pErr } = await productQuery
  if (pErr) throw new Error(`leaderboard products: ${pErr.message}`)
  if (!products?.length) return []

  const { data: mentions, error: mErr } = await supabase
    .from('product_mentions')
    .select('product_id, mention_date')
  if (mErr) throw new Error(`leaderboard mentions: ${mErr.message}`)

  const datesByProduct = new Map<string, string[]>()
  for (const m of mentions ?? []) {
    if (!m.mention_date) continue
    const arr = datesByProduct.get(m.product_id) ?? []
    arr.push(m.mention_date)
    datesByProduct.set(m.product_id, arr)
  }

  const scored = products
    .map((p) => {
      const dates = datesByProduct.get(p.id) ?? []
      return {
        id: p.id,
        canonicalName: p.canonical_name as string,
        vendor: p.vendor_namespace as string,
        slug: p.slug as string,
        momentum: momentumScore(dates, now),
        mentionCount: dates.length,
        lastSeen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      }
    })
    .filter((p) => p.mentionCount >= Math.max(1, minMentions))
    .sort((a, b) => b.momentum - a.momentum)

  const maxMomentum = scored[0]?.momentum ?? 0
  return scored.slice(0, limit).map((p, i) => ({
    ...p,
    rank: i + 1,
    score: toDisplayScore(p.momentum, maxMomentum),
  }))
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
