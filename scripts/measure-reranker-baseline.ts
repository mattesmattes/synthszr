#!/usr/bin/env npx tsx
/**
 * Gemessene Trefferquote des BISHERIGEN LLM-Rerankers — die Messlatte des
 * News-Taste-Modells (Spec: „Gate").
 *
 * Je ranking_run: die Vorschläge (nach suggested_rank) als Ranking, relevant
 * sind die Queue-Items, die in einem binnen 48 h NACH dem Lauf
 * veröffentlichten Post gelandet sind. 48 h ist eine bewusste Näherung: der
 * Lauf morgens speist den Post desselben/nächsten Tages.
 *
 * Read-only gegen die DB — schreibt ausschließlich die lokale Datei
 * scripts/reranker-baseline.json.
 */
import { config } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const PAGE = 200 // generated_posts-Pagination — s. scripts/lib/taste-ground-truth.ts:
// .in()-Listen/größere .limit()-Abfragen lösen gegen die Produktions-Instanz
// ab ~400 Zeilen einen HeadersOverflowError (undici) aus. Seitenweise per
// .range() holen, damit bei >2000 Posts (bisheriges .limit(2000)) kein Post
// stillschweigend fehlt.
const WINDOW_MS = 48 * 3600 * 1000

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { recallAtK, ndcgAtK } = await import('@/lib/news-queue/metrics')
  const { extractQueueItemIds } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  // 1) Alle veröffentlichten Posts seitenweise laden (siehe PAGE oben) —
  //    nur content/created_at, mehr braucht extractQueueItemIds nicht.
  const published: Array<{ at: number; ids: string[] }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('generated_posts')
      .select('content, created_at').eq('status', 'published')
      .order('created_at', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`generated_posts: ${error.message}`)
    if (!data || data.length === 0) break
    for (const p of data) {
      published.push({ at: new Date(p.created_at as string).getTime(), ids: extractQueueItemIds(p.content) })
    }
    if (data.length < PAGE) break // letzte Seite war nicht voll
  }

  const { data: runs, error: runsError } = await supabase.from('ranking_runs')
    .select('id, created_at, model').order('created_at', { ascending: true })
  if (runsError) throw new Error(`ranking_runs: ${runsError.message}`)

  const perRun: Array<{ runId: string; day: string; n: number; r10: number; r15: number; ndcg15: number }> = []
  // WARUM getrennt zählen: der Controller muss beurteilen können, ob das
  // 48h-Attributionsfenster plausibel ist — "kein Vorschlag" (Datenlücke im
  // Run selbst) ist ein anderes Problem als "kein Post binnen 48h" (Fenster
  // evtl. zu eng, oder der Run hatte schlicht keinen Nachfolge-Post).
  let skippedNoSuggestions = 0
  let skippedNoPostWithin48h = 0

  for (const run of runs ?? []) {
    const { data: sugg, error: suggError } = await supabase.from('ranking_suggestions')
      .select('queue_item_id, suggested_rank').eq('run_id', run.id)
      .order('suggested_rank', { ascending: true })
    if (suggError) throw new Error(`ranking_suggestions (run ${run.id}): ${suggError.message}`)
    const ranked = (sugg ?? []).map((s) => s.queue_item_id as string)
    if (ranked.length === 0) {
      skippedNoSuggestions++
      continue
    }

    const t = new Date(run.created_at as string).getTime()
    const relevant = new Set<string>()
    for (const p of published) {
      if (p.at >= t && p.at <= t + WINDOW_MS) p.ids.forEach((id) => relevant.add(id))
    }
    if (relevant.size === 0) {
      skippedNoPostWithin48h++
      continue
    }

    perRun.push({
      runId: run.id as string,
      day: (run.created_at as string).slice(0, 10),
      n: relevant.size,
      r10: recallAtK(ranked, relevant, 10),
      r15: recallAtK(ranked, relevant, 15),
      ndcg15: ndcgAtK(ranked, relevant, 15),
    })
  }

  const relevantSizes = perRun.map((r) => r.n)
  const summary = {
    generated_at: new Date().toISOString(),
    runs_total: (runs ?? []).length,
    runs_measured: perRun.length,
    skipped_no_suggestions: skippedNoSuggestions,
    skipped_no_post_within_48h: skippedNoPostWithin48h,
    mean_recall_at_10: mean(perRun.map((r) => r.r10)),
    mean_recall_at_15: mean(perRun.map((r) => r.r15)),
    mean_ndcg_at_15: mean(perRun.map((r) => r.ndcg15)),
    relevant_size_distribution: {
      min: relevantSizes.length ? Math.min(...relevantSizes) : 0,
      median: median(relevantSizes),
      max: relevantSizes.length ? Math.max(...relevantSizes) : 0,
    },
    note: 'relevant = queueItemIds in Posts, veröffentlicht binnen 48h nach dem Lauf',
    per_run: perRun,
  }
  writeFileSync('scripts/reranker-baseline.json', JSON.stringify(summary, null, 1))
  console.table({
    runs_total: summary.runs_total,
    runs_measured: summary.runs_measured,
    skipped_no_suggestions: summary.skipped_no_suggestions,
    skipped_no_post_48h: summary.skipped_no_post_within_48h,
    'Recall@10': summary.mean_recall_at_10.toFixed(3),
    'Recall@15': summary.mean_recall_at_15.toFixed(3),
    'NDCG@15': summary.mean_ndcg_at_15.toFixed(3),
  })
  console.log('relevant.size distribution (min/median/max):', summary.relevant_size_distribution)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
