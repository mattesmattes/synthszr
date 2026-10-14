/**
 * Phasenmaschine der Morgenkonferenz (Task 10, Anhang A §3.9): verdrahtet
 * Pool (Task 4), Scout (Task 6), Cluster (Task 5), Archiv (Task 7),
 * Chefredaktion (Task 8) und Kritiker (Task 9) zu einem Lauf. Der
 * Minuten-Cron treibt ihn tickweise (advanceRun, Task 12), das
 * Backtest-Script in einem Rutsch (runDayInline, Task 14).
 *
 * WARUM jede Phase ihr Ergebnis als Spalte auf dem Run ablegt (pool, cards,
 * story_keys, brief, baseline, plan, critique): ein Tick hat 600 s bei
 * maxDuration 800 s, und die Chefredaktion allein braucht bis zu sieben
 * Minuten. Eine Phase muss deshalb in einem späteren Tick weiterlaufen
 * können, ohne die vorigen zu wiederholen — der Run ist der Zwischenspeicher.
 *
 * Kosten-Bremse (Global Constraints): vor JEDEM Modellaufruf reserveBudget
 * mit estimateUsd; reicht das Budget nicht, entfällt der Aufruf und die Phase
 * degradiert ('budget' bzw. 'critic'), statt den Lauf abzubrechen.
 */
import { estimateUsd, type CallToolFn } from '@/lib/ai/call'
import { totalScoreListsByK } from '@/lib/curation/baseline-day'
import { buildArchiveBrief, type ArchiveCandidate } from '@/lib/curation/archive'
import { clusterPool, leaderOf } from '@/lib/curation/cluster'
import { baselinePlan, buildComposeMessages, composeDay, type ComposeInput } from '@/lib/curation/compose'
import { checkHardRules, checkSoftRules, critiqueWithModel, revisionHints } from '@/lib/curation/critic'
import { loadPoolAsOf, loadPoolEmbeddings } from '@/lib/curation/pool'
import { batchesOf, fallbackCard, loadCachedCards, saveCards, scoutBatch } from '@/lib/curation/scout'
import { appendRunLog, finishRun, getRun, insertUnits, saveRunState, stamp } from '@/lib/curation/service'
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import type { EmbedTexts } from '@/scripts/lib/published-units-backfill'
import type {
  ArchiveBrief, ClusterResult, ComposePlan, CurationSettings, Critique, Degradation, PoolSnapshot,
  PoolSnapshotItem, RunPhase, RunRow, UnitInsert,
} from '@/lib/curation/types'

export interface RunDeps {
  supabase: SupabaseAdmin
  callTool: CallToolFn
  embed: EmbedTexts
  settings: CurationSettings
  models: { scout: string; editor: string; critic: string }
  now?: () => number
  budgetMs?: number
  log?: (text: string) => void
}

/** Arbeitszeit je Cron-Tick. maxDuration der Route ist 800 s (Task 12) — 200 s bleiben für Protokoll und Antwort. */
export const TICK_BUDGET_MS = 600_000

/**
 * Restzeit, ab der ein Tick die Chefredaktion noch startet. WARUM 420 s: ein
 * compose_day-Aufruf mit 24 000 Output-Tokens und Thinking dauert 5–7 Minuten
 * (Controller-Vorgabe Task 10, 2026-10-14; Plan 2026-10-14, Review Focus 5:
 * Timeout mitten in Compose). Startet er mit weniger Rest, beendet das
 * Function-Timeout den Tick mitten im Call — bezahlt, aber ohne Ergebnis, und
 * der Run hängt bis LEASE_STALE_MS. Besser den Tick hier beenden und compose
 * im nächsten Tick mit vollem Budget beginnen.
 */
export const COMPOSE_MIN_REMAINING_MS = 420_000

/**
 * Unter dieser Pool-Größe ist der Tag kein Kuratierungstag (Ingestion-Ausfall,
 * Feiertag) — ein normaler Pool hat 300–900 Items (Plan Task 14). Der Run
 * endet dann als error, ohne einen Modellaufruf zu bezahlen.
 */
export const POOL_MIN_ITEMS = 40

/** Präfix der Fehlermeldung, die advanceRun als regulären Abschluss (error ohne Retry) behandelt. */
const POOL_SMALL = 'pool_small'

