#!/usr/bin/env npx tsx
/**
 * Backfill der Jev-Feature-Vektoren für das News-Taste-Training.
 *
 * Umfang: alle news_queue-Items der Tage, an denen mindestens ein Item in
 * einem VERÖFFENTLICHTEN Post gelandet ist — gefiltert wie Stufe 1 des
 * Rankings (Junk-Titel raus, >= 500 Zeichen), damit Trainings- und
 * Laufzeitverteilung übereinstimmen. Idempotent: vorhandene Vektoren der
 * aktuellen FEATURES_VERSION werden übersprungen (getOrComputeFeatures).
 *
 * WARUM nur excerpt (kein content) als State-Text: die Laufzeit-Rankingstufe
 * sieht ebenfalls nur excerpt — Training muss dieselbe Verteilung sehen.
 * content für ~70k Zeilen zu selektieren würde zusätzlich hunderte MB
 * Supabase-Egress kosten (siehe Memory: Supabase-Egress-Diagnose).
 *
 * Lauf (voll):  npm run taste:backfill        (gegen ~/.synthszr.env.prod)
 * Lauf (Probe): npx tsx scripts/backfill-taste-features.ts --max-days=1
 * Kosten: ~2k Tokens/Item, erwartet 50–90k Items → ca. $5–10 einmalig.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'

const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const MIN_CONTENT_LENGTH = 500 // wie ranking-service.ts (Stufe 1 des Rankings)

/** `--max-days=N`: nur die ersten N Ground-Truth-Tage verarbeiten (Probelauf). */
function parseMaxDays(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith('--max-days='))
  if (!arg) return undefined
  const n = Number(arg.slice('--max-days='.length))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { isJunkTitle } = await import('@/lib/news-queue/service')
  const { getOrComputeFeatures } = await import('@/lib/news-taste/features')
  const { collectLabeledIds, collectGroundTruthDays } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  // 1) Ground-Truth-Tage: Tage (UTC, nach queued_at) der Items, die in
  //    veröffentlichten Posts stecken.
  const labeledIds = await collectLabeledIds(supabase)
  const allDays = await collectGroundTruthDays(supabase, labeledIds)
  const maxDays = parseMaxDays(process.argv.slice(2))
  const days = maxDays ? allDays.slice(0, maxDays) : allDays
  console.log(`Ground Truth: ${labeledIds.length} Items an ${allDays.length} Tagen`
    + (maxDays ? ` — Probelauf: nur die ersten ${days.length}` : ''))

  // 2) Je Tag die Kandidaten laden, filtern, Features sicherstellen.
  let done = 0
  let failed = 0
  const t0 = Date.now()
  for (const day of days) {
    const { data, error } = await supabase.from('news_queue')
      .select('id, title, excerpt, source_display_name, synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate, content_length')
      .gte('queued_at', `${day}T00:00:00Z`).lt('queued_at', `${day}T23:59:59.999Z`)
      .limit(2000)
    if (error) { console.error(day, 'Laden fehlgeschlagen:', error.message); continue }
    const inputs = (data ?? [])
      .filter((r) => !isJunkTitle(r.title) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH)
      .map((r) => ({
        queueItemId: r.id as string,
        title: r.title as string,
        source: (r.source_display_name as string) ?? null,
        // WARUM: nur excerpt, kein content — siehe Datei-Kommentar (Egress)
        text: ((r.excerpt as string) || '').slice(0, 1500) || null,
        synthesis: Number(r.synthesis_score) || 0,
        relevance: Number(r.relevance_score) || 0,
        uniqueness: Number(r.uniqueness_score) || 0,
        sourceBonus: Number(r.source_bonus) || 0,
        sourcePubRate: Number(r.source_pub_rate) || 0,
        contentLength: Number(r.content_length) || 0,
      }))
    // Concurrency 6: Gateway-Limit 1.200 Requests/Minute
    const res = await getOrComputeFeatures(inputs, { concurrency: 6 })
    done += res.features.size
    failed += res.failedIds.length
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    console.log(`${day}: ${inputs.length} Kandidaten, kumuliert ${done} ok / ${failed} Fehler (${mins} min)`)
  }
  console.log(`FERTIG: ${done} Vektoren, ${failed} Fehler. Kosten: siehe llm_usage use_case='news_taste_features'.`)
  if (failed > done * 0.05) console.warn('WARNUNG: Fehlquote > 5% — Log prüfen, ggf. erneut laufen lassen (idempotent).')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
