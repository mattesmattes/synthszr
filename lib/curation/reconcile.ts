/**
 * Rekonziliation der Morgenkonferenz (Task 11, Anhang A §3.10): ein fertiger
 * Shadow-Run wird dem Post zugeordnet, den der Betreiber tatsächlich
 * veröffentlicht hat; jede Plan-Einheit bekommt ein Outcome, der Tag seine
 * Metriken, und aggregateRuns mittelt die Tage gegen das Gate (Spec
 * „Evaluation und Gate", Betreiber-Vorgabe 2026-10-05).
 *
 * Aufbau wie precedents.ts / baseline-day.ts: pickMatchingPost,
 * reconcileOutcomes, metricsOf und aggregateRuns sind rein (kein Supabase,
 * keine Embedding-Erzeugung); loadMatchCandidates und die load*-Helfer
 * bekommen den Client als ersten Parameter (Vertrag 0); reconcileRun
 * verdrahtet beides und ist der einzige Schreibzugriff (published_units über
 * processPost, curation_units, curation_runs).
 *
 * Treffer-Währung (Spec „Treffer-Währung", Ruling R16): Plan und Baseline
 * treffen einen Abschnitt nach derselben Regel — gemeinsame ID, derselbe
 * Story-Cluster (assignStoryKeys, 0,8, über Plan-, Post- und Baseline-IDs)
 * oder Similarity Item ↔ Abschnitts-Embedding ≥ 0,8. Die Outcomes der
 * exklusiven Zuordnung (R13) tragen Precision, Cut-Rate und die Spalten je
 * Einheit.
 */
import { meanFinite, neutralizeHandLabels, unitKeyOf, unitListsByK } from '@/lib/curation/baseline-day'
import { assignStoryKeys, pairedBootstrap } from '@/lib/curation/baseline-metrics'
import { loadPoolEmbeddings } from '@/lib/curation/pool'
import { berlinDay, precedentSelectedItems } from '@/lib/curation/precedents'
import { getRunUnits, markReconciled, updateUnitOutcomes } from '@/lib/curation/service'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import { DEFAULT_DEDUP_THRESHOLD, parseEmbedding } from '@/lib/news-queue/semantic-dedup'
import { processPost, type EmbedTexts, type PostRow } from '@/scripts/lib/published-units-backfill'
import {
  CURATION_ROLES,
  MATCH_WINDOW_MS,
  type BaselineLists, type ClusterResult, type CurationRole, type CurationTier, type PoolSnapshot,
  type RunMetrics, type RunRow, type UnitInsert, type UnitOutcome, type UnitRow,
} from '@/lib/curation/types'

const HOUR_MS = 3600 * 1000
/** Ein Tages-Job darf bis zu 2 h vor dem Kickoff angelegt sein (Anhang A §3.10). */
const JOB_LEAD_MS = 2 * HOUR_MS
/**
 * Ende des Job-Fensters: asOf + 22 h, exklusiv (Betreiber 2026-10-15). Mit
 * +24 h überlappten sich die Fenster zweier Tage um die 2 h Vorlauf, und der
 * jüngste Job gewann — ein Frühjob des Folgetags (seit 25.08. dreimal: 03:55,
 * 04:21, 04:23 UTC) wurde dem Vortag zugeschlagen. Im Cron-Pfad fiel das nur
 * nicht auf, weil der Folgepost um 04:26 UTC noch unveröffentlicht ist; im
 * Backtest sind beide Posts da. [asOf − 2 h, asOf + 22 h) schließt lückenlos
 * an das Fenster des nächsten Tages an.
 */
const JOB_WINDOW_END_MS = 22 * HOUR_MS
/** Kandidaten-Fenster auf generated_posts.created_at (Anhang A §3.10), deckt den Tag-Fallback ab. */
const POST_CREATED_WINDOW_MS = 36 * HOUR_MS
const POST_COLUMNS = 'id, status, created_at, published_at'
/** Setzlisten-Recall/-Precision@10 (Spec „Metriken je Tag"). */
const SETZLISTE_K = 10
/** Unit-Recall@20 für Setzliste + Bank (Spec „Metriken je Tag"). */
const PLAN_K = 20
/** Baseline je K in Einheiten wie totalScoreListsByK in run.ts (BASELINE_KS). */
const BASELINE_KS = [10, 20] as const

/**
 * Gate (Spec „Entscheidungsregel", Schwellen final nach Phase 0, Betreiber
 * 2026-10-15; Böden nachkalibriert 2026-10-17). Die Böden gelten für die
 * pool-normierten Recalls (unit_recall_covered_20, setzlisten_recall_covered_10):
 * der Agent sieht nur den Pool. WARUM 0,60/0,45 statt der Phase-0-Werte
 * 0,5/0,35: die Phase-0-Baseline misst in einer anderen Währung (as-of
 * Job-Zeit, Embeddings nur aus daily_repo, keine Abschnitts-Similarity) und
 * sah total_score bei 0,31/0,22; in DIESER Währung (publishedHitsOf, Pool des
 * Kickoffs) lag total_score im Backtest precedents-only (49 Tage) bei 0,53/0,45
 * und bestand die alten Böden selbst. Die neuen Böden liegen wie zuvor in der
 * Mitte zwischen total_score (0,53/0,45) und der Gesamtauswahl des Betreibers
 * (0,69/0,48). Entscheidung erst ab 30 Tagesdifferenzen: die Baseline-Streuung
 * (sd 0,233) ergibt einen MDE bei 80 % Power von 0,129 für n = 20 und 0,106
 * für n = 30 — +0,10 ist mit 20 Tagen nicht verlässlich nachweisbar (in der
 * Gate-Währung streut die Differenz Agent − total_score mit sd 0,169, MDE80
 * 0,077 bei n = 30). Der Abbruch-Check der Spec („nach 20 Tagen unter
 * total_score") bleibt bei 20.
 */
