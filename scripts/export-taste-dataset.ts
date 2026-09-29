#!/usr/bin/env npx tsx
/**
 * Exportiert das Trainings-Dataset des News-Taste-Modells nach
 * scripts/taste-dataset.json. Python (train_news_taste.py) bekommt NUR diese
 * Datei — keine Supabase-Credentials im Trainingsteil. Das Skript selbst ist
 * read-only gegen die DB: es liest Labels, Kandidaten und Feature-Vektoren
 * und schreibt ausschließlich die lokale JSON-Datei.
 *
 * Kandidatenauswahl je Tag: EXAKT wie der Backfill (Task 5) — beide nutzen
 * loadDayCandidates aus scripts/lib/taste-ground-truth.ts (gleiches
 * Tagesfenster, gleiche Sortierung/Limit, gleicher Junk-/Längenfilter).
 * Trainings-Items müssen die Items sein, die auch Feature-Vektoren bekommen
 * haben — sonst laufen Trainings- und Backfill-Verteilung auseinander.
 *
 * Ein Tag kommt ins Dataset, wenn er (nach Vektor-Filter) >= MIN_CANDIDATES
 * Items und mindestens ein Positiv MIT Feature-Vektor hat — sonst ist eine
 * Ranking-Bewertung für den Tag sinnlos. Items ohne Vektor (Backfill noch
 * nicht durchgelaufen oder fehlgeschlagen) werden übersprungen und gezählt.
 * Ein fehlschlagender Tag (DB-Fehler) bricht den Lauf nicht ab: er wird
 * geloggt und gezählt, der Rest des Exports bleibt nutzbar.
 *
 * Lauf: npm run taste:export        (gegen ~/.synthszr.env.prod)
 */
import { config } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'

const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const MIN_CANDIDATES = 15 // sonst ist eine Ranking-Bewertung fuer den Tag sinnlos
const IN_CHUNK = 200 // wie scripts/lib/taste-ground-truth.ts: HeadersOverflowError ab ~400 UUIDs (Produktions-Supabase)

interface DayRow {
  id: string
  title: string
  content_length: number | null
  synthesis_score: number | null
  relevance_score: number | null
  uniqueness_score: number | null
  source_bonus: number | null
  source_pub_rate: number | null
  total_score: number | null
}

interface DatasetItem { id: string; label: boolean; x: number[] }
interface DatasetDay { day: string; items: DatasetItem[] }

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { FEATURE_NAMES, FEATURES_VERSION } = await import('@/lib/news-taste/questions')
  const { extraFeatures } = await import('@/lib/news-taste/features')
  const { collectLabeledIds, collectGroundTruthDays, loadDayCandidates, DAY_LIMIT } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  // 1) Labels + Ground-Truth-Tage — dieselbe Quelle wie der Backfill (Task 5).
  const labeledIdList = await collectLabeledIds(supabase)
  const labeled = new Set(labeledIdList)
  const days = await collectGroundTruthDays(supabase, labeledIdList)
  console.log(`Ground Truth: ${labeled.size} Items an ${days.length} Tagen`)

  const out: { feature_names: string[]; features_version: number; days: DatasetDay[] } = {
    feature_names: FEATURE_NAMES,
    features_version: FEATURES_VERSION,
    days: [],
  }
  let skippedNoVector = 0
  let failedDays = 0

  for (const day of days) {
    try {
      // WARUM keine excerpt/source_display_name-Spalten (anders als Backfill):
      // extraFeatures() nutzt nur die Score-Felder, title/source/text braucht
      // nur buildTasteState (Live-Berechnung) — die läuft hier nicht mehr, die
      // Vektoren liegen schon in news_taste_features. Weniger Spalten = weniger
      // Egress (siehe Memory: Supabase-Egress-Diagnose).
      const { rows, truncated, error } = await loadDayCandidates<DayRow>(
        supabase, day,
        'id, title, content_length, synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate, total_score',
      )
      if (error) throw new Error(`news_queue: ${error}`)
      if (truncated) {
        console.warn(`${day}: Limit von ${DAY_LIMIT} Zeilen erreicht — Tag ist möglicherweise abgeschnitten`)
      }
      if (rows.length < MIN_CANDIDATES) continue // zu wenige Kandidaten, Vektor-Lookup lohnt nicht

      // 2) Vorhandene Feature-Vektoren fuer die Kandidaten des Tages laden
      //    (NUR aktuelle FEATURES_VERSION — wie getOrComputeFeatures).
      const ids = rows.map((r) => r.id)
      const vectors = new Map<string, Record<string, number>>()
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data: feats, error: featsError } = await supabase
          .from('news_taste_features')
          .select('queue_item_id, features')
          .eq('features_version', FEATURES_VERSION)
          .in('queue_item_id', ids.slice(i, i + IN_CHUNK))
        if (featsError) throw new Error(`news_taste_features: ${featsError.message}`)
        for (const f of feats ?? []) vectors.set(f.queue_item_id as string, f.features as Record<string, number>)
      }

      // 3) Jev-Vektor + Zusatzsignale mergen, in FEATURE_NAMES-Reihenfolge
      //    serialisieren — x ist parallel zu feature_names (Spec-Vorgabe).
      const items: DatasetItem[] = []
      for (const r of rows) {
        const jev = vectors.get(r.id)
        if (!jev) { skippedNoVector++; continue }
        const extra = extraFeatures({
          queueItemId: r.id, title: r.title, source: null, text: null,
          synthesis: Number(r.synthesis_score) || 0,
          relevance: Number(r.relevance_score) || 0,
          uniqueness: Number(r.uniqueness_score) || 0,
          sourceBonus: Number(r.source_bonus) || 0,
          sourcePubRate: Number(r.source_pub_rate) || 0,
          contentLength: Number(r.content_length) || 0,
          totalScore: Number(r.total_score) || 0,
        })
        const merged: Record<string, number> = { ...jev, ...extra }
        items.push({
          id: r.id,
          label: labeled.has(r.id),
          // WARUM Number.isFinite-Fallback: fehlende/kaputte Feature-Werte
          // duerfen NIE als NaN/null ins Dataset — das Python-Training wuerde
          // sonst stillschweigend kaputtgehen.
          x: FEATURE_NAMES.map((n) => (Number.isFinite(merged[n]) ? merged[n] : 0)),
        })
      }
      if (items.length >= MIN_CANDIDATES && items.some((i) => i.label)) {
        out.days.push({ day, items })
      }
    } catch (err) {
      failedDays++
      console.error(day, 'Export fehlgeschlagen (Tag übersprungen):', err instanceof Error ? err.message : err)
    }
  }

  writeFileSync('scripts/taste-dataset.json', JSON.stringify(out))
  const total = out.days.reduce((a, d) => a + d.items.length, 0)
  const positives = out.days.reduce((a, d) => a + d.items.filter((i) => i.label).length, 0)
  console.log(`Dataset: ${out.days.length} Tage, ${total} Items, ${positives} Positive, `
    + `${skippedNoVector} ohne Vektor übersprungen, ${failedDays} fehlgeschlagene Tage`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