/** K-Werte der total_score-Baseline: Setzliste (10) und Setzliste + Bank (20). */
const BASELINE_KS = [10, 20] as const

/**
 * Scout-Batches, die gleichzeitig laufen. Bei 900 Items à 25 je Batch sind
 * das neun Runden statt 36 nacheinander — ohne alle 36 Aufrufe gleichzeitig
 * gegen das Rate-Limit zu schicken.
 */
const SCOUT_PARALLEL = 4

/** Anteil der Items ohne Scout-Card, ab dem der Lauf 'scout_partial' meldet (Vertrag 3.9: „> 10 %"). */
const SCOUT_PARTIAL_SHARE = 0.1

/** maxTokens je Scout-Batch — derselbe Wert wie in scoutBatch (scout.ts). */
const SCOUT_MAX_TOKENS = 4096

/** SCOUT_SYSTEM hat 432 Zeichen (BEFUND 2026-10-14) — aufgerundet, die Schätzung soll eher zu hoch liegen. */
const SCOUT_SYSTEM_CHARS = 500

/** Je Zeile von buildScoutUser zusätzlich zu Titel und Excerpt: ID (36 Zeichen), Quelle, Trenner. */
const SCOUT_LINE_OVERHEAD_CHARS = 80

/** Top-Items nach total_score, deren Story-Anführer der Archivar prüft (Vertrag 3.9). */
const ARCHIVE_TOP_ITEMS = 80

/**
 * Obergrenze der Archiv-Kandidaten (Plan Task 7: „Aufrufer kappt auf ≤ 120").
 * Jeder Kandidat geht mit seinem 768er-Embedding als pgvector-String in die
 * RPC get_precedent_units — 120 Vektoren sind schon rund 1 MB Request.
 */
const ARCHIVE_MAX_CANDIDATES = 120

/** Erstversuch plus genau eine Revision (Vertrag 3.9). */
const MAX_COMPOSE_ATTEMPTS = 2

/** maxTokens der Chefredaktion — derselbe Wert wie in composeDay (compose.ts). */
const COMPOSE_MAX_TOKENS = 24_000

/** maxTokens des Kritikers — derselbe Wert wie in critiqueWithModel (critic.ts). */
const CRITIC_MAX_TOKENS = 4096

/**
 * Fester Teil des Kritiker-Prompts: CRITIC_SYSTEM (Basis 329 + Regeltext 615
 * Zeichen) plus der Regeltext ein zweites Mal im user-Teil, zusammen rund
 * 1 600 Zeichen (BEFUND 2026-10-14) — aufgerundet.
 */
const CRITIC_PROMPT_CHARS = 2_000

type Phase = (deps: RunDeps, run: RunRow) => Promise<Partial<RunRow>>

/** Reicht das Run-Budget für einen weiteren Aufruf mit dieser Schätzung? */
export function reserveBudget(run: RunRow, usd: number): boolean {
  return run.spend_usd + usd <= run.budget_usd
}

/** Plan-Einheiten als curation_units-Zeilen — Ergebnisfelder bleiben null, bis die Rekonziliation (Task 11) sie füllt. */
export function unitsFromPlan(plan: ComposePlan): UnitInsert[] {
  return plan.units.map((u) => ({
    unit_key: u.unit_key,
    member_ids: u.member_ids,
    story_key: u.story_key,
    role: u.role,
    rank: u.rank,
    tier: u.tier,
    reason: u.reason,
    alternative: u.alternative,
    precedent_ids: u.precedent_ids,
    is_hand: u.is_hand,
    panel_action: null,
    panel_at: null,
    outcome: null,
    final_role: null,
    final_rank: null,
    matched_post_id: null,
    matched_heading: null,
    similarity: null,
  }))
}

export async function phasePool(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const pool = await loadPoolAsOf(deps.supabase, {
    asOf: run.asof,
    minContentLength: deps.settings.min_content_length,
    windowHours: deps.settings.pool_window_hours,
  })
  if (pool.items.length < POOL_MIN_ITEMS) throw new Error(`${POOL_SMALL}:${pool.items.length}`)

  // Die Baseline entsteht aus DEMSELBEN Snapshot wie der Plan: sie ist die
  // Vergleichsgröße der Rekonziliation (Task 11) und der Fallback-Plan in
  // phaseCompose — beides wäre gegen einen später gelesenen Pool verzerrt.
  const total_score = totalScoreListsByK(pool.items, BASELINE_KS)
  return { pool, baseline: { total_score }, phase: 'scout' }
}