const GATE_RECALL_GAIN = 0.10
const GATE_FLOOR_UNIT_RECALL_COVERED_20 = 0.60
const GATE_FLOOR_SETZLISTE_RECALL_COVERED_10 = 0.45
/** Anhang A §3.10: recall_gain null bei n < 5 — unter 5 Tagesdifferenzen trägt das Bootstrap-Intervall keine Aussage. */
const GATE_MIN_DAYS = 5
const GATE_ABORT_DAYS = 20
const GATE_DECISION_DAYS = 30

const HIT_OUTCOMES = new Set<UnitOutcome>(['kept', 'relabeled', 'merged'])
const TIER_ORDER: Record<CurationTier, number> = { recommended: 0, bench: 1, held: 2 }
/** Zeilen ohne Tier (outcome 'added') stehen hinter allen Plan-Tiers. */
const NO_TIER_ORDER = 3

// ── Attribution ───────────────────────────────────────────────────────────

export interface MatchJob { id: string; created_at: string; generated_post_id: string | null; selected_items: unknown; source: string }
export interface MatchPost { id: string; status: string; created_at: string; published_at: string | null }
export interface MatchCandidates { jobs: MatchJob[]; posts: MatchPost[] }
export interface MatchResult { post_id: string; job_id: string | null; attribution: 'job' | 'published_at' | 'created_at_day' }

/** Jüngster manueller Job im Fenster [asOf − 2 h, asOf + 22 h), dessen Post veröffentlicht ist. */
function newestManualJob(asOfMs: number, jobs: MatchJob[], publishedIds: Set<string>): { id: string; postId: string } | null {
  let best: { id: string; postId: string; at: number } | null = null
  for (const job of jobs) {
    if (job.source !== 'manual') continue
    if (!job.generated_post_id || !publishedIds.has(job.generated_post_id)) continue
    const at = Date.parse(job.created_at)
    if (at < asOfMs - JOB_LEAD_MS || at >= asOfMs + JOB_WINDOW_END_MS) continue
    if (!best || at > best.at) best = { id: job.id, postId: job.generated_post_id, at }
  }
  return best
}

/** Frühester veröffentlichter Post mit published_at in (asOf, asOf + 24 h]. */
function earliestPublishedAfter(asOfMs: number, posts: MatchPost[]): MatchPost | null {
  let best: { post: MatchPost; at: number } | null = null
  for (const post of posts) {
    if (!post.published_at) continue
    const at = Date.parse(post.published_at)
    if (at <= asOfMs || at > asOfMs + MATCH_WINDOW_MS) continue
    if (!best || at < best.at) best = { post, at }
  }
  return best?.post ?? null
}

/** Frühester veröffentlichter Post, dessen created_at auf denselben Berliner Tag fällt wie asOf. */
function sameDayPost(asOf: string, posts: MatchPost[]): MatchPost | null {
  const day = berlinDay(asOf)
  const sameDay = posts.filter((p) => berlinDay(p.created_at) === day)
  sameDay.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  return sameDay[0] ?? null
}

/**
 * Welcher Post gehört zum Run? Kaskade Job → published_at → created_at-Tag.
 *
 * WARUM der Job zuerst: published_at ist für den Bestand rückwirkend aus
 * updated_at gefüllt (supabase/migrations/20261006090000_curation_phase0.sql:
 * 29-40) — bei Editor-Publishes der letzte Editor-Save, der Tage nach der
 * Veröffentlichung liegen kann. Der manuelle Tages-Job zeigt dagegen über
 * generated_post_id direkt auf den Post des Tages. Nur source = 'manual':
 * Nachtlauf-Drafts (auto) sind nicht die Auswahl des Betreibers.
 * WARUM created_at als letzte Stufe: bei Ghostwriter-Posts ist created_at
 * der gewählte Veröffentlichungstag 07:00 MEZ (dieselbe Migration, Z. 5-11).
 */
export function pickMatchingPost(asOf: string, c: MatchCandidates): MatchResult | null {
  const asOfMs = Date.parse(asOf)
  const published = c.posts.filter((p) => p.status === 'published')
  const publishedIds = new Set(published.map((p) => p.id))

  const job = newestManualJob(asOfMs, c.jobs, publishedIds)
  if (job) return { post_id: job.postId, job_id: job.id, attribution: 'job' }

  const byPublishedAt = earliestPublishedAfter(asOfMs, published)
  if (byPublishedAt) return { post_id: byPublishedAt.id, job_id: null, attribution: 'published_at' }

  const byDay = sameDayPost(asOf, published)
  if (byDay) return { post_id: byDay.id, job_id: null, attribution: 'created_at_day' }

  return null
}

/**
 * Steht das Abgleichfenster eines Runs noch offen (asof juenger als
 * MATCH_WINDOW_MS)? Dann kann der Post des Tages noch fehlen — ein Abgleich
 * jetzt schriebe dauerhaft attribution 'none' (Final-Review 2026-10-14 (R21)).
 * Die Scripts ueberspringen solche Runs, der Cron liefert sie erst gar nicht
 * (getRunsToReconcile, service.ts).
 */
