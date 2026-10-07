#!/usr/bin/env npx tsx
/**
 * Baseline-Messung Phase 0 der Kuratierung — die Messlatte, an der das Gate
 * der Phasen 1–3 hängt (Spec „Evaluation und Gate", „Rollout → Phase 0";
 * Vertrag 2.10).
 *
 * Je Berlin-Tag mit manuellem article_job und veröffentlichtem Post:
 *   Pool = news_queue mit queued_at in [asOf − 48 h, asOf), asOf = created_at
 *   des Jobs; Ground Truth = published_units des Posts. Baselines:
 *   total_score-Top-20 via capByUnits, je K auf K Einheiten (Hand-Scores und
 *   Betreiber-Labels neutralisiert), Nachtlauf-Ist (selected_items des Auto-Jobs mit
 *   status=done), Handauswahl (isHandItem wie curation_precedents, P/R; dazu
 *   alle selected_items als hand_all_selected), Zufall (seeded). Metriken auf
 *   Story-Ebene (assignStoryKeys, Schwelle 0,8) und ID-Ebene bei K=10/15/20,
 *   Recall zusätzlich auf die Pool-Abdeckung normiert. Je Tag Abgleich mit
 *   dem Job, den curation_precedents führt.
 * Dazu: Pool-Abdeckung, content_length-Quantile, Techmeme-Übernahmequote je
 * techmeme_story_index, Draft- und Techmeme-Kosten aus llm_usage (cost_usd
 * NULL → aus Token-Spalten nachberechnet), Zeitkette
 * (schedule_config, Analyse-Ende, Techmeme-Läufe, Newsletter-Eingang,
 * Schreibdurchsatz), Streuung/MDE der Tagesdifferenzen, Negativ-Block.
 *
 * Read-only gegen die DB — schreibt ausschließlich scripts/curation-baseline.json.
 * Umfang: ~45 Tage, je Tag 5–8 Queries. Egress Größenordnung 100–150 MB:
 * Hauptposten sind die Job-Payloads (selected_items mit Volltext je Item,
 * gemessen 2026-10-06 im Mittel 243 KB je manuellem und 364 KB je Auto-Job;
 * written_sections mit Markdown — nur für manuelle Jobs und den Nachtlauf je
 * Tag, in Scheiben à 10, zusammen ~40–60 MB), die Embeddings (~1 MB je Tag)
 * und die Pool-Zeilen.
 * Laufzeit 5–10 Minuten. Laden, Helfer und Messlogik liegen getestet in
 * lib/curation/baseline-day.ts; hier nur Ladeschleifen, Verdrahtung, Ausgabe.
 *
 * Flags:
 *   --dry-run            alles rechnen, Datei NICHT schreiben
 *   --since YYYY-MM-DD   Anfang des Messbereichs (Default: min(Gate-Start, heute − 30 Tage))
 *
 * Lauf: pnpm curation:baseline            (gegen ~/.synthszr.env.prod, sonst .env.local)
 *       pnpm exec tsx scripts/measure-curation-baseline.ts --dry-run
 */
import { config } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'
import type { BaselineJobMeta, BaselineJobRow, HandMetrics, LlmRow, LlmUsageRaw, RankedMetrics, TechmemeItem } from '@/lib/curation/baseline-day'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

