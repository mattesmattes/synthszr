import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { precomputeMetrics } from '@/lib/rankings/precompute'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300

/** Berechnet die Ranking-Metriken (product_metrics) täglich neu, damit die Charts
 *  nach neuen Mentions/Konsolidierungen aktuell bleiben, und leert den Rankings-Cache. */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { computed } = await precomputeMetrics()
    revalidateTag('rankings', 'max')
    return NextResponse.json({ success: true, computed })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