export function isMatchWindowOpen(asof: string, nowMs: number): boolean {
  return Date.parse(asof) > nowMs - MATCH_WINDOW_MS
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Kandidaten für pickMatchingPost. Zwei Post-Abfragen statt eines or()-Filters
 * mit verschachteltem and(), dedupliziert über id.
 * WARUM selected_items hier nicht mitkommt: die Spalte trägt je Item den
 * Volltext (BEFUND 2026-10-06 in baseline-day.ts JOB_PAYLOAD_CHUNK: bis
 * 780 KB je Job) — geladen wird sie nur für den einen Treffer (loadSelectedIds).
 */
export async function loadMatchCandidates(supabase: SupabaseAdmin, asOf: string): Promise<MatchCandidates> {
  const asOfMs = Date.parse(asOf)

  const { data: jobRows, error: jobError } = await supabase
    .from('article_jobs')
    .select('id, created_at, generated_post_id, source')
    .gte('created_at', isoOf(asOfMs - JOB_LEAD_MS))
    .lte('created_at', isoOf(asOfMs + MATCH_WINDOW_MS))
  if (jobError) throw new Error(`article_jobs: ${jobError.message}`)
  const jobs = ((jobRows ?? []) as Array<Omit<MatchJob, 'selected_items'>>).map((row) => ({ ...row, selected_items: null }))

  const { data: byCreated, error: createdError } = await supabase
    .from('generated_posts')
    .select(POST_COLUMNS)
    .eq('status', 'published')
    .gte('created_at', isoOf(asOfMs - POST_CREATED_WINDOW_MS))
    .lte('created_at', isoOf(asOfMs + POST_CREATED_WINDOW_MS))
  if (createdError) throw new Error(`generated_posts: ${createdError.message}`)

  const { data: byPublished, error: publishedError } = await supabase
    .from('generated_posts')
    .select(POST_COLUMNS)
    .eq('status', 'published')
    .gt('published_at', isoOf(asOfMs))
    .lte('published_at', isoOf(asOfMs + MATCH_WINDOW_MS))
  if (publishedError) throw new Error(`generated_posts: ${publishedError.message}`)

  const postById = new Map<string, MatchPost>()
  for (const post of [...(byCreated ?? []), ...(byPublished ?? [])] as MatchPost[]) {
    if (!postById.has(post.id)) postById.set(post.id, post)
  }
  return { jobs, posts: [...postById.values()] }
}

// ── Outcomes ──────────────────────────────────────────────────────────────

export interface PublishedUnitRow { id: string; position: number; heading: string; bundle_type: string | null; member_ids: string[]; embedding: number[] | null }
export interface OutcomePatch { unit_key: string; outcome: UnitOutcome; final_role: string | null; final_rank: number | null; matched_post_id: string | null; matched_heading: string | null; similarity: number | null }

interface UnitHit { target: PublishedUnitRow; similarity: number; byId: boolean }

/** Plan-Reihenfolge: recommended → bench → held, je Tier nach Rang; Zeilen ohne Tier (added) zuletzt. */
function inPlanOrder(units: UnitRow[]): UnitRow[] {
  const tierOf = (u: UnitRow) => (u.tier ? TIER_ORDER[u.tier] : NO_TIER_ORDER)
  const rankOf = (u: UnitRow) => u.rank ?? Number.MAX_SAFE_INTEGER
  return [...units].sort((a, b) => tierOf(a) - tierOf(b) || rankOf(a) - rankOf(b))
}

/**
 * Cosine nur für beidseitig nicht-leere, gleich lange Vektoren; sonst oder bei
 * NaN → null. Derselbe Rumpf wie safeCosine in precedents.ts (dort privat,
 * Phase-0-Modul bleibt unverändert): cosineSimilarity wirft bei ungleicher
 * Länge und liefert NaN beim Null-Vektor.
 */
function safeCosine(a: number[] | null, b: number[] | null): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null
  const s = cosineSimilarity(a, b)
  return Number.isFinite(s) ? s : null
}

/** Similarity einer Plan-Einheit zu einem Abschnitt: Maximum über ihre Member; null ohne vergleichbaren Vektor. */
function unitSimilarity(unit: UnitRow, target: PublishedUnitRow, itemEmbeddings: Map<string, number[]>): number | null {
  let best: number | null = null
  for (const id of unit.member_ids) {
    const similarity = safeCosine(itemEmbeddings.get(id) ?? null, target.embedding)
    if (similarity === null) continue
    if (best === null || similarity > best) best = similarity
  }
  return best
}

interface SimilarityPair { unit: UnitRow; order: number; target: PublishedUnitRow; similarity: number }

/**
 * Alle Paare (offene Plan-Einheit, offener Abschnitt) ab der Schwelle,
 * absteigend nach Similarity; Gleichstand → frühere Plan-Einheit, dann
 * kleinere Position (Ruling R13). `units` kommt in Plan-Reihenfolge. WARUM
 * die Positionsregel explizit: wie excludedByUnattributable in
 * precedents.ts — ohne sie entschiede die Eingabereihenfolge der Abschnitte.
 */
function similarityPairs(
  units: UnitRow[],
  targets: PublishedUnitRow[],
  itemEmbeddings: Map<string, number[]>,
  threshold: number,
): SimilarityPair[] {
  const pairs: SimilarityPair[] = []
  units.forEach((unit, order) => {
    for (const target of targets) {
      const similarity = unitSimilarity(unit, target, itemEmbeddings)
      if (similarity !== null && similarity >= threshold) pairs.push({ unit, order, target, similarity })
    }
  })
  pairs.sort((a, b) => (b.similarity - a.similarity) || (a.order - b.order) || (a.target.position - b.target.position))
  return pairs
}

function roundSimilarity(similarity: number): number {
  return Number(similarity.toFixed(3))
}

