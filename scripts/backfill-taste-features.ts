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

interface DayRow {
  id: string
  title: string
  excerpt: string | null
  source_display_name: string | null
  synthesis_score: number | null
  relevance_score: number | null
  uniqueness_score: number | null
  source_bonus: number | null
  source_pub_rate: number | null
  content_length: number | null
}

/**
 * `--max-days=N`: nur die ersten N Ground-Truth-Tage verarbeiten (Probelauf).
 * Rückgabe: `undefined` = Flag fehlt (Volllauf), `null` = Flag vorhanden aber
 * ungültig (keine positive Zahl), sonst die geparste Zahl.
 */
function parseMaxDays(argv: string[]): number | undefined | null {
  const arg = argv.find((a) => a.startsWith('--max-days='))
  if (!arg) return undefined
  const n = Number(arg.slice('--max-days='.length))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { getOrComputeFeatures } = await import('@/lib/news-taste/features')
  const { collectLabeledIds, collectGroundTruthDays, loadDayCandidates, DAY_LIMIT } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  const maxDaysArg = parseMaxDays(process.argv.slice(2))
  if (maxDaysArg === null) {
    // WARUM: stiller Volllauf bei Tippfehler ("--max-days=x") wäre teuer und
    // unbemerkt — lieber hart abbrechen als versehentlich alles verarbeiten.
    console.warn('WARNUNG: --max-days ist ungültig (keine positive Zahl) — Abbruch statt versehentlichem Volllauf.')
    process.exit(1)
  }

  // 1) Ground-Truth-Tage: Tage (UTC, nach queued_at) der Items, die in
  //    veröffentlichten Posts stecken.
  const labeledIds = await collectLabeledIds(supabase)
  const allDays = await collectGroundTruthDays(supabase, labeledIds)
  const days = maxDaysArg ? allDays.slice(0, maxDaysArg) : allDays
  console.log(`Ground Truth: ${labeledIds.length} Items an ${allDays.length} Tagen`
    + (maxDaysArg ? ` — Probelauf: nur die ersten ${days.length}` : ''))

  // 2) Je Tag die Kandidaten laden, filtern, Features sicherstellen.
  let done = 0
  let failed = 0
  let failedDays = 0
  const t0 = Date.now()
  for (const day of days) {
    const { rows, truncated, error } = await loadDayCandidates<DayRow>(
      supabase, day,
      'id, title, excerpt, source_display_name, synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate, content_length',
    )
    if (error) { console.error(day, 'Laden fehlgeschlagen:', error); failedDays++; continue }
    if (truncated) {
      console.warn(`${day}: Limit von ${DAY_LIMIT} Zeilen erreicht — Tag ist möglicherweise abgeschnitten`)
    }
    const inputs = rows.map((r) => ({
      queueItemId: r.id,
      title: r.title,
      source: r.source_display_name ?? null,
      // WARUM: nur excerpt, kein content — siehe Datei-Kommentar (Egress)
      text: (r.excerpt || '').slice(0, 1500) || null,
      synthesis: Number(r.synthesis_score) || 0,
      relevance: Number(r.relevance_score) || 0,
      uniqueness: Number(r.uniqueness_score) || 0,
      sourceBonus: Number(r.source_bonus) || 0,
      sourcePubRate: Number(r.source_pub_rate) || 0,
      contentLength: Number(r.content_length) || 0,
    }))
    try {
      // WARUM try/catch: getOrComputeFeatures wirft, wenn schon der
      // Versions-Lookup fehlschlägt (nicht nur einzelne Items landen dann in
      // failedIds) — ohne Fang würde das den GESAMTEN Lauf abbrechen statt
      // nur den einen Tag zu überspringen (der Rest bleibt idempotent nachholbar).
      const res = await getOrComputeFeatures(inputs, { concurrency: 6 })
      done += res.features.size
      failed += res.failedIds.length
      const mins = ((Date.now() - t0) / 60000).toFixed(1)
      console.log(`${day}: ${inputs.length} Kandidaten, kumuliert ${done} ok / ${failed} Fehler (${mins} min)`)
    } catch (err) {
      failedDays++
      console.error(day, 'Feature-Berechnung fehlgeschlagen (Tag übersprungen):', err instanceof Error ? err.message : err)
    }
  }
  console.log(`FERTIG: ${done} Vektoren, ${failed} Fehler, ${failedDays} fehlgeschlagene Tage. Kosten: siehe llm_usage use_case='news_taste_features'.`)
  if (failed > done * 0.05 || failedDays > 0) console.warn('WARNUNG: Fehlquote > 5% oder mind. ein fehlgeschlagener Tag — Log prüfen, ggf. erneut laufen lassen (idempotent).')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
