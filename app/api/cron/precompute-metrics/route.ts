import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { precomputeMetrics } from '@/lib/rankings/precompute'
import { translateStalePromos } from '@/lib/promos/auto-translate'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300

/** Tägliche Rankings-/Promo-Wartung: berechnet die Ranking-Metriken (product_metrics)
 *  neu, übersetzt geänderte/neue Tip-+Ad-Promos in alle Zielsprachen und leert den
 *  Rankings-Cache. */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { computed } = await precomputeMetrics()
    const promos = await translateStalePromos()
    revalidateTag('rankings', 'max')
    return NextResponse.json({ success: true, computed, promos })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