function outcomeOf(unit: UnitRow, hit: UnitHit | null, selectedIds: Set<string>, postId: string): OutcomePatch {
  if (!hit) {
    // WARUM alle selected_items und nicht nur Hand-Items (Ruling R14): die
    // Spec („Rekonziliation") definiert dropped_after_selection wörtlich als
    // „Plan-Einheit ∩ selected_items des Tages-Jobs". Die Phase-0-Einschränkung
    // auf Hand-Items (precedents.ts, Falle 2: unberührte Techmeme-Themen sind
    // „nie gewählt") gilt hier bewusst nicht — auch automatisch selektierte
    // Techmeme-Items zählen als gestrichen, cut_rate ist damit konservativ
    // (eher zu hoch als zu niedrig).
    const selected = unit.member_ids.some((id) => selectedIds.has(id))
    return {
      unit_key: unit.unit_key,
      outcome: selected ? 'dropped_after_selection' : 'dropped_never_selected',
      final_role: null, final_rank: null, matched_post_id: null, matched_heading: null, similarity: null,
    }
  }
  const sameRole = unit.role === hit.target.bundle_type
  const outcome: UnitOutcome = !hit.byId ? 'merged' : sameRole ? 'kept' : 'relabeled'
  return {
    unit_key: unit.unit_key,
    outcome,
    final_role: hit.target.bundle_type,
    final_rank: hit.target.position + 1,
    matched_post_id: postId,
    matched_heading: hit.target.heading,
    similarity: roundSimilarity(hit.similarity),
  }
}

/**
 * Outcome je Plan-Einheit gegen die veröffentlichten Abschnitte.
 *
 * Exklusiv (Ruling R13): jeder Abschnitt gehört höchstens EINER
 * Plan-Einheit, jede Plan-Einheit hat höchstens einen Treffer.
 * Pass 1 (ID): Plan-Einheiten in Rangfolge recommended → bench → held, je
 * Einheit der früheste noch freie Abschnitt mit gemeinsamem Member.
 * Pass 2 (Similarity): nur Einheiten und Abschnitte ohne Treffer, Maximum
 * über die Member, Schwelle 0,8; höchste Similarity zuerst vergeben,
 * Gleichstand → frühere Plan-Einheit.
 * WARUM exklusiv: Dubletten im Plan sollen Precision und Recall bestrafen,
 * nicht doppelt zählen — dieselbe Absicht wie die Hard-Regel story_duplicate
 * (critic.ts) und das Gate-Kriterium „Dubletten-Rate der Setzliste = 0"
 * (Spec „Entscheidungsregel"). Bewusster Preis: eine zweite Plan-Einheit,
 * deren Item im Post steht, erscheint als dropped_*.
 * WARUM `merged` nur hier entsteht: ein Live-Event dafür gibt es nicht, die
 * Edit-Seite hat keine Zusammenlegen-Funktion (Spec „Tägliche Korrektur") —
 * der Betreiber löscht einen Abschnitt und redigiert den anderen. Dieselbe
 * Regel wie in curation_precedents (Schwelle DEFAULT_DEDUP_THRESHOLD).
 */
export function reconcileOutcomes(
  units: UnitRow[],
  published: PublishedUnitRow[],
  itemEmbeddings: Map<string, number[]>,
  selectedIds: Set<string>,
  postId: string,
  threshold: number = DEFAULT_DEDUP_THRESHOLD,
): { outcomes: OutcomePatch[]; added: PublishedUnitRow[]; matched: Map<string, string> } {
  const ordered = inPlanOrder(units)
  const byPosition = [...published].sort((a, b) => a.position - b.position)
  const hitOf = new Map<string, UnitHit>()
  const taken = new Set<string>()

  for (const unit of ordered) {
    const members = new Set(unit.member_ids)
    const target = byPosition.find((p) => !taken.has(p.id) && p.member_ids.some((id) => members.has(id)))
    if (!target) continue
    hitOf.set(unit.unit_key, { target, similarity: 1, byId: true })
    taken.add(target.id)
  }

  const openUnits = ordered.filter((u) => !hitOf.has(u.unit_key))
  const openPublished = byPosition.filter((p) => !taken.has(p.id))
  for (const pair of similarityPairs(openUnits, openPublished, itemEmbeddings, threshold)) {
    if (hitOf.has(pair.unit.unit_key) || taken.has(pair.target.id)) continue
    hitOf.set(pair.unit.unit_key, { target: pair.target, similarity: pair.similarity, byId: false })
    taken.add(pair.target.id)
  }

  const outcomes = ordered.map((unit) => outcomeOf(unit, hitOf.get(unit.unit_key) ?? null, selectedIds, postId))
  const added = byPosition.filter((p) => !taken.has(p.id))
  const matched = new Map([...hitOf].map(([key, hit]) => [key, hit.target.id] as [string, string]))
  return { outcomes, added, matched }
}

// ── Metriken ──────────────────────────────────────────────────────────────

/** Division durch 0 → 0 (Anhang A §3.10): ein Tag ohne Setzliste oder ohne Abschnitte hat keinen Anteil. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/** Story-Schlüssel einer ID; ohne Eintrag ist die ID selbst der Schlüssel (Konvention baseline-metrics.ts). */
function storyKeyOf(id: string, storyOf: Map<string, string>): string {
  return storyOf.get(id) ?? id
}

/** Item-Vektor und Abschnitts-Embedding liegen ab der Merge-Schwelle beieinander (beide vorhanden, gleich lang). */
function isSimilar(itemVector: number[] | null, unitEmbedding: number[] | null): boolean {
  const similarity = safeCosine(itemVector, unitEmbedding)
  return similarity !== null && similarity >= DEFAULT_DEDUP_THRESHOLD
}

/**
 * IDs der Abschnitte, die eine Liste trifft (Ruling R16), für Plan und
 * Baseline nach derselben Regel. Ein Listen-Item trifft, wenn es (a) Member
 * des Abschnitts ist, (b) im selben Story-Cluster liegt wie eines seiner
 * Member — (a) steckt darin, gleiche ID heißt gleicher Schlüssel — oder (c)
 * per Similarity ≥ 0,8 zum Abschnitts-Embedding passt.
 * WARUM (c) für beide Listen: Abschnitte ohne Marker oder mit Membern
 * außerhalb des Pools erreichte vorher nur der Plan, über merged-Outcomes.
 * Bei 9 Abschnitten wiegt ein solcher Treffer 0,11, mehr als die
 * Gate-Schwelle +0,10 (Review Task 11, I3) — eine einseitige Regel hätte
 * recall_gain allein entschieden.
 */