// Gate-Tage der Spec („Offline": 36 Gate-Tage 2026-08-25..09-29).
const GATE_START = '2026-08-25'
const GATE_END = '2026-09-29'
// WARUM 30: Spec „Rollout → Phase 0" — Zeitkette (Analyse-Ende, Newsletter-
// Eingang) über 30 Tage; „Phase 0 schätzt aus 30 Baseline-Tagen die Streuung".
const LAST_DAYS = 30
// K=10/15/20 (Vertrag 2.10); Top-20 ist die Gate-Referenz (Spec „Entscheidungsregel"),
// K=10 der Setzlisten-Recall.
const KS = [10, 15, 20] as const
// Länge der total_score- und Zufallsliste und K der gepaarten Differenz.
const TOP_UNITS = 20
// WARUM fester Seed: die Zufalls-Baseline muss für denselben Kalendertag bei
// jedem Lauf bit-identisch bleiben, sonst ändert ein Neulauf das git-getrackte
// JSON ohne Datenänderung. daySeed(day, 42) = 42 + Tage seit 1970 — nicht der
// Listenindex, der sich mit --since verschiebt (Entscheidung 5).
const RANDOM_SEED = 42
// WARUM zwei z-Werte (Entscheidung 22, Task 14 Entscheidung 7): mdeAtN mit
// Default-z 1,645 ist die Schwelle bei 50 % Power; der MDE bei 80 % Power
// braucht z₁₋α + z₁₋β = 1,645 + 0,8416. Die Gate-Kalibrierung (Spec OE 7)
// richtet sich nach dem 80-%-Wert.
const Z_POWER80 = 1.645 + 0.8416
// Schmale Zeilen (article_jobs ohne Payload, llm_usage, news_queue-Zeitstempel,
// daily_repo-Zeiten): 1000 (Vertrag 0, = max_rows). Die Payloads lädt
// loadJobPayloads gezielt in Scheiben à JOB_PAYLOAD_CHUNK.
const PAGE = 1000
// use_case-Strings des Draft-Jobs in lib/claude/ghostwriter-pipeline.ts: planArticle,
// callModelNonStreaming (Default 'ghostwriter'), rewriteWerEnding, proofreadText.
// Bewusst NICHT glossary_candidate_identification (Lexikon-Phase,
// lib/article-jobs/service.ts:515-578): derselbe use_case läuft parallel im
// Artikel-Crawl und ist im Job-Fenster nicht trennbar — Kosten = Untergrenze
// (Entscheidung 10).
const DRAFT_USE_CASES = new Set(['article_planning', 'ghostwriter', 'ghostwriter_take', 'proofreading'])
// relevance.ts:85 — withUsageLogging(client, 'techmeme_relevance')
const TECHMEME_USE_CASE = 'techmeme_relevance'
// WARUM 10 min (Entscheidung 11): ein Cron-Lauf = eine Relevanz-Anfrage
// (relevance.ts:85); Zeilen binnen Minuten sind Retries desselben Laufs, der
// nächste Lauf liegt Stunden entfernt.
const TECHMEME_RUN_GAP_MS = 10 * 60 * 1000
// WARUM 15 min (Entscheidung 8): die Synthese-Charge schreibt nach dem Scoring
// in Batches à 50 binnen Sekunden (lib/synthesis/pipeline.ts:433); eine
// Handergänzung oder ein Neulauf liegt typischerweise Stunden später.
const ANALYSIS_RUN_GAP_MS = 15 * 60 * 1000
// Spec „Rollout → Phase 0": Schreibdurchsatz der manuellen Jobs mit 20+
// Abschnitten — kurze Jobs (Tests, abgebrochene Versuche) verzerren Units/Minute.
const MIN_UNITS_FOR_THROUGHPUT = 20
const OUT_FILE = 'scripts/curation-baseline.json'
const NOTE = 'Pool = news_queue mit queued_at in [asOf-48h, asOf), asOf = created_at des manuellen Jobs, seitenweise à 1000 bis 2000; Stufe-1-Filter (Junk raus, content_length ≥ 500) — Abdeckung/Recall von total_score und random messen gegen DIESEN gefilterten Pool, Einheiten nur aus Techmeme-Quellen (< 500 Zeichen) fallen darunter (coverage.units_techmeme_only); total_score_top20 = capByUnits je K auf K Einheiten (je K die volle Liste bewertet; ein Techmeme-Bündel = 1 Einheit mit bis zu 5 IDs; ranked_ids = Liste für 20 Einheiten) nach Neutralisierung der Hand-Signale: metadata.manual-Items (total_score ≈ 20 aus der Admin-UI) auf Score 0, bundle_type nur bei metadata.techmeme mit bundle_type=topic behalten (der einzige automatisch gesetzte Wert) — sonst stünden die veröffentlichten Einheiten selbst vorn (Ground-Truth-Leak); REST-LEAK: ein Techmeme-Item, das der Betreiber von null auf topic gelabelt hat, ist historisch nicht von der Techmeme-Promotion zu trennen und bleibt vorn; NICHT neutralisiert: Artikel aus queueFromDailyRepo (daily_repo.source_type=article) tragen Scores 9,0 ohne Marker und können total_score_top20 leicht nach oben verzerren; unit_recall_covered je K (10/15/20) = Treffer auf abgedeckte Einheiten ÷ abgedeckte Einheiten (Zähler und Nenner pool-beschränkt, auch für hand/nightly); gemessener Job je Tag = pickPrecedentJobs aus lib/curation/precedents (dieselbe Funktion wie curation_precedents): jüngster manueller Job mit veröffentlichtem Post, ohne Rückfall auf ältere Jobs übersprungen bei no_units/no_attributable_units/no_selected (skipped_jobs); hand = isHandItem-Teilmenge der selected_items dieses Jobs, Events as-of created_at (wie curation_precedents; unberührte Techmeme-Themen zählen nicht), hand_all_selected = alle selected_items, je nur Tage mit nicht-leerer Liste; precedents_agreement = Abgleich des gemessenen Jobs mit dem Job in curation_precedents — VORBEHALT: der manuelle Pfad füllt mit getBalancedSelection auf, wenn nach dem Published-Filter weniger Items als maxItems übrig sind oder der Slider über der Auswahl steht, und nimmt ohne Handauswahl ganz die Balanced-Auswahl; Füll-Items sind historisch nicht erkennbar, precision_full ist dann eine Untergrenze, duplicate_rate und die Diff Hand−total_score enthalten Pipeline-Picks; Nachtlauf-Ist nur aus Auto-Jobs mit status=done, kein Nachtlauf-Replay (getBalancedSelection nicht as-of-fähig, offene Abweichung von der Spec); Story-Ebene über assignStoryKeys (0.8); Kosten und Durchsatz nur manuelle Jobs mit status=done: llm_usage im Fenster [started_at, completed_at] ÷ Write-Units (written_sections.length; Bündel + Einzelfassung zählen doppelt, daher Obergrenze je published_unit; published_units nur für den gemessenen Job des Tages); llm_usage-Zeilen mit cost_usd NULL aus den Token-Spalten mit heutiger MODEL_PRICING nachberechnet (repriced_calls), ohne Preis auch danach = unpriced_calls (0 $, Untergrenze); Draft-Kosten erst ab 2026-09-20 (Start von llm_usage, bis 2026-09-22 Zeilenverluste möglich) und nur Anthropic-Aufrufe (Gemini-Drafts loggen nicht) — Jobs ohne llm_usage-Zeile im Fenster stehen nicht in per_job, sondern in jobs_without_usage; Lexikon-Phase des Jobs (use_case glossary_candidate_identification) bewusst NICHT in den Draft-Kosten, weil derselbe use_case parallel im Artikel-Crawl läuft und im Zeitfenster nicht trennbar ist — der Durchsatz enthält sie (Wanduhr), die Kosten nicht, beide beziehen sich also auf leicht verschiedene Mengen, die Kosten sind eine bekannte Untergrenze; Techmeme-Stories über techmeme_story dedupliziert (eine Story in zwei 48-h-Fenstern zählt einmal); Analyse-Ende = Ende des ersten queued_at-Laufs (Lücke 15 min) ab schedule_config.dailyAnalysis je vollem Berlin-Tag der letzten 30 (angeschnittener erster und laufender Tag fallen weg), spätere Handergänzungen/Neuläufe als later_rows; Zeiten: analysis_end Berlin-Tag, techmeme UTC-Tag ab Bereichsanfang, newsletter = Vorlauf in Minuten vor dem nächsten Analyse-Slot (Berlin), kritischste Quelle zuerst; MDE: mde50 mit z 1.645 (50 % Power), mde80 mit z 1.645+0.8416 (80 % Power, maßgeblich für die Gate-Kalibrierung); Dubletten-Rate nur für den gemessenen Job je Tag; Zufalls-Seed = 42 + Tage seit 1970 (unabhängig von --since)'

