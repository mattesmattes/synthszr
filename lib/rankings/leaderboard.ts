import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, toDisplayScore, momentumHistory, momentumTrend } from '@/lib/rankings/score'
import { isExcludedProduct, isFamilyUmbrella } from '@/lib/rankings/product-exclusions'

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
 * MVP-Leaderboard: berechnet den Momentum-Score on-the-fly aus product_mentions
 * für alle SICHTBAREN Produkte (visibility_status='visible' — RLS erlaubt zwar
 * öffentliches Lesen, der Filter ist die eigentliche Sichtbarkeitskontrolle).
 * - opts.category: nur Produkte dieser Kategorie (via product_category_membership).
 * - opts.minMentions: blendet 1×-Noise/FPs aus den öffentlichen Ansichten aus.
 * Precompute (product_rankings) folgt in 1c-voll.
 *
 * Gecacht (unstable_cache, 600s): die Berechnung lädt ALLE Mentions (~44 DB-
 * Roundtrips) — ohne Cache wäre jeder Seiten-Load mehrere Sekunden langsam.
 */
export async function getRankedProducts(
  opts: { limit?: number; category?: string; minMentions?: number } = {},
): Promise<RankedProduct[]> {
  const { limit, category, minMentions = 1 } = opts
  // Cache limit-unabhängig (ein Eintrag pro category+minMentions); Slice danach,
  // damit Seite/API/Produktdetail mit verschiedenen Limits denselben Cache teilen.
  const all = await unstable_cache(
    () => computeRankedProducts({ category, minMentions }),
    ['ranked-products-v3', category ?? 'all', String(minMentions)],
    { revalidate: 600, tags: ['rankings'] },
  )()
  return limit ? all.slice(0, limit) : all
}

async function computeRankedProducts(
  opts: { category?: string; minMentions?: number } = {},
): Promise<RankedProduct[]> {
  const { category, minMentions = 1 } = opts
  const supabase = createAdminClient()
  const now = new Date()

  // Kategorie-Mitgliedschaft paginiert als Set — PostgREST cappt bei 1000, und große
  // Kategorien (language-models: > 1100 Produkte) überschreiten das.
  let catSet: Set<string> | null = null
  if (category) {
    catSet = new Set<string>()
    for (let off = 0; ; off += 1000) {
      const { data: mem, error: memErr } = await supabase
        .from('product_category_membership').select('product_id').eq('category', category).range(off, off + 999)
      if (memErr) throw new Error(`leaderboard membership: ${memErr.message}`)
      if (!mem?.length) break
      for (const m of mem) catSet.add(m.product_id as string)
      if (mem.length < 1000) break
    }
    if (!catSet.size) return []
  }

  // Alle sichtbaren Produkte paginiert laden. NICHT via .in(categoryIds) filtern —
  // das sprengt bei > 1000 IDs das URL-/Bind-Limit (500). Kategorie-Filter in JS.
  const productsRaw: Array<{ id: string; canonical_name: string; vendor_namespace: string; slug: string; family: string; version: string | null; qualifier: string | null }> = []
  for (let off = 0; ; off += 1000) {
    const { data, error: pErr } = await supabase
      .from('products')
      .select('id, canonical_name, vendor_namespace, slug, family, version, qualifier')
      .eq('visibility_status', 'visible')
      .range(off, off + 999)
    if (pErr) throw new Error(`leaderboard products: ${pErr.message}`)
    if (!data?.length) break
    productsRaw.push(...(data as typeof productsRaw))
    if (data.length < 1000) break
  }
  if (!productsRaw.length) return []
  // Nackte Herstellernamen + Modell-Familien-Oberbegriffe ausschließen, Kategorie in JS filtern.
  const products = productsRaw.filter(
    (p) =>
      !(isExcludedProduct(p.family as string) && !p.version && !p.qualifier) &&
      !isFamilyUmbrella(p.family as string, p.version, p.qualifier) &&
      (!catSet || catSet.has(p.id)),
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
        trend: momentumTrend(dates, now),
        mentionCount: dates.length,
        lastSeen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      }
    })
    .filter((p) => p.mentionCount >= Math.max(1, minMentions))
    .sort((a, b) => b.momentum - a.momentum)

  const maxMomentum = scored[0]?.momentum ?? 0
  return scored.map((p, i) => ({
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