function publishedHitsOf(
  ids: string[],
  published: PublishedUnitRow[],
  itemEmbeddings: Map<string, number[]>,
  storyOf: Map<string, string>,
): Set<string> {
  const listKeys = new Set(ids.map((id) => storyKeyOf(id, storyOf)))
  const vectors = ids.map((id) => itemEmbeddings.get(id) ?? null)
  const hits = new Set<string>()
  for (const p of published) {
    const storyHit = p.member_ids.some((id) => listKeys.has(storyKeyOf(id, storyOf)))
    if (storyHit || vectors.some((vector) => isSimilar(vector, p.embedding))) hits.add(p.id)
  }
  return hits
}

/** Strenge ID-Variante: nur Kriterium (a) — Abschnitte mit einem Member aus der Liste. */
function publishedIdHitsOf(ids: string[], published: PublishedUnitRow[]): Set<string> {
  const idSet = new Set(ids)
  return new Set(published.filter((p) => p.member_ids.some((id) => idSet.has(id))).map((p) => p.id))
}

/**
 * Dubletten-Rate der Setzliste (Ruling R17): Anteil der recommended-Einheiten
 * (Rang aufsteigend), die mit einer FRÜHEREN eine Member-ID teilen oder
 * denselben Story-Schlüssel des ersten Members haben.
 * WARUM nicht unitDuplicateRate: dort gehört jede ID nur ihrer ersten
 * Einheit — eine spätere Einheit, deren Member schon vergeben sind,
 * verschwindet aus der Rechnung. validatePlan dedupliziert IDs nur innerhalb
 * einer Einheit, topic::a {a, b} und deep_dive::a {a} bleiben beide in der
 * Setzliste, und das Gate duplicates_zero stand trotzdem auf true (Review
 * Task 11, I1).
 */
function duplicateRateOf(recommended: UnitRow[], storyOf: Map<string, string>): number {
  const seenIds = new Set<string>()
  const seenStories = new Set<string>()
  let duplicates = 0
  for (const u of recommended) {
    const lead = u.member_ids[0]
    const story = lead === undefined ? null : storyKeyOf(lead, storyOf)
    const sharesId = u.member_ids.some((id) => seenIds.has(id))
    const sharesStory = story !== null && seenStories.has(story)
    if (sharesId || sharesStory) duplicates++
    for (const id of u.member_ids) seenIds.add(id)
    if (story !== null) seenStories.add(story)
  }
  return ratio(duplicates, recommended.length)
}

/**
 * Eine Plan-Einheit hat überlebt: Outcome kept/relabeled/merged. WARUM nur
 * das Outcome und keine Story-Überschneidung (Ruling R13): eine Dublette zu
 * einem schon vergebenen Abschnitt teilt dessen Story — über die Story zählte
 * sie als überlebt und die Precision bestrafte sie nicht.
 */
function isUnitHit(unit: UnitRow, outcomeByKey: Map<string, OutcomePatch>): boolean {
  const outcome = outcomeByKey.get(unit.unit_key)?.outcome
  return outcome !== undefined && HIT_OUTCOMES.has(outcome)
}

function zeroOutcomes(): Record<UnitOutcome, number> {
  return { kept: 0, relabeled: 0, merged: 0, dropped_after_selection: 0, dropped_never_selected: 0, added: 0 }
}

/** Metriken eines Tages ohne attribuierten Post — „Nullwerte" (Anhang A §3.10), Baseline-Felder null. */
function emptyMetrics(attribution: RunMetrics['attribution']): RunMetrics {
  return {
    attribution,
    published_units: 0,
    published_attributable: 0,
    plan: { recommended: 0, bench: 0, held: 0 },
    unit_recall_20: 0,
    unit_recall_id_20: 0,
    setzlisten_recall_10: 0,
    setzlisten_precision_10: 0,
    duplicate_rate_recommended: 0,
    published_covered: 0,
    unit_recall_covered_20: 0,
    setzlisten_recall_covered_10: 0,
    cut_rate: 0,
    additions: 0,
    additions_rate: 0,
    hand_stories: 0,
    held_rate: 0,
    baseline_total_score_unit_recall_20: null,
    baseline_total_score_recall_10: null,
    diff_vs_total_score_20: null,
    outcomes: zeroOutcomes(),
  }
}

/**
 * total_score-Baseline des Runs je K, auf K Einheiten gekappt. WARUM
 * neutralizeHandLabels vor unitKeyOf: run.ts schneidet die Liste mit
 * totalScoreListsByK, also capByUnits über neutralisierte Labels
 * (totalScoreCandidates). Mit den Betreiber-Labels des Snapshots gruppiert,
 * fielen die Einheitengrenzen anders als beim Schnitt, und K = 10 deckte
 * andere IDs ab als die Gate-Referenz.
 */
function baselineListsOf(baseline: BaselineLists | null, snapshot: PoolSnapshot): Record<string, string[]> | null {
  if (!baseline) return null
  const itemById = new Map(neutralizeHandLabels(snapshot.items).map((item) => [item.id, item]))
  const unitOf = (id: string) => unitKeyOf(id, itemById.get(id)?.bundle_type ?? null, itemById.get(id)?.metadata ?? null)
  return unitListsByK(baseline.total_score['20'] ?? [], unitOf, BASELINE_KS)
}

/**
 * Metriken eines Tages (Spec „Metriken je Tag", RunMetrics in types.ts).
 * `cluster` bleibt bewusst ungenutzt: die Story-Schlüssel des Runs (Hand
 * zuerst, Techmeme vorgeclustert) gibt es für die Baseline nicht — mit ihnen
 * träfe der Plan in einer anderen Währung als total_score. storyOf entsteht
 * deshalb für alle drei Listen aus derselben assignStoryKeys-Clusterung.
 * Recall misst die Abdeckung des Posts, für Plan und Baseline in derselben
 * Währung (publishedHitsOf, R16) und beide auf Einheiten gekappt (R18);
 * Precision misst das Überleben je Setzlisten-Einheit nach der exklusiven
 * Zuordnung aus reconcileOutcomes (R13).
 */
