import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { precomputeMetrics } from '@/lib/rankings/precompute'
import { translateStalePromos } from '@/lib/promos/auto-translate'
import { runProductResearch } from '@/lib/rankings/research'
import { runCategorization } from '@/lib/rankings/categorize'
import { runDefragmentation } from '@/lib/rankings/defragment'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300

/** Tägliche Rankings-/Promo-Wartung: berechnet die Ranking-Metriken (product_metrics)
 *  neu, übersetzt geänderte/neue Tip-+Ad-Promos in alle Zielsprachen, recherchiert
 *  neue wertvolle Produkte per Web-Suche und leert den Rankings-Cache. */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    // Selbstheilende De-Fragmentierung VOR precompute (Metriken sollen den
    // konsolidierten Stand zeigen). Deterministisch, keine API-Kosten.
    let defrag = { clusters: 0, merged: 0 }
    try {
      defrag = await runDefragmentation()
    } catch (e) {
      console.error('[cron] defrag:', e instanceof Error ? e.message : e)
    }
    // Kategorisierung VOR precompute: sichtbare Produkte ohne primäre Kategorie einsortieren
    // (mit 'other'-Fallback → nichts bleibt verwaist). Sonst fallen sie aus Research +
    // Kategorie-Charts. Günstig (Haiku); verarbeitet nur noch-nicht-kategorisierte.
    let categorized = 0
    try {
      categorized = (await runCategorization(25)).categorized
    } catch (e) {
      console.error('[cron] categorize:', e instanceof Error ? e.message : e)
    }
    const { computed } = await precomputeMetrics()
    const promos = await translateStalePromos()
    // Tägliche Feature-Research: sichtbare, kategorisierte Produkte mit ≥2 Mentions (= das,
    // was auch in den Charts erscheint), die noch nicht angefragt/ausreichend gefüllt sind.
    // force=false → der __researched_at-Marker + die ≥Hälfte-Dims-Regel verhindern Neu-
    // Anfragen. Hart gedeckelt (limit 12, ~$0-4/Tag) → arbeitet den Rückstand über Tage ab,
    // pendelt sich dann bei ~0 ein (nur neue Produkte).
    let researched = 0
    try {
      researched = (await runProductResearch({ minMentions: 2, force: false, concurrency: 6, limit: 12 })).researched
    } catch (e) {
      console.error('[cron] research:', e instanceof Error ? e.message : e)
    }
    revalidateTag('rankings', 'max')
    return NextResponse.json({ success: true, defrag, categorized, computed, promos, researched })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
