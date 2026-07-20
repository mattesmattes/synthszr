import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, momentumHistory, momentumTrend } from '@/lib/rankings/score'
import { isExcludedProduct, isFamilyUmbrella, isCommonWordNonProduct } from '@/lib/rankings/product-exclusions'

/**
 * Berechnet Ranking-Metriken für alle sichtbaren Produkte EINMAL aus product_mentions
 * und legt sie in product_metrics ab (inkl. chartable-Flag und primärer Kategorie),
 * damit getRankedProducts EINEN indexierten Query mit Server-Limit fahren kann statt
 * bei jedem Load ~43k Mentions zu aggregieren. Läuft periodisch (Cron) + nach Backfills.
 */
export async function precomputeMetrics(): Promise<{ computed: number }> {
  const supabase = createAdminClient()
  const now = new Date()

  const products: Array<{ id: string; family: string; version: string | null; qualifier: string | null }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('products').select('id, family, version, qualifier').eq('visibility_status', 'visible').order('id').range(off, off + 999)
    if (!data?.length) break
    products.push(...(data as typeof products))
    if (data.length < 1000) break
  }

  const primaryCat = new Map<string, string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_category_membership').select('product_id, category').eq('is_primary', true).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) primaryCat.set(m.product_id as string, m.category as string)
    if (data.length < 1000) break
  }

  const datesByProduct = new Map<string, string[]>()
  for (let off = 0; ; off += 1000) {
    // .order('id') ist PFLICHT: range-Pagination ohne stabile Sortierung liefert über
    // Seiten hinweg doppelte/fehlende Zeilen → mention_count (dates.length) wird überzählt
    // → falsche chartable-Flags + Phantom-Chart-Einträge, die der Cron nie füllt.
    const { data } = await supabase.from('product_mentions').select('id, product_id, mention_date').order('id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) {
      if (!m.mention_date) continue
      const a = datesByProduct.get(m.product_id) ?? []
      a.push(m.mention_date as string)
      datesByProduct.set(m.product_id, a)
    }
    if (data.length < 1000) break
  }

  const rows = products.map((p) => {
    const dates = datesByProduct.get(p.id) ?? []
    const chartable =
      !(isExcludedProduct(p.family) && !p.version && !p.qualifier) &&
      !isFamilyUmbrella(p.family, p.version, p.qualifier) &&
      !isCommonWordNonProduct(p.family)
    return {
      product_id: p.id,
      momentum: momentumScore(dates, now),
      trend: momentumTrend(dates, now),
      mention_count: dates.length,
      last_seen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      history: momentumHistory(dates, now, 90, 90),
      chartable,
      primary_category: primaryCat.get(p.id) ?? null,
      computed_at: now.toISOString(),
    }
  })

  let computed = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await supabase.from('product_metrics').upsert(batch, { onConflict: 'product_id' })
    if (error) throw new Error(`precompute upsert: ${error.message}`)
    computed += batch.length
  }
  return { computed }
}