export function metricsOf(input: {
  units: UnitRow[]
  outcomes: OutcomePatch[]
  published: PublishedUnitRow[]
  added: PublishedUnitRow[]
  baseline: BaselineLists | null
  snapshot: PoolSnapshot
  cluster: ClusterResult
  itemEmbeddings: Map<string, number[]>
  attribution: RunMetrics['attribution']
}): RunMetrics {
  const { units, outcomes, published, added, baseline, snapshot, itemEmbeddings, attribution } = input
  const outcomeByKey = new Map(outcomes.map((o) => [o.unit_key, o]))
  const ordered = inPlanOrder(units)
  const recommended = ordered.filter((u) => u.tier === 'recommended')
  const bench = ordered.filter((u) => u.tier === 'bench')
  const held = ordered.filter((u) => u.tier === 'held')
  const setzliste = recommended.filter((u) => u.rank !== null && u.rank >= 1 && u.rank <= SETZLISTE_K)
  // WARUM die Kappung auf 20 Einheiten (Ruling R18): die Baseline geht mit
  // genau 20 Einheiten ein, der Plan ist aber nicht begrenzt — validatePlan
  // kappt die Länge nicht, total_max ist nur ein Kritiker-Code, und die
  // unit_key-Korrektur schiebt Einheiten zusätzlich in die Bank (Review
  // Task 11, I2). Ein längerer Plan bekäme sonst einen Recall-Vorsprung.
  const planList20 = [...recommended, ...bench].slice(0, PLAN_K).flatMap((u) => u.member_ids)
  const setzlisteList10 = setzliste.flatMap((u) => u.member_ids)
  const baselineLists = baselineListsOf(baseline, snapshot)

  const allIds = [
    ...ordered.flatMap((u) => u.member_ids),
    ...published.flatMap((p) => p.member_ids),
    ...(baseline?.total_score['20'] ?? []),
  ]
  const storyOf = assignStoryKeys(allIds, itemEmbeddings, DEFAULT_DEDUP_THRESHOLD)
  const recallOf = (ids: string[]) => ratio(publishedHitsOf(ids, published, itemEmbeddings, storyOf).size, published.length)
  // Pool-normiert (Gate-Boden, Betreiber 2026-10-15): abgedeckt ist ein
  // Abschnitt mit mindestens einem Member im Pool-Snapshot — dieselbe
  // Definition wie coverage.units_covered der Phase-0-Baseline. Zähler und
  // Nenner beschränkt; ein Similarity-Treffer auf einen nicht abgedeckten
  // Abschnitt zählt hier nicht.
  const poolIds = new Set(snapshot.items.map((item) => item.id))
  const coveredIds = new Set(published.filter((p) => p.member_ids.some((id) => poolIds.has(id))).map((p) => p.id))
  const coveredRecallOf = (ids: string[]) => {
    const hits = publishedHitsOf(ids, published, itemEmbeddings, storyOf)
    return ratio([...hits].filter((id) => coveredIds.has(id)).length, coveredIds.size)
  }

  const recall20 = recallOf(planList20)
  const recallId20 = ratio(publishedIdHitsOf(planList20, published).size, published.length)
  const setzlisteRecall10 = recallOf(setzlisteList10)
  const baselineRecall20 = baselineLists ? recallOf(baselineLists['20'] ?? []) : null
  const baselineRecall10 = baselineLists ? recallOf(baselineLists['10'] ?? []) : null
  const setzlisteHits = setzliste.filter((u) => isUnitHit(u, outcomeByKey)).length
  const setzlistePrecision10 = ratio(setzlisteHits, Math.min(SETZLISTE_K, recommended.length))

  const cut = recommended.filter((u) => outcomeByKey.get(u.unit_key)?.outcome === 'dropped_after_selection').length
  const handStories = ordered.filter((u) => u.is_hand).length
  // held_rate: nur Hand-Einheiten in held — eine Nicht-Hand-Einheit in held
  // meldet der Kritiker (held_not_hand), korrigiert sie aber nicht; mit ihr
  // läge die Quote über 1 (Review Task 11, M3).
  const heldHand = held.filter((u) => u.is_hand).length

  const outcomeCounts = zeroOutcomes()
  for (const o of outcomes) outcomeCounts[o.outcome]++
  outcomeCounts.added += added.length

  return {
    attribution,
    published_units: published.length,
    published_attributable: published.filter((p) => p.member_ids.length > 0 || (p.embedding?.length ?? 0) > 0).length,
    plan: { recommended: recommended.length, bench: bench.length, held: held.length },
    unit_recall_20: recall20,
    unit_recall_id_20: recallId20,
    setzlisten_recall_10: setzlisteRecall10,
    setzlisten_precision_10: setzlistePrecision10,
    duplicate_rate_recommended: duplicateRateOf(recommended, storyOf),
    published_covered: coveredIds.size,
    unit_recall_covered_20: coveredRecallOf(planList20),
    setzlisten_recall_covered_10: coveredRecallOf(setzlisteList10),
    cut_rate: ratio(cut, recommended.length),
    additions: added.length,
    additions_rate: ratio(added.length, published.length),
    hand_stories: handStories,
    held_rate: ratio(heldHand, handStories),
    baseline_total_score_unit_recall_20: baselineRecall20,
    baseline_total_score_recall_10: baselineRecall10,
    diff_vs_total_score_20: baselineRecall20 === null ? null : recall20 - baselineRecall20,
    outcomes: outcomeCounts,
  }
}