async function main() {
  const {
    berlinDay, loadDayInputs, loadRepoEmbeddings, loadJobPayloads, loadPrecedentJobId, loadPickInputs, llmRowOf, seededShuffle, selectedIdsOf,
    parseArgs, rangeStartOf, rangeFromIso, inBerlinRange, daySeed, dailyAnalysisMinuteOf,
    mean, meanFinite, sampleSd, utcMinutesOfDay, hhmm, isoDayShift,
    groupJobsByDay, totalScoreListsByK, coverageOf, wantedIdsOf, repoIdsOf, itemEmbeddingsOf,
    publishedContentLengthsOf, rankedMetricsOf, unitCappedMetricsOf, handMetricsOf,
    aggregateRanked, aggregateHandExtras, pairedDiffs, precedentAgreementOf, techmemeAdoption, draftCostsOf, analysisEndByDay,
    throughputOf, newsletterArrivalOf, techmemeByUtcDay,
    POOL_LIMIT, POOL_PAGE, MIN_CONTENT_LENGTH,
  } = await import('@/lib/curation/baseline-day')

  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    // WARUM: ein Tippfehler in --since darf nicht still einen falschen Bereich messen.
    console.warn('[Curation] WARNUNG: --since ist ungültig (YYYY-MM-DD erwartet) — Abbruch.')
    process.exit(1)
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { DEFAULT_DEDUP_THRESHOLD } = await import('@/lib/news-queue/semantic-dedup')
  const { assignStoryKeys, pairedBootstrap, mdeAtN, quantiles, mulberry32 } = await import('@/lib/curation/baseline-metrics')
  const { loadNegativeBlock } = await import('@/lib/curation/negatives')
  const { pickPrecedentJobs } = await import('@/lib/curation/precedents')
  const supabase = createAdminClient()

  const today = berlinDay(new Date().toISOString())
  const rangeStart = rangeStartOf(today, args.since, GATE_START, LAST_DAYS)
  const rangeEnd = today
  console.log(`[Curation] measure-curation-baseline: ${args.dryRun ? 'DRY-RUN (keine Datei)' : `schreibt ${OUT_FILE}`}, Bereich ${rangeStart}..${rangeEnd}, Gate-Fenster ${GATE_START}..${GATE_END}`)
  const t0 = Date.now()

  // WARUM überall .order(<zeit>).order('id'): Zeitstempel kommen in Massen
  // doppelt vor (DEFAULT NOW() = Transaktionszeit, Synthese-Upserts in Batches,
  // lib/synthesis/pipeline.ts:433) — ohne eindeutigen Zweitschlüssel kann
  // .range() an Seitengrenzen Zeilen doppelt liefern oder überspringen
  // (BEFUND 2026-10-06, Review Task 15).

  // ── 1) article_jobs im Bereich: erst schmal (UTC-Vorfilter rangeFromIso, exakter Schnitt inBerlinRange) ──
  const jobsFromIso = rangeFromIso(rangeStart)
  const metas: BaselineJobMeta[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('article_jobs')
      .select('id, source, status, created_at, started_at, completed_at, generated_post_id')
      .gte('created_at', jobsFromIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`article_jobs: ${error.message}`)
    if (!data || data.length === 0) break
    for (const j of data as BaselineJobMeta[]) if (inBerlinRange(j.created_at, rangeStart)) metas.push(j)
    if (data.length < PAGE) break
  }
  const { manualByDay, autoByDay } = groupJobsByDay(metas)
  // Payload nur für die gebrauchten Jobs: alle manuellen (Kandidaten je Tag,
  // Kosten, Durchsatz) und den Nachtlauf je Tag (Entscheidung 4).
  const payloadMetas = [...[...manualByDay.values()].flat(), ...autoByDay.values()]
  const rows = await loadJobPayloads(supabase, payloadMetas)
  const rowOf = (m: BaselineJobMeta): BaselineJobRow => rows.get(m.id) as BaselineJobRow
  console.log(`[Curation] ${metas.length} Jobs geladen: ${manualByDay.size} Tage mit manuellem Job, ${autoByDay.size} Tage mit Auto-Job (status=done), Payload für ${rows.size} Jobs`)

  // ── 1b) Gemessener Job je Tag: pickPrecedentJobs aus Task 11 (Entscheidung 1) ──
  // WARUM dieselbe Funktion wie build-curation-precedents: Gate-Referenz,
  // curation_precedents, Negativ-Block und Phase-1-Backtest müssen für jeden
  // Tag denselben Job führen; eine zweite Implementierung könnte unbemerkt
  // abweichen (BEFUND 2026-10-06, Review Task 15).
  const manualRows = [...manualByDay.values()].flat().map(rowOf)
  const { statusById, unitsByPost } = await loadPickInputs(
    supabase,
    manualRows.map((j) => j.generated_post_id).filter((id): id is string => !!id),
  )
  const pick = pickPrecedentJobs(manualRows, statusById, unitsByPost)
  console.log(`[Curation] ${pick.byDay.size} Tage mit gemessenem Job; übersprungene manuelle Jobs: ${JSON.stringify(pick.skipped)}`)

  // ── 2) llm_usage einmal laden (schmal), Zuordnung über Zeitfenster ──
  // model + Token-Spalten: Zeilen mit cost_usd NULL (z. B. Opus 5.5 vor Task 13)
  // rechnet llmRowOf aus den Token nach (Entscheidung 10) — kein Prod-Write.
  const llm: LlmRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('llm_usage')
      .select('created_at, use_case, model, cost_usd, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens')
      .gte('created_at', jobsFromIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`llm_usage: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data as LlmUsageRaw[]) llm.push(llmRowOf(r))
    if (data.length < PAGE) break
  }
  console.log(`[Curation] ${llm.length} llm_usage-Zeilen seit ${jobsFromIso.slice(0, 10)} (${llm.filter((r) => r.repriced).length} nachberechnet, ${llm.filter((r) => r.cost === null).length} ohne Preis)`)

  // ── 3) Je Tag: Eingaben, Rankings, Story-Schlüssel, Metriken ──
  const skippedOnLoad = { no_post: 0, post_not_published: 0, no_units: 0 }
  const perDay: Array<Record<string, unknown>> = []
  const dayMetrics: Array<{ day: string; total: RankedMetrics; nightly: RankedMetrics | null; hand: HandMetrics | null; handAll: HandMetrics | null; random: RankedMetrics; units_covered: number }> = []
  const agreementRows: Array<{ day: string; job_id: string; precedent_job_id: string | null }> = []
  const coverage = { units_total: 0, units_attributable: 0, units_covered: 0, units_techmeme_only: 0 }
  const poolSizes: number[] = []
  const handSizes: number[] = []
  const selectedSizes: number[] = []
  const contentLengths: number[] = []
  const techmemeDays: Array<{ items: TechmemeItem[]; publishedIds: Set<string> }> = []
  const unitsByJob = new Map<string, number>()
  let truncatedDays = 0
  // days_total = Berlin-Tage mit mindestens einem manuellen Job (auch Tage,
  // deren Jobs alle ohne Post sind) — keine Kalendertage (Erklärung unter dem JSON-Shape).
  const days = [...manualByDay.keys()].sort()

  for (const [day, chosen] of pick.byDay) {
    // Nachtlauf-Ist (Entscheidung 4): groupJobsByDay liefert den jüngsten
    // Auto-Job mit status=done. Seine IDs gehen als extraIds in loadDayInputs,
    // damit sie eine news_queue-Zeile und damit ein Embedding bekommen (Entscheidung 6).
    const autoMeta = autoByDay.get(day)
    const nightlyIds = autoMeta ? selectedIdsOf(rowOf(autoMeta)) : null

    const loaded = await loadDayInputs(supabase, chosen, nightlyIds ?? [])
    if (loaded.reason !== null) {
      // pickPrecedentJobs hat Post-Status und Einheiten Sekunden vorher geprüft —
      // ein Grund hier heißt: die DB hat sich währenddessen geändert.
      skippedOnLoad[loaded.reason]++
      console.warn(`[Curation] WARNUNG: ${day}: beim Laden übersprungen (${loaded.reason})`)
      continue
    }
    const inputs = loaded.inputs

    // Rankings (Entscheidung 3: Hand-Scores und Betreiber-Labels neutralisieren, sonst Leak in capByUnits;
    // K zählt Einheiten — je K eine eigene capByUnits-Liste, die 20er-Liste ist die Obermenge)
    const totalLists = totalScoreListsByK(inputs.pool, KS)
    const totalScoreIds = totalLists[String(TOP_UNITS)]
    const randomIds = seededShuffle(inputs.pool.map((p) => p.id), mulberry32(daySeed(day, RANDOM_SEED))).slice(0, TOP_UNITS)
    // Handauswahl = isHandItem-Teilmenge der selected_items (Entscheidung 24,
    // dieselbe Menge wie curation_precedents); selectedIds = alle selected_items
    // (Zusatzzeile hand_all_selected). Kann Füll-Items aus getBalancedSelection
    // enthalten (selectAndEnrichItems in queue-article.ts), historisch nicht
    // erkennbar — Vorbehalt in NOTE/CLAUDE.md (Entscheidung 23).
    const handIds = inputs.handIds
    const selectedIds = inputs.selectedIds

    // Abgleich mit curation_precedents (Entscheidung 25)
    const precedentJobId = await loadPrecedentJobId(supabase, day)
    agreementRows.push({ day, job_id: chosen.id, precedent_job_id: precedentJobId })

    // Embeddings nur für die relevanten IDs (Entscheidung 6, Zuordnung getestet in baseline-day.ts), Story-Schlüssel
    const wanted = wantedIdsOf([totalScoreIds, nightlyIds, selectedIds, randomIds], inputs.units)
    const idToRepo = repoIdsOf(wanted, inputs.itemRows)
    const repoEmb = await loadRepoEmbeddings(supabase, [...idToRepo.values()])
    const embeddings = itemEmbeddingsOf(idToRepo, repoEmb)
    const storyOf = assignStoryKeys(wanted, embeddings, DEFAULT_DEDUP_THRESHOLD)
    const units = inputs.units
    const publishedIds = new Set(units.flatMap((u) => u.memberIds))

    // Pool-Abdeckung (Entscheidungen 2, 7)
    const cov = coverageOf(units, new Set(inputs.pool.map((p) => p.id)), new Set(inputs.techmemeItems.map((t) => t.id)))
    coverage.units_total += units.length
    coverage.units_attributable += cov.attributable.length
    coverage.units_covered += cov.covered.length
    coverage.units_techmeme_only += cov.techmemeOnly.length

    const ranked = (ids: string[]) => rankedMetricsOf(ids, units, cov.covered, storyOf, KS)
    // WARUM nicht ranked(): rankedMetricsOf schneidet bei K IDs — bei Techmeme-Bündeln weniger als K Einheiten
    const total = unitCappedMetricsOf(totalLists, units, cov.covered, storyOf, KS)
    const nightly = nightlyIds ? ranked(nightlyIds) : null
    const random = ranked(randomIds)
    const hand = handMetricsOf(handIds, units, cov.covered, storyOf, KS)
    const handAll = handMetricsOf(selectedIds, units, cov.covered, storyOf, KS)

    // Verteilungen
    poolSizes.push(inputs.pool.length)
    if (handIds.length > 0) handSizes.push(handIds.length)
    if (selectedIds.length > 0) selectedSizes.push(selectedIds.length)
    if (inputs.poolTruncated) truncatedDays++
    contentLengths.push(...publishedContentLengthsOf(publishedIds, inputs.itemRows))
    techmemeDays.push({ items: inputs.techmemeItems, publishedIds })
    unitsByJob.set(chosen.id, units.length)

    dayMetrics.push({ day, total, nightly, hand, handAll, random, units_covered: cov.covered.length })
    perDay.push({
      day, job_id: chosen.id, post_id: inputs.postId, as_of: inputs.asOf,
      in_gate_window: day >= GATE_START && day <= GATE_END, precedent_job_id: precedentJobId,
      pool_size: inputs.pool.length, pool_truncated: inputs.poolTruncated,
      units: units.length, units_attributable: cov.attributable.length, units_covered: cov.covered.length,
      units_techmeme_only: cov.techmemeOnly.length,
      hand_items: handIds.length, selected_items: selectedIds.length, nightly_items: nightlyIds ? nightlyIds.length : null,
      metrics: { total_score_top20: total, nightly_actual: nightly, hand, hand_all_selected: handAll, random },
      ranked_ids: { total_score_top20: totalScoreIds, random: randomIds },
      published_member_ids: [...publishedIds],
    })
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    console.log(`[Curation] ${day}: Pool ${inputs.pool.length}${inputs.poolTruncated ? ' (gekappt)' : ''} · ${units.length} Einheiten (${cov.covered.length} im Pool, ${cov.techmemeOnly.length} nur Techmeme) · Hand ${handIds.length}/${selectedIds.length}${precedentJobId === chosen.id ? '' : precedentJobId ? ' · ABWEICHUNG curation_precedents' : ' · ohne curation_precedents'} · UnitRecall@20 total_score ${total.unit_recall['20'].toFixed(2)} / Hand ${hand ? hand.unit_recall['20'].toFixed(2) : '–'} / Nachtlauf ${nightly ? nightly.unit_recall['20'].toFixed(2) : '–'} (${mins} min)`)
  }

  // ── 4) Aggregation der Baselines ──
  const q = (values: number[], qs: number[], names: string[]): Record<string, number> => {
    const vals = quantiles(values, qs)
    const out: Record<string, number> = {}
    names.forEach((n, i) => { out[n] = vals[i] })
    return out
  }
  const aggOf = (pick: (d: typeof dayMetrics[number]) => RankedMetrics | null) =>
    aggregateRanked(dayMetrics.map((d) => ({ m: pick(d), covered: d.units_covered })), KS)
  const baselines = {
    total_score_top20: aggOf((d) => d.total),
    nightly_actual: aggOf((d) => d.nightly),
    hand: {
      ...aggOf((d) => d.hand),
      ...aggregateHandExtras(dayMetrics.map((d) => d.hand)),
      items_quantiles: q(handSizes, [0.1, 0.5, 0.9], ['p10', 'p50', 'p90']),
    },
    // Zusatzzeile (Entscheidung 24): alle selected_items inkl. unberührter Techmeme-Themen — keine Gate-Referenz.
    hand_all_selected: {
      ...aggOf((d) => d.handAll),
      ...aggregateHandExtras(dayMetrics.map((d) => d.handAll)),
      items_quantiles: q(selectedSizes, [0.1, 0.5, 0.9], ['p10', 'p50', 'p90']),
    },
    random: aggOf((d) => d.random),
  }
  const precedentsAgreement = precedentAgreementOf(agreementRows)

  // ── 5) Kosten: Draft-Jobs (manuell, done) und Techmeme-Läufe je UTC-Tag ──
  // Kandidaten, Kostenzeilen und Jobs ohne Usage aus EINER Regel (isCostCandidate,
  // getestet in baseline-day.ts — Entscheidung 10: llm_usage erst ab 2026-09-20,
  // Gemini loggt nicht).
  const { candidates: costCandidates, rows: draftCosts, withoutUsage: jobsWithoutUsage } =
    draftCostsOf(manualRows, unitsByJob, llm, DRAFT_USE_CASES)
  // Ab rangeStart: der Vorfilter lädt llm_usage 3 h früher (Entscheidung 11).
  const techmemeCosts = techmemeByUtcDay(llm, TECHMEME_USE_CASE, TECHMEME_RUN_GAP_MS, rangeStart)

  // ── 6) Zeitkette ──
  const { data: cfgRow, error: cfgError } = await supabase.from('settings').select('value').eq('key', 'schedule_config').maybeSingle()
  if (cfgError) throw new Error(`settings: ${cfgError.message}`)
  const scheduleConfig = cfgRow?.value ?? null
  const dailyAnalysisMinute = dailyAnalysisMinuteOf(scheduleConfig)

  // WARUM ab heute und nicht ab rangeStart (Entscheidung 16): die Zeitkette
  // beschreibt die aktuelle Betriebslage für den vorgezogenen Winter-Slot
  // (Spec „Rollout → Phase 0": „30 Tage"), nicht die Gate-Tage im August.
  // Tagesgenau (Entscheidung 8): laden ab rangeFromIso(heute − 30) mit 3 h Vorlauf,
  // analysisEndByDay wertet nur volle Berlin-Tage [heute − 30, heute).
  const since30Day = isoDayShift(today, -LAST_DAYS)
  const since30From = rangeFromIso(since30Day)

  // Analyse-Ende je Berlin-Tag (Entscheidung 8): daily_repo_id IS NOT NULL ist
  // nur der Vorfilter (schließt Techmeme- und UI-Handitems aus); die Charge
  // selbst bestimmt analysisEndByDay über den ersten Lauf ab dailyAnalysis.
  const queuedAts: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('news_queue')
      .select('queued_at')
      .gte('queued_at', since30From)
      .not('daily_repo_id', 'is', null)
      .order('queued_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`news_queue (analysis end): ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data) queuedAts.push(r.queued_at as string)
    if (data.length < PAGE) break
  }
  const analysisEnd = analysisEndByDay(queuedAts, {
    notBeforeBerlinMinute: dailyAnalysisMinute, gapMs: ANALYSIS_RUN_GAP_MS, fromBerlinDay: since30Day, beforeBerlinDay: today,
  })
  const analysisMinutes = analysisEnd.days.map((d) => utcMinutesOfDay(d.last_queued_at))
  const analysisQ = quantiles(analysisMinutes, [0.5, 0.9])
  const analysisMax = analysisMinutes.length ? Math.max(...analysisMinutes) : NaN

  // Newsletter-Eingang je Quelle (Entscheidung 9)
  const arrivalRows: Array<{ source_email: string | null; email_received_at: string | null; collected_at: string | null }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('daily_repo')
      .select('source_email, email_received_at, collected_at')
      .eq('source_type', 'newsletter')
      .gte('collected_at', since30From)
      .order('collected_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`daily_repo (arrivals): ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data) {
      arrivalRows.push({
        source_email: (r.source_email as string | null) ?? null,
        email_received_at: (r.email_received_at as string | null) ?? null,
        collected_at: (r.collected_at as string | null) ?? null,
      })
    }
    if (data.length < PAGE) break
  }
  // Vorlauf vor dem heute eingestellten Slot (Entscheidung 9) — kritischste Quelle zuerst
  const newsletterArrival = newsletterArrivalOf(arrivalRows, dailyAnalysisMinute)

  // Schreibdurchsatz (Entscheidung 12: nur manuelle Jobs, Spec „Rollout → Phase 0")
  const throughputJobs = throughputOf(manualRows, MIN_UNITS_FOR_THROUGHPUT)
  const writingThroughput = {
    n: throughputJobs.length,
    write_units_per_minute_mean: mean(throughputJobs.map((j) => j.write_units_per_minute)),
    minutes_per_20_write_units_mean: mean(throughputJobs.map((j) => (20 * j.minutes) / j.write_units)),
    per_job: throughputJobs,
  }

  // ── 7) Streuung / MDE der Tagesdifferenzen (Hand − total_score, UnitRecall@20) ──
  const diffs = pairedDiffs(dayMetrics, TOP_UNITS)
  const sd = sampleSd(diffs)
  const stats = {
    diff_hand_minus_total_score_unit_recall_20: {
      n: diffs.length, mean: mean(diffs), sd,
      bootstrap_90: pairedBootstrap(diffs),
      // Entscheidung 22: mde50 = Default-z (50 % Power), mde80 = Z_POWER80 (80 % Power, maßgeblich fürs Gate)
      mde50_n20: mdeAtN(sd, 20), mde50_n30: mdeAtN(sd, 30),
      mde80_n20: mdeAtN(sd, 20, Z_POWER80), mde80_n30: mdeAtN(sd, 30, Z_POWER80),
    },
  }

  // ── 8) Negativ-Block „Gewählt, aber gestrichen" (14 Tage, Task 12) ──
  const negative = await loadNegativeBlock(supabase, { days: 14 })

  // ── 9) Summary ──
  const summary = {
    generated_at: new Date().toISOString(),
    range: { from: rangeStart, to: rangeEnd, gate_window: [GATE_START, GATE_END], last_days: LAST_DAYS },
    days_total: days.length,
    days_measured: perDay.length,
    skipped_jobs: pick.skipped,
    skipped_days_on_load: skippedOnLoad,
    precedents_agreement: precedentsAgreement,
    pool: {
      window_hours: 48, min_content_length: MIN_CONTENT_LENGTH, page: POOL_PAGE, limit: POOL_LIMIT, truncated_days: truncatedDays,
      size_quantiles: q(poolSizes, [0.1, 0.5, 0.9], ['p10', 'p50', 'p90']),
    },
    coverage: {
      ...coverage,
      rate: coverage.units_attributable ? coverage.units_covered / coverage.units_attributable : NaN,
      unattributable_units: coverage.units_total - coverage.units_attributable,
    },
    baselines,
    published_content_length: {
      n: contentLengths.length,
      quantiles: q(contentLengths, [0.1, 0.25, 0.5, 0.75, 0.9], ['p10', 'p25', 'p50', 'p75', 'p90']),
    },
    techmeme_adoption_by_story_index: techmemeAdoption(techmemeDays),
    costs: {
      draft_jobs: {
        n: draftCosts.length,
        candidates: costCandidates,
        jobs_without_usage: jobsWithoutUsage,
        usage_first_at: llm.length ? new Date(llm[0].iso).toISOString() : null,
        cost_usd_mean: mean(draftCosts.map((c) => c.cost_usd)),
        write_units_mean: mean(draftCosts.map((c) => c.write_units)),
        cost_per_write_unit_usd_mean: meanFinite(draftCosts.map((c) => c.cost_per_write_unit_usd)),
        repriced_calls: draftCosts.reduce((a, c) => a + c.repriced_calls, 0),
        unpriced_calls: draftCosts.reduce((a, c) => a + c.unpriced_calls, 0),
        per_job: draftCosts,
      },
      techmeme_by_utc_day: techmemeCosts,
    },
    timeline: {
      schedule_config: scheduleConfig,
      daily_analysis_berlin: hhmm(dailyAnalysisMinute),
      analysis_end_by_day: analysisEnd.days,
      analysis_end_days_without_scheduled_run: analysisEnd.daysWithoutScheduledRun,
      analysis_end_utc_minutes: {
        n: analysisMinutes.length, p50: analysisQ[0], p90: analysisQ[1], max: analysisMax,
        p50_hhmm: hhmm(analysisQ[0]), p90_hhmm: hhmm(analysisQ[1]), max_hhmm: hhmm(analysisMax),
      },
      newsletter_arrival_by_source: newsletterArrival,
      writing_throughput: writingThroughput,
    },
    stats,
    negative_block: { days: 14, units: negative.units.length, approx_tokens: negative.approxTokens, preview: negative.text.slice(0, 300) },
    note: NOTE,
    per_day: perDay,
  }

  if (!args.dryRun) writeFileSync(OUT_FILE, JSON.stringify(summary, null, 1))

  const fx = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–')
  console.table({
    days_total: summary.days_total,
    days_measured: summary.days_measured,
    'Jobs übersprungen no_post / not_published / superseded': `${pick.skipped.no_post} / ${pick.skipped.not_published} / ${pick.skipped.superseded}`,
    'Jobs übersprungen no_units / no_attributable_units / no_selected': `${pick.skipped.no_units} / ${pick.skipped.no_attributable_units} / ${pick.skipped.no_selected}`,
    'curation_precedents gleich / anders / fehlt': `${precedentsAgreement.match} / ${precedentsAgreement.mismatch} / ${precedentsAgreement.missing}`,
    pool_truncated_days: truncatedDays,
    coverage_rate: fx(summary.coverage.rate),
    units_techmeme_only: coverage.units_techmeme_only,
    'UnitRecall@20 total_score': fx(baselines.total_score_top20.unit_recall['20']),
    'UnitRecall@20 nightly': fx(baselines.nightly_actual.unit_recall['20']),
    'UnitRecall@20 hand': fx(baselines.hand.unit_recall['20']),
    'UnitRecall@20 hand_all_selected': fx(baselines.hand_all_selected.unit_recall['20']),
    'UnitRecall@10 / @20 total_score (pool-normiert)': `${fx(baselines.total_score_top20.unit_recall_covered['10'])} / ${fx(baselines.total_score_top20.unit_recall_covered['20'])}`,
    'UnitRecall@20 random': fx(baselines.random.unit_recall['20']),
    'Hand n / P / R (voll)': `${baselines.hand.n} / ${fx(baselines.hand.precision_full)} / ${fx(baselines.hand.recall_full)}`,
    'Diff Hand−total sd': fx(sd),
    'MDE 50 % Power n=20 / n=30': `${fx(stats.diff_hand_minus_total_score_unit_recall_20.mde50_n20)} / ${fx(stats.diff_hand_minus_total_score_unit_recall_20.mde50_n30)}`,
    'MDE 80 % Power n=20 / n=30 (Gate)': `${fx(stats.diff_hand_minus_total_score_unit_recall_20.mde80_n20)} / ${fx(stats.diff_hand_minus_total_score_unit_recall_20.mde80_n30)}`,
    'Draft USD/Write-Unit': fx(summary.costs.draft_jobs.cost_per_write_unit_usd_mean),
    'Draft-Jobs mit / ohne llm_usage': `${draftCosts.length} / ${jobsWithoutUsage}`,
    'Draft-Zeilen nachberechnet / ohne Preis': `${summary.costs.draft_jobs.repriced_calls} / ${summary.costs.draft_jobs.unpriced_calls}`,
    'Newsletter kritischste Quelle (Vorlauf p10 min)': newsletterArrival[0] ? `${newsletterArrival[0].source_email} (${fx(newsletterArrival[0].lead_p10_minutes, 0)})` : '–',
    'Analyse-Ende p90 UTC': summary.timeline.analysis_end_utc_minutes.p90_hhmm,
    'Tage ohne Analyse-Lauf ab Slot': analysisEnd.daysWithoutScheduledRun.length,
    'Write-Units/min': fx(writingThroughput.write_units_per_minute_mean, 2),
    'Negativ-Block Tokens': negative.approxTokens,
  })
  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG${args.dryRun ? ' (DRY-RUN, nichts geschrieben)' : `: ${OUT_FILE} geschrieben`} — ${perDay.length}/${days.length} Tage, ${mins} min`)
  if (perDay.length < 20) console.warn('[Curation] WARNUNG: unter 20 messbaren Tagen — Streuung/MDE wenig belastbar; Auffrischung published_units/curation_precedents prüfen (Plan Task 15 Steps 15c–15f, Schreiben nur in 15e/15f mit [FREIGABE]).')
  if (pick.skipped.no_units > 0) console.warn(`[Curation] WARNUNG: ${pick.skipped.no_units} Tage ohne published_units — Auffrischung nach Plan Task 15 Steps 15c–15f (Schreiben nur in 15e/15f mit [FREIGABE]), nicht frei Hand.`)
  if (precedentsAgreement.mismatch > 0) console.warn(`[Curation] WARNUNG: ${precedentsAgreement.mismatch} Tage, an denen curation_precedents einen anderen Job führt (${precedentsAgreement.mismatch_days.join(', ')}) — Präzedenzfälle sind älter als der jüngste veröffentlichte Job; Auffrischung nach Steps 15c–15f (Schreiben nur in 15e/15f mit [FREIGABE]).`)
  if (precedentsAgreement.missing > 0) console.warn(`[Curation] WARNUNG: ${precedentsAgreement.missing} Tage ohne curation_precedents (${precedentsAgreement.missing_days.join(', ')}) — Auffrischung nach Steps 15c–15f prüfen (Schreiben nur in 15e/15f mit [FREIGABE]).`)
  if (truncatedDays > 0) console.warn(`[Curation] WARNUNG: ${truncatedDays} Tage mit gekapptem Pool (≥ ${POOL_LIMIT} Zeilen) — Recall/Abdeckung dieser Tage sind Untergrenzen.`)
  if (jobsWithoutUsage > 0) console.warn(`[Curation] WARNUNG: ${jobsWithoutUsage} von ${costCandidates} Draft-Jobs ohne llm_usage-Zeile (vor 2026-09-20 oder Gemini) — nicht im Kostenmittel, siehe costs.draft_jobs.usage_first_at.`)
  if (summary.costs.draft_jobs.repriced_calls > 0) console.log(`[Curation] ${summary.costs.draft_jobs.repriced_calls} Draft-Zeilen mit cost_usd NULL aus Token-Spalten nachberechnet (heutige MODEL_PRICING, Entscheidung 10).`)
  if (summary.costs.draft_jobs.unpriced_calls > 0) console.warn(`[Curation] WARNUNG: ${summary.costs.draft_jobs.unpriced_calls} Draft-Zeilen auch nach Nachberechnung ohne Preis (Modell fehlt in MODEL_PRICING) — Draft-Kosten sind Untergrenze.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
