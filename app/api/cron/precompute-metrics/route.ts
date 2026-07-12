import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { precomputeMetrics } from '@/lib/rankings/precompute'
import { translateStalePromos } from '@/lib/promos/auto-translate'
import { runProductResearch } from '@/lib/rankings/research'
import { runCategorization } from '@/lib/rankings/categorize'
import { runDefragmentation } from '@/lib/rankings/defragment'
import { runAttributionQA } from '@/lib/rankings/attribution-qa'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300

/** Tägliche Rankings-/Promo-Wartung: berechnet die Ranking-Metriken (product_metrics)
 *  neu, übersetzt geänderte/neue Tip-+Ad-Promos in alle Zielsprachen, recherchiert
 *  neue wertvolle Produkte per Web-Suche und leert den Rankings-Cache. */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const cronStartedAt = Date.now()
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
    // Attribution-QS: unknown/Fragment-Produkte korrekt zuordnen (Merge in Kanon).
    // Läuft VOR precompute, damit gemergte Fragmente aus den Metriken fallen.
    let attribution = { merged: 0, flagged: 0, marked: 0 }
    try {
      attribution = await runAttributionQA({ limit: 15, minMentions: 2 })
    } catch (e) {
      console.error('[cron] attribution-qa:', e instanceof Error ? e.message : e)
    }
    const { computed } = await precomputeMetrics()
    const promos = await translateStalePromos()
    // Tägliche Feature-Research: sichtbare, kategorisierte Produkte mit ≥2 Mentions (= das,
    // was auch in den Charts erscheint), die noch nicht angefragt/ausreichend gefüllt sind.
    // force=false → der __researched_at-Marker + die ≥Hälfte-Dims-Regel verhindern Neu-
    // Anfragen. Kandidaten sind nach Mentions sortiert (prominenteste zuerst). limit 40 als
    // Obergrenze, effektiv durch budgetMs begrenzt: nur so viele, wie in die verbleibende
    // Zeit bis zum 300s-Cap passen (20s Puffer für revalidate + Response) — verhindert 504.
    let researched = 0
    try {
      const budgetMs = Math.max(20_000, 300_000 - (Date.now() - cronStartedAt) - 20_000)
      researched = (await runProductResearch({ minMentions: 2, force: false, concurrency: 6, limit: 40, budgetMs })).researched
    } catch (e) {
      console.error('[cron] research:', e instanceof Error ? e.message : e)
    }
    revalidateTag('rankings', 'max')
    return NextResponse.json({ success: true, defrag, categorized, attribution, computed, promos, researched })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