// ── Lader und Orchestrierung ──────────────────────────────────────────────

async function loadPost(supabase: SupabaseAdmin, postId: string): Promise<PostRow> {
  const { data, error } = await supabase
    .from('generated_posts')
    .select('id, content, published_at')
    .eq('id', postId)
    .maybeSingle()
  if (error) throw new Error(`generated_posts: ${error.message}`)
  if (!data) throw new Error(`generated_posts: Post ${postId} fehlt`)
  return data as PostRow
}

/**
 * published_units des Posts neu schreiben, bevor abgeglichen wird.
 * WARUM: beim Publish schreibt kein Hook published_units (Betreiber-
 * Entscheidung 2026-10-14 Nr. 2 im Plan) — ein neuer Post hat dort noch gar
 * keine Zeilen, ein redigierter einen veralteten Stand; ohne diesen Schritt
 * veraltete auch der Archivbrief nach dem ersten Tag. processPost ist
 * idempotent je post_id (delete + insert).
 * embed_failed wirft: der alte Stand bliebe stehen (oft: keiner), und ein
 * Abgleich dagegen schriebe lauter dropped-Outcomes und reconciled_at — der
 * nächste Tick soll es erneut versuchen. broken (content kein JSON) wirft
 * NICHT: das heilt kein Retry, und getRunsToReconcile (limit 1, asof
 * aufsteigend) bliebe dauerhaft an diesem Run hängen; abgeglichen wird gegen
 * den gespeicherten Stand.
 */
async function refreshPublishedUnits(supabase: SupabaseAdmin, embed: EmbedTexts, post: PostRow): Promise<void> {
  const outcome = await processPost(supabase, embed, post, false)
  if (outcome.kind === 'embed_failed') {
    throw new Error(`published_units (${post.id}): Embedding fehlgeschlagen — ${outcome.error}`)
  }
  if (outcome.kind === 'broken') {
    console.warn(`[Curation] Post ${post.id}: content nicht parsebar — Abgleich gegen den gespeicherten published_units-Stand`)
  }
}

async function loadPublishedUnits(supabase: SupabaseAdmin, postId: string): Promise<PublishedUnitRow[]> {
  const { data, error } = await supabase
    .from('published_units')
    .select('id, position, heading, bundle_type, member_ids, embedding')
    .eq('post_id', postId)
    .order('position')
  if (error) throw new Error(`published_units: ${error.message}`)
  const rows = (data ?? []) as Array<Omit<PublishedUnitRow, 'embedding' | 'member_ids'> & { member_ids: string[] | null; embedding: unknown }>
  return rows.map((row) => {
    const embedding = parseEmbedding(row.embedding)
    return { ...row, member_ids: row.member_ids ?? [], embedding: embedding.length > 0 ? embedding : null }
  })
}

/** IDs aus selected_items des attribuierten Jobs; ohne Job (Attribution über den Post) leer. */
async function loadSelectedIds(supabase: SupabaseAdmin, jobId: string | null): Promise<Set<string>> {
  if (!jobId) return new Set()
  const { data, error } = await supabase
    .from('article_jobs')
    .select('selected_items')
    .eq('id', jobId)
    .maybeSingle()
  if (error) throw new Error(`article_jobs: ${error.message}`)
  const raw = (data as { selected_items?: unknown } | null)?.selected_items
  return new Set(precedentSelectedItems(raw).map((item) => item.id))
}

/**
 * curation_units.role hat einen CHECK auf die vier Rollen
 * (20261014090000_curation_phase1.sql:54), published_units.bundle_type ist
 * frei (Phase-0-Migration: „'story' kommt erst in Phase 2"). Ein fremdes
 * Label ließe den Insert dauerhaft scheitern — role wird dann null,
 * final_role behält das Label.
 */
function roleOf(bundleType: string | null): CurationRole | null {
  return CURATION_ROLES.includes(bundleType as CurationRole) ? (bundleType as CurationRole) : null
}

function addedUnitOf(p: PublishedUnitRow, postId: string): UnitInsert {
  return {
    unit_key: `added::${postId}::${p.position}`,
    member_ids: p.member_ids,
    story_key: null,
    role: roleOf(p.bundle_type),
    rank: null,
    tier: null,
    reason: null,
    alternative: null,
    precedent_ids: [],
    is_hand: false,
    panel_action: null,
    panel_at: null,
    outcome: 'added',
    final_role: p.bundle_type,
    final_rank: p.position + 1,
    matched_post_id: postId,
    matched_heading: p.heading,
    similarity: null,
  }
}

/**
 * Einen fertigen Run abgleichen: Attribution, published_units nachpflegen,
 * Outcomes und added schreiben, Metriken am Run. Ohne Post: nur
 * markReconciled mit attribution 'none' — KEINE Outcomes, damit der Tag in
 * keiner Aggregation als Recall 0 zählt (Plan, Review Focus 4).
 */