export async function phaseScout(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const items = need(run.pool, 'pool').items
  const coreById = await loadCachedCards(deps.supabase, items.map((i) => i.id), deps.models.scout)
  const todo = items.filter((i) => !coreById.has(i.id))
  const batches = batchesOf(todo, deps.settings.scout_batch_size)

  let spend = run.spend_usd
  let outOfBudget = false
  for (let i = 0; i < batches.length; i += SCOUT_PARALLEL) {
    const group = batches.slice(i, i + SCOUT_PARALLEL)
    // Reserviert wird je Gruppe, weil ihre Batches gleichzeitig starten —
    // nach dem Start lässt sich keiner mehr zurückhalten.
    const estimate = group.reduce((sum, batch) => sum + scoutEstimateUsd(deps.models.scout, batch), 0)
    if (!reserveBudget({ ...run, spend_usd: spend }, estimate)) {
      outOfBudget = true
      break
    }
    const results = await Promise.all(group.map((batch) => scoutBatch(deps.callTool, batch)))
    for (const result of results) {
      spend += result.costUsd
      for (const card of result.cards) coreById.set(card.id, card.core)
      if (result.cards.length > 0) await saveCards(deps.supabase, result.cards, deps.models.scout)
    }
  }

  // Fehlend ist jedes Item ohne Card — vom Modell ausgelassen, Batch nach
  // CallInvalidError leer, oder nie gescoutet, weil das Budget fehlte. Die
  // Cards stehen in Pool-Reihenfolge, damit der Seed-Shuffle in compose
  // (buildComposeMessages) nicht davon abhängt, welche Cards aus dem Cache kamen.
  const missing = items.filter((i) => !coreById.has(i.id))
  const cards = items.map((i) => {
    const core = coreById.get(i.id)
    return core === undefined ? fallbackCard(i) : { id: i.id, core }
  })

  let degraded = run.degraded
  if (outOfBudget) degraded = withDegradation(degraded, 'budget')
  if (missing.length > items.length * SCOUT_PARTIAL_SHARE) degraded = withDegradation(degraded, 'scout_partial')
  return { cards, spend_usd: spend, degraded, phase: 'cluster' }
}

export async function phaseCluster(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const pool = need(run.pool, 'pool')
  const { embeddings, failed } = await loadPoolEmbeddings(deps.supabase, pool.items, deps.embed)
  const story_keys = clusterPool(pool, embeddings)

  // Einzelne Embedding-Fehler brechen nicht ab (erst drei in Folge,
  // loadPoolEmbeddings) — das Item wird sein eigener Cluster. Dubletten können
  // so durchrutschen; der Betreiber muss das im Panel sehen.
  const degraded = failed > 0 ? withDegradation(run.degraded, 'pool_embeddings') : run.degraded
  return { story_keys, degraded, phase: 'archive' }
}

export async function phaseArchive(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const pool = need(run.pool, 'pool')
  const cluster = need(run.story_keys, 'story_keys')
  const embeddings = await reloadEmbeddings(deps, pool)
  const candidates = archiveCandidates(pool, cluster, embeddings)
  const brief = await buildArchiveBrief(deps.supabase, {
    asOf: run.asof,
    candidates,
    briefMode: run.brief_mode,
    mode: run.mode,
  })

  // Der Brief ist auch mit Lücken brauchbar (jede Quelle einzeln in try/catch,
  // archive.ts) — der Lauf geht weiter, aber die Lücke muss sichtbar sein.
  const degraded = brief.meta.missing.length > 0 ? withDegradation(run.degraded, 'archive') : run.degraded
  return { brief, degraded, phase: 'compose' }
}

