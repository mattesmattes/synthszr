import { createAdminClient } from '@/lib/supabase/admin'
import { momentumScore, momentumHistory, momentumTrend } from '@/lib/rankings/score'

/**
 * Berechnet Ranking-Metriken (Momentum, Trend, Verlauf, Mention-Count, last_seen)
 * für alle sichtbaren Produkte EINMAL aus product_mentions und legt sie in
 * product_metrics ab. getRankedProducts liest danach diese Tabelle statt bei jedem
 * Seiten-Load ~43k Mentions zu aggregieren. Läuft periodisch (Cron) + nach Backfills.
 */
export async function precomputeMetrics(): Promise<{ computed: number }> {
  const supabase = createAdminClient()
  const now = new Date()

  const ids: string[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('products').select('id').eq('visibility_status', 'visible').range(off, off + 999)
    if (!data?.length) break
    ids.push(...data.map((p) => p.id as string))
    if (data.length < 1000) break
  }

  const datesByProduct = new Map<string, string[]>()
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_mentions').select('product_id, mention_date').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) {
      if (!m.mention_date) continue
      const a = datesByProduct.get(m.product_id) ?? []
      a.push(m.mention_date as string)
      datesByProduct.set(m.product_id, a)
    }
    if (data.length < 1000) break
  }

  const rows = ids.map((id) => {
    const dates = datesByProduct.get(id) ?? []
    return {
      product_id: id,
      momentum: momentumScore(dates, now),
      trend: momentumTrend(dates, now),
      mention_count: dates.length,
      last_seen: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      history: momentumHistory(dates, now, 90, 90),
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
