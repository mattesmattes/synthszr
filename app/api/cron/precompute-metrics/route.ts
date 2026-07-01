import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { precomputeMetrics } from '@/lib/rankings/precompute'
import { translateStalePromos } from '@/lib/promos/auto-translate'
import { runProductResearch } from '@/lib/rankings/research'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300

/** Tägliche Rankings-/Promo-Wartung: berechnet die Ranking-Metriken (product_metrics)
 *  neu, übersetzt geänderte/neue Tip-+Ad-Promos in alle Zielsprachen, recherchiert
 *  neue wertvolle Produkte per Web-Suche und leert den Rankings-Cache. */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { computed } = await precomputeMetrics()
    const promos = await translateStalePromos()
    // Tägliche Feature-Research: NUR wertvolle, noch nicht angefragte Produkte
    // (>=10 Mentions, force=false → der __researched_at-Marker verhindert Neu-Anfragen).
    // Hart gedeckelt (limit 12) → Tageskosten bleiben klein (~$0-2, meist $0, da kaum
    // neue Produkte täglich die 10-Mention-Schwelle überschreiten).
    let researched = 0
    try {
      researched = (await runProductResearch({ minMentions: 10, force: false, concurrency: 6, limit: 12 })).researched
    } catch (e) {
      console.error('[cron] research:', e instanceof Error ? e.message : e)
    }
    revalidateTag('rankings', 'max')
    return NextResponse.json({ success: true, computed, promos, researched })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