export async function phaseCompose(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  const pool = need(run.pool, 'pool')
  const cluster = need(run.story_keys, 'story_keys')
  const cards = need(run.cards, 'cards')
  const baseline = need(run.baseline, 'baseline')
  const brief = run.brief
  const embeddings = await reloadEmbeddings(deps, pool)

  let spend = run.spend_usd
  let attempts = run.compose_attempts
  let degraded = run.degraded
  let outOfBudget = false
  let hints: string[] | undefined
  let previous: ComposePlan | undefined
  let plan: ComposePlan | null = null
  let critique: Critique = { hard: [], soft: [], model_hard: [], model_soft: [] }

  while (attempts < MAX_COMPOSE_ATTEMPTS) {
    const input: ComposeInput = {
      cards,
      snapshot: pool,
      cluster,
      brief,
      seed: composeSeed(run.asof, attempts),
      revisionHints: hints,
      previousPlan: previous,
    }
    const messages = buildComposeMessages(input)
    const inputChars = messages.cachedPrefix.length + messages.system.length + messages.user.length
    const estimate = estimateUsd(deps.models.editor, inputChars, COMPOSE_MAX_TOKENS)
    if (!reserveBudget({ ...run, spend_usd: spend }, estimate)) {
      outOfBudget = true
      break
    }

    // compose_attempts und die Reservierung VOR dem Call persistieren: läuft
    // der Tick mitten im Call ins Function-Timeout, kann danach nichts mehr
    // geschrieben werden. Der nächste Tick muss den Versuch trotzdem zählen
    // (sonst endlose Wiederholung eines Calls, der jedes Mal stirbt) und die
    // Kosten als ausgegeben sehen — die API rechnet den Call auch ohne
    // Antwort ab.
    attempts++
    await saveRunState(deps.supabase, run.id, { compose_attempts: attempts, spend_usd: spend + estimate })
    const composed = await composeDay(deps.callTool, input, brief?.precedentIds ?? {})
    spend += composed.costUsd

    const hard = checkHardRules(composed.plan, pool, cluster, embeddings)
    const soft = checkSoftRules(composed.plan, pool, cluster)
    const second = await critiqueBestEffort(deps, { ...run, spend_usd: spend }, composed.plan, pool, cluster, brief)
    spend += second.costUsd
    if (second.skipped) degraded = withDegradation(degraded, 'critic')
    // 'critic' sagt, WAS fehlt (Vertrag 3.9), 'budget' WARUM — Global
    // Constraints „Kosten-Bremse" und Plan Review Focus 6 verlangen 'budget'
    // bei jeder gescheiterten Reservierung.
    if (second.skipped === 'budget') degraded = withDegradation(degraded, 'budget')
    critique = { hard, soft, model_hard: second.hard, model_soft: second.soft }

    if (hard.length === 0) {
      plan = composed.plan
      break
    }
    // Nur die deterministischen Verstöße lösen eine Revision aus — der
    // Modell-Kritiker ist eine zweite Meinung für den Betreiber (critic.ts).
    hints = revisionHints(hard)
    previous = composed.plan
  }

  // Kein gültiger Modellplan (Budget fehlte oder beide Versuche verletzten
  // harte Regeln): der Tag bekommt trotzdem einen Plan. Die total_score-
  // Baseline ist dasselbe Verfahren, mit dem der Run später verglichen wird —
  // ein Fallback, der den Vergleich nicht verfälscht und keinen Call kostet.
  if (!plan) {
    plan = baselinePlan(pool, cluster, baseline)
    degraded = withDegradation(degraded, outOfBudget ? 'budget' : 'compose_fallback')
  }
  return { plan, critique, spend_usd: spend, compose_attempts: attempts, degraded, phase: 'units' }
}

export async function phaseUnits(deps: RunDeps, run: RunRow): Promise<Partial<RunRow>> {
  await insertUnits(deps.supabase, run.id, unitsFromPlan(need(run.plan, 'plan')))
  return { phase: 'finished' }
}

const PHASES: Record<Exclude<RunPhase, 'finished'>, Phase> = {
  pool: phasePool,
  scout: phaseScout,
  cluster: phaseCluster,
  archive: phaseArchive,
  compose: phaseCompose,
  units: phaseUnits,
}

/**
 * Arbeitet Phasen ab, bis der Run fertig oder das Tick-Budget aufgebraucht
 * ist. Jede Phase wird sofort persistiert, damit ein Timeout im nächsten
 * Schritt nur diesen Schritt kostet. Fehler außer pool_small werden geworfen —
 * die Route zählt attempts und gibt nach MAX_ATTEMPTS auf (Task 12).
 */
