import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, toDisplayScore, momentumHistory } from '@/lib/rankings/score'
import { isExcludedProduct } from '@/lib/rankings/product-exclusions'

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
    .select('id, canonical_name, vendor_namespace, slug, family, version, qualifier')
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

  const { data: productsRaw, error: pErr } = await productQuery
  if (pErr) throw new Error(`leaderboard products: ${pErr.message}`)
  if (!productsRaw?.length) return []
  // Nackte Herstellernamen (Anthropic, Mistral …) zur Laufzeit ausschließen —
  // robust gegen visibility_status-Races mit laufenden Extract-Jobs.
  const products = productsRaw.filter(
    (p) => !(isExcludedProduct(p.family as string) && !p.version && !p.qualifier),
  )
  if (!products.length) return []

  // Alle Mentions paginiert laden — PostgREST cappt sonst still bei 1000 Zeilen,
  // wodurch (seit dem Backfill > 1000 Mentions) die Momentum-Scores aus einer
  // willkürlichen Teilmenge berechnet würden und Produkte aus dem Ranking fielen.
  const datesByProduct = new Map<string, string[]>()
  for (let off = 0; ; off += 1000) {
    const { data: batch, error: mErr } = await supabase
      .from('product_mentions')
      .select('product_id, mention_date')
      .range(off, off + 999)
    if (mErr) throw new Error(`leaderboard mentions: ${mErr.message}`)
    for (const m of batch ?? []) {
      if (!m.mention_date) continue
      const arr = datesByProduct.get(m.product_id) ?? []
      arr.push(m.mention_date)
      datesByProduct.set(m.product_id, arr)
    }
    if (!batch || batch.length < 1000) break
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
    history: momentumHistory(datesByProduct.get(p.id) ?? [], now, 90, 90),
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