export async function reconcileRun(
  supabase: SupabaseAdmin,
  run: RunRow,
  embed: EmbedTexts,
): Promise<{ matched: MatchResult | null; metrics: RunMetrics }> {
  const candidates = await loadMatchCandidates(supabase, run.asof)
  const matched = pickMatchingPost(run.asof, candidates)
  if (!matched) {
    const metrics = emptyMetrics('none')
    await markReconciled(supabase, run.id, { matched_post_id: null, matched_job_id: null, metrics })
    console.log(`[Curation] Rekonziliation ${run.day}: kein Post — attribution none`)
    return { matched: null, metrics }
  }
  if (!run.pool) throw new Error(`curation_runs: Run ${run.id} ohne Pool-Snapshot`)

  const post = await loadPost(supabase, matched.post_id)
  await refreshPublishedUnits(supabase, embed, post)
  const published = await loadPublishedUnits(supabase, matched.post_id)
  const selectedIds = await loadSelectedIds(supabase, matched.job_id)

  // WARUM Zeilen ohne Tier herausfallen: das sind added-Zeilen eines früheren
  // Versuchs, der nach updateUnitOutcomes und vor markReconciled abbrach.
  // Wegen unique (run_id, unit_key) (20261014090000_curation_phase1.sql:71)
  // schlüge ihr erneuter Insert fehl, und der Run hinge in
  // getRunsToReconcile fest.
  const runUnits = await getRunUnits(supabase, run.id)
  const units = runUnits.filter((u) => u.tier !== null)
  const existingAdded = new Set(runUnits.filter((u) => u.tier === null).map((u) => u.unit_key))

  const { embeddings } = await loadPoolEmbeddings(supabase, run.pool.items, embed)
  const { outcomes, added } = reconcileOutcomes(units, published, embeddings, selectedIds, matched.post_id)
  const addedRows = added.map((p) => addedUnitOf(p, matched.post_id)).filter((row) => !existingAdded.has(row.unit_key))
  await updateUnitOutcomes(supabase, run.id, outcomes, addedRows)

  const metrics = metricsOf({
    units,
    outcomes,
    published,
    added,
    baseline: run.baseline,
    snapshot: run.pool,
    cluster: run.story_keys ?? { storyKeyOf: {}, clusters: {}, related: [] },
    itemEmbeddings: embeddings,
    attribution: matched.attribution,
  })
  await markReconciled(supabase, run.id, { matched_post_id: matched.post_id, matched_job_id: matched.job_id, metrics })
  console.log(
    `[Curation] Rekonziliation ${run.day}: Post ${matched.post_id} (${matched.attribution}) · UnitRecall@20 ${metrics.unit_recall_20.toFixed(2)} · ${added.length} Zugaben`,
  )
  return { matched, metrics }
}

// ── Aggregation und Gate ──────────────────────────────────────────────────

const MEAN_FIELDS = [
  'unit_recall_20', 'setzlisten_recall_10', 'setzlisten_precision_10', 'duplicate_rate_recommended',
  'unit_recall_covered_20', 'setzlisten_recall_covered_10',
  'cut_rate', 'additions_rate', 'held_rate', 'baseline_total_score_unit_recall_20',
] as const
type MeanField = typeof MEAN_FIELDS[number]

export interface AggregateReport {
  n: number
  mean: Record<MeanField, number>
  diff_vs_total_score_20: { n: number; mean: number; bootstrap_90: { mean: number; lo90: number; hi90: number } }
  gate: {
    recall_gain: boolean | null
    floor: boolean
    duplicates_zero: boolean
    precision_vs_hand: boolean | null
    /** Spec „Abbruch": ab 20 Tagesdifferenzen true, wenn das Mittel unter total_score liegt; davor null. */
    abort: boolean | null
    /** Gate-Entscheidung erst ab 30 Tagesdifferenzen (MDE80 n30 = 0,106); davor sind recall_gain/floor nur Zwischenstand. */
    decision_ready: boolean
  }
}

/**
 * Mittel über die attribuierten Tage und die vier Gate-Regeln (Spec
 * „Entscheidungsregel"). Tage mit attribution 'none' fallen heraus — sie
 * haben keinen Post, ein Recall 0 dort wäre eine erfundene Messung. Ebenso
 * Tage mit published_units = 0 (kaputter content ohne gespeicherten Stand,
 * Tag-Fallback auf einen Post ohne H2-Abschnitte): Recall 0 und diff 0
 * verwässerten n, den Boden und den Bootstrap (Review Task 11, M1).
 * Mittel ohne Daten → NaN (meanFinite, Konvention baseline-metrics.ts: eine 0
 * sähe wie „Effekt 0, sicher" aus); jede Gate-Regel ist dann false.
 * recall_gain zählt die Tagesdifferenzen (Tage mit Baseline), nicht alle Tage.
 */
export function aggregateRuns(metricsList: ReadonlyArray<RunMetrics | null>, handPrecisionRef: number | null): AggregateReport {
  // metrics null: der Abgleich ist nach drei Fehlversuchen aufgegeben worden
  // (Final-Review 2026-10-14 (R22)) — es gibt keine Messung, also auch keinen Tag.
  const measured = metricsList.filter((m): m is RunMetrics => m !== null)
  const days = measured.filter((m) => m.attribution !== 'none' && m.published_units > 0)

  const mean = {} as Record<MeanField, number>
  for (const field of MEAN_FIELDS) mean[field] = meanFinite(days.map((d) => d[field]))

  const diffs = days
    .map((d) => d.diff_vs_total_score_20)
    .filter((d): d is number => d !== null && Number.isFinite(d))
  const bootstrap_90 = pairedBootstrap(diffs)
  const diff = { n: diffs.length, mean: bootstrap_90.mean, bootstrap_90 }

  const recallGain = diff.n >= GATE_MIN_DAYS ? diff.mean >= GATE_RECALL_GAIN && bootstrap_90.lo90 > 0 : null
  const floor = mean.unit_recall_covered_20 >= GATE_FLOOR_UNIT_RECALL_COVERED_20
    && mean.setzlisten_recall_covered_10 >= GATE_FLOOR_SETZLISTE_RECALL_COVERED_10
  const duplicatesZero = mean.duplicate_rate_recommended === 0
  const precisionVsHand = handPrecisionRef == null ? null : mean.setzlisten_precision_10 >= handPrecisionRef
  const abort = diff.n >= GATE_ABORT_DAYS ? diff.mean < 0 : null
  const decisionReady = diff.n >= GATE_DECISION_DAYS

  return {
    n: days.length,
    mean,
    diff_vs_total_score_20: diff,
    gate: {
      recall_gain: recallGain, floor, duplicates_zero: duplicatesZero, precision_vs_hand: precisionVsHand,
      abort, decision_ready: decisionReady,
    },
  }
}