export async function advanceRun(deps: RunDeps, run: RunRow): Promise<{ phase: RunPhase; finished: boolean; note: string }> {
  const now = deps.now ?? Date.now
  const budgetMs = deps.budgetMs ?? TICK_BUDGET_MS
  const startedAt = now()
  let current = run

  while (current.phase !== 'finished') {
    const phase = current.phase
    const remainingMs = budgetMs - (now() - startedAt)
    if (remainingMs <= 0) {
      return { phase, finished: false, note: 'Tick-Budget aufgebraucht' }
    }
    if (phase === 'compose' && remainingMs < COMPOSE_MIN_REMAINING_MS) {
      const note = `compose wartet auf den nächsten Tick: ${Math.round(remainingMs / 1000)} s Rest < ${COMPOSE_MIN_REMAINING_MS / 1000} s`
      deps.log?.(`[Curation] ${current.day}: ${note}`)
      return { phase, finished: false, note }
    }

    let patch: Partial<RunRow>
    try {
      patch = await PHASES[phase](deps, current)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.startsWith(POOL_SMALL)) throw err
      await finishRun(deps.supabase, current.id, 'error', message)
      deps.log?.(`[Curation] ${current.day}: ${message}`)
      return { phase, finished: true, note: message }
    }

    current = { ...current, ...patch }
    await saveRunState(deps.supabase, current.id, patch)
    const text = `Phase ${phase} fertig (${current.spend_usd.toFixed(2)} USD)`
    await appendRunLog(deps.supabase, current, [{ at: stamp(), text, ok: true }])
    deps.log?.(`[Curation] ${current.day}: ${text}`)
  }

  await finishRun(deps.supabase, current.id, 'done')
  return { phase: 'finished', finished: true, note: 'done' }
}

/** Ein Lauf in einem Rutsch (Backtest, Shadow-Einzellauf): advanceRun ohne Tick-Budget, bis der Run fertig ist. */
export async function runDayInline(deps: RunDeps, run: RunRow): Promise<RunRow> {
  const inlineDeps: RunDeps = { ...deps, budgetMs: Number.POSITIVE_INFINITY }
  let current = run
  for (;;) {
    const result = await advanceRun(inlineDeps, current)
    if (result.finished) break
    current = await mustGetRun(deps.supabase, run.id)
  }
  return mustGetRun(deps.supabase, run.id)
}

/**
 * Embeddings des Pools erneut laden statt sie auf dem Run zu speichern: 900
 * Items × 768 Floats wären rund 7 MB jsonb in curation_runs, die jedes
 * getRun und saveRunState durch PostgREST schöbe. Der zweite Aufruf liest aus
 * daily_repo und dem Cache curation_item_embeddings, den phaseCluster gefüllt
 * hat — neue Embedding-Calls entstehen nur für Items, die dort schon scheiterten.
 */
async function reloadEmbeddings(deps: RunDeps, pool: PoolSnapshot): Promise<Map<string, number[]>> {
  const { embeddings } = await loadPoolEmbeddings(deps.supabase, pool.items, deps.embed)
  return embeddings
}

/**
 * Archiv-Kandidaten in Rangfolge: Hand-Items, Anführer der Techmeme-Stories,
 * dann die Anführer der Top-80 nach total_score — ohne Dubletten, nur mit
 * Embedding (Coverage und Präzedenzen vergleichen Vektoren). WARUM diese
 * Reihenfolge: die Kappung auf ARCHIVE_MAX_CANDIDATES soll die schwächsten
 * Pipeline-Stories treffen, nie eine Betreiber-Auswahl.
 */
function archiveCandidates(pool: PoolSnapshot, cluster: ClusterResult, embeddings: Map<string, number[]>): ArchiveCandidate[] {
  const itemById = new Map(pool.items.map((item) => [item.id, item]))
  const leaderIdOf = (id: string) => leaderOf(cluster, cluster.storyKeyOf[id] ?? id)
  const techmemeLeaders = pool.techmemeStories.filter((s) => s.member_ids.length > 0).map((s) => leaderIdOf(s.member_ids[0]))
  const topLeaders = [...pool.items]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, ARCHIVE_TOP_ITEMS)
    .map((item) => leaderIdOf(item.id))

  const candidates: ArchiveCandidate[] = []
  const seen = new Set<string>()
  for (const id of [...pool.handIds, ...techmemeLeaders, ...topLeaders]) {
    if (seen.has(id)) continue
    seen.add(id)
    const item = itemById.get(id)
    const embedding = embeddings.get(id)
    if (!item || !embedding || embedding.length === 0) continue
    candidates.push({ id, title: item.title, embedding })
    if (candidates.length >= ARCHIVE_MAX_CANDIDATES) break
  }
  return candidates
}

