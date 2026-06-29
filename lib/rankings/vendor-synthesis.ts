import { fetchPremarketSyntheses } from '@/lib/premarket/client'
import type { PremarketSynthesis } from '@/lib/premarket/types'

/**
 * Lädt die Premarket/Stock-Synthese für den Hersteller eines Produkts (falls dieser
 * als Premarket-Unternehmen erfasst ist). Server-seitig, gecacht (revalidate 1h).
 */
export async function getVendorSynthesis(
  vendor: string,
): Promise<{ company: string; synthesis: PremarketSynthesis } | null> {
  const v = vendor?.trim()
  if (!v || v === 'unknown') return null

  const search = v.replace(/-/g, ' ')
  const res = await fetchPremarketSyntheses({ search, withSynthesis: true, limit: 5 })
  if (!res.ok || !res.data?.length) return null

  const item = res.data.find((d) => d.synthesis && (d.synthesis.rating || d.synthesis.rationale || d.synthesis.keyTakeaways?.length))
  if (!item?.synthesis) return null

  return { company: item.instrument?.name ?? item.premarket?.name ?? v, synthesis: item.synthesis }
}