interface CriticOutcome {
  hard: string[]
  soft: string[]
  costUsd: number
  /** Warum der Kritiker nicht lief — null, wenn er ein Ergebnis geliefert hat. */
  skipped: 'disabled' | 'budget' | 'error' | null
}

/**
 * Modell-Kritiker als zweite Meinung, best effort (critic.ts): ausgeschaltet,
 * ohne Budget oder mit Fehler liefert er ein leeres Ergebnis mit Grund, und
 * der Aufrufer degradiert mit 'critic' — der Plan hängt nie an ihm.
 */
async function critiqueBestEffort(
  deps: RunDeps,
  run: RunRow,
  plan: ComposePlan,
  pool: PoolSnapshot,
  cluster: ClusterResult,
  brief: ArchiveBrief | null,
): Promise<CriticOutcome> {
  const skip = (skipped: CriticOutcome['skipped']): CriticOutcome => ({ hard: [], soft: [], costUsd: 0, skipped })
  if (!deps.settings.critic_enabled) return skip('disabled')
  const estimate = estimateUsd(deps.models.critic, criticInputChars(plan, pool), CRITIC_MAX_TOKENS)
  if (!reserveBudget(run, estimate)) return skip('budget')
  try {
    const result = await critiqueWithModel(deps.callTool, plan, pool, cluster, brief)
    return { ...result, skipped: null }
  } catch (err) {
    deps.log?.(`[Curation] ${run.day}: Kritiker übersprungen — ${err instanceof Error ? err.message : String(err)}`)
    return skip('error')
  }
}

/** Prompt-Größe des Kritikers wie in critiqueWithModel gebaut: Plan als JSON, je Item `[id] title`, fester Teil. */
function criticInputChars(plan: ComposePlan, pool: PoolSnapshot): number {
  const snapshotChars = pool.items.reduce((sum, item) => sum + item.id.length + item.title.length + 4, 0)
  return CRITIC_PROMPT_CHARS + JSON.stringify(plan).length + snapshotChars
}

/** Prompt-Größe eines Scout-Batches wie in buildScoutUser gebaut: je Item Titel, Excerpt und Zeilen-Overhead. */
function scoutEstimateUsd(model: string, batch: PoolSnapshotItem[]): number {
  const chars = batch.reduce((sum, item) => sum + item.title.length + item.excerpt.length + SCOUT_LINE_OVERHEAD_CHARS, SCOUT_SYSTEM_CHARS)
  return estimateUsd(model, chars, SCOUT_MAX_TOKENS)
}

/**
 * Seed für die Card-Reihenfolge in compose: Kickoff-Tag als Zahl plus Versuch.
 * Deterministisch je Tag und Versuch — ein nachgeholter Lauf desselben Tages
 * sieht dieselbe Reihenfolge, die Revision eine andere als der Erstversuch.
 */
function composeSeed(asof: string, attempt: number): number {
  return Number(asof.slice(0, 10).replace(/-/g, '')) + attempt
}

function withDegradation(degraded: Degradation[], reason: Degradation): Degradation[] {
  return degraded.includes(reason) ? degraded : [...degraded, reason]
}

/** Spalte, die eine frühere Phase geschrieben haben muss — fehlt sie, ist der Run inkonsistent (z. B. phase von Hand zurückgesetzt). */
function need<T>(value: T | null, column: string): T {
  if (value === null) throw new Error(`curation_runs: Spalte ${column} fehlt`)
  return value
}

async function mustGetRun(supabase: SupabaseAdmin, id: string): Promise<RunRow> {
  const run = await getRun(supabase, id)
  if (!run) throw new Error(`curation_runs: Run ${id} nicht gefunden`)
  return run
}
