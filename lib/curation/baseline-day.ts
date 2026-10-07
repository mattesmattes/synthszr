/**
 * Tagesdaten, reine Helfer und Messlogik der Baseline-Messung (Phase 0,
 * Vertrag 2.10): ein manueller article_job wird auf den Pool zum
 * Laufzeitpunkt, die Handauswahl und die veröffentlichten Einheiten seines
 * Posts abgebildet.
 *
 * WARUM ein eigenes Modul statt Logik im Script: scripts/*.ts sind nicht
 * testbar (BEFUND 2026-10-06: sie exportieren kein main() und starten beim
 * Import, z. B. scripts/measure-reranker-baseline.ts). Die
 * Query-Ketten hier sind mit dem makeChain-Muster prüfbar — Pool-Fenster und
 * -Seiten, Job→Post-Mapping, Chunking, Nachladen, Hand-Events, Job-Payloads,
 * fehlende Embeddings, Präzedenz-Job —, die Helfer und die Messlogik sind
 * rein; das Script lädt nur
 * noch seitenweise, verdrahtet und gibt aus.
 * Abweichung vom Vertrag §1, in Task 15 begründet.
 */
import { computeCostUsd } from '@/lib/ai/usage-cost'
import { capByUnits } from '@/lib/claude/queue-article'
import {
  duplicateRate, idRecallAtK, precisionAtK, quantiles, unitRecallAtK,
} from '@/lib/curation/baseline-metrics'
import { isHandItem } from '@/lib/curation/origin'
import { berlinDay, eventsAsOf, isoDayShift, parseSinceArg, precedentSelectedItems, type PrecedentUnit } from '@/lib/curation/precedents'
import { loadEventsForItems, type SupabaseAdmin } from '@/lib/news-queue/events'
import { isJunkTitle } from '@/lib/news-queue/service'
import { parseEmbedding } from '@/lib/news-queue/semantic-dedup'

/** Pool = news_queue mit queued_at in [asOf − 48 h, asOf) (Spec „Pool", Vertrag 2.10). */
export const POOL_WINDOW_MS = 48 * 3600 * 1000
/**
 * Seitengröße des Pool-Ladens. BEFUND 2026-10-06: PostgREST kappt jede Antwort
 * still bei max_rows = 1000 (supabase/config.toml:18) — `.limit(2000)` wie in
 * scripts/lib/taste-ground-truth.ts:117-122 liefert höchstens 1000 Zeilen und
 * meldet nie „gekappt". Daher seitenweise per .range().
 */
export const POOL_PAGE = 1000
/** Obergrenze je Tag über alle Seiten — wie DAY_LIMIT in scripts/lib/taste-ground-truth.ts:88; poolTruncated, wenn erreicht. */
export const POOL_LIMIT = 2000
/** Stufe 1 des Rankings (lib/news-queue/ranking-service.ts:25): der Pool sieht dieselben Kandidaten wie der Vorschlags-Button. */
export const MIN_CONTENT_LENGTH = 500
/**
 * Job-Payloads (selected_items, written_sections) je Anfrage.
 * BEFUND 2026-10-06: selected_items trägt je Item den Volltext aus daily_repo
 * (selectAndEnrichItems in lib/claude/queue-article.ts reichert `content` an,
 * lib/article-jobs/service.ts:136/:181 speichert `selected_items: pipelineItems`),
 * written_sections den Markdown je Write-Unit. Gemessen (Prod-Read
 * 2026-10-06, octet_length(selected_items::text)): manuell im Mittel 243 KB je
 * Job, höchstens 780 KB; auto 364 KB, höchstens 1,1 MB. 200 Jobs wären
 * ~50–70 MB in EINER Antwort — ein Timeout bräche den ganzen Lauf ab.
 * 10 Jobs halten jede Antwort bei ~2–4 MB (höchstens ~11 MB).
 */
export const JOB_PAYLOAD_CHUNK = 10
// WARUM 200: .in()-Listen ab ~400 UUIDs lösen gegen Prod einen
// HeadersOverflowError aus (scripts/lib/taste-ground-truth.ts:7-11).
const IN_CHUNK = 200
/**
 * Default von schedule_config.dailyAnalysis (app/api/cron/scheduled-tasks/route.ts:52,
 * 05:00 Berlin) — die Konstante ist dort nicht exportiert.
 */
const DEFAULT_DAILY_ANALYSIS_BERLIN_MINUTE = 5 * 60

/** Schmale article_jobs-Spalten — für alle Jobs des Bereichs geladen. */
export interface BaselineJobMeta {
  id: string
  source: string
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  generated_post_id: string | null
}

/** article_jobs-Zeile mit Payload (jsonb kommt lose typisiert) — nur für gebrauchte Jobs nachgeladen. */
export interface BaselineJobRow extends BaselineJobMeta {
  selected_items: Array<{ id: string; bundle_type?: string | null }> | null
  written_sections: unknown[] | null
}

export interface PoolItem {
  id: string
  title: string
  source_identifier: string
  total_score: number
  bundle_type: string | null
  metadata: Record<string, unknown> | null
  content_length: number | null
  daily_repo_id: string | null
  queued_at: string
}

export interface BaselineUnit {
  id: string
  position: number
  heading: string
  bundleType: string | null
  memberIds: string[]
}

/** news_queue-Zeile je relevanter ID (Pool-Items UND nachgeladene Member-/Auswahl-/Nachtlauf-IDs). */
export interface ItemRow {
  content_length: number | null
  daily_repo_id: string | null
  source_identifier: string | null
  /** Für isHandItem (Herkunfts-Fallback ohne Events: techmeme / curation.run_id). */
  metadata: Record<string, unknown> | null
}

/** Techmeme-Quelle im 48-h-Fenster, VOR Junk-/Längenfilter (Task 15 Entscheidung 13). */
export interface TechmemeItem {
  id: string
  story: string
  storyIndex: number
}

export interface DayInputs {
  /** Berlin-Kalendertag des Jobs, 'YYYY-MM-DD'. */
  day: string
  jobId: string
  postId: string
  /** created_at des manuellen Jobs = Laufzeitpunkt des Betreibers. */
  asOf: string
  poolFrom: string
  pool: PoolItem[]
  poolTruncated: boolean
  techmemeItems: TechmemeItem[]
  /** Alle selected_items des manuellen Jobs in Reihenfolge, dedupliziert (Zusatzzeile hand_all_selected). */
  selectedIds: string[]
  /**
   * Hand-Items = isHandItem-Teilmenge von selectedIds, Reihenfolge erhalten —
   * dieselbe Menge wie in curation_precedents (Task 15 Entscheidung 24). Kann
   * Füll-Items der Pipeline enthalten (Entscheidung 23).
   */
  handIds: string[]
  units: BaselineUnit[]
  itemRows: Map<string, ItemRow>
}

export type DaySkipReason = 'no_post' | 'post_not_published' | 'no_units'

export interface ScriptArgs { dryRun: boolean; since?: string }

// ── Zeit ──────────────────────────────────────────────────────────────────

/**
 * Berlin-Kalendertag eines Zeitstempels — aus lib/curation/precedents.ts
 * (Task 11) übernommen und re-exportiert. WARUM keine eigene Kopie: Baseline
 * und curation_precedents müssen jeden Job demselben Tag zuordnen; zwei
 * Implementierungen könnten auseinanderlaufen, ohne dass ein Test es merkt
 * (BEFUND 2026-10-06, Review Task 15).
 */
export { berlinDay }

/**
 * 'YYYY-MM-DD' ± Tage — aus lib/curation/precedents.ts (Task 11) übernommen
 * und re-exportiert, keine eigene Implementierung (Controller-Ruling K4):
 * dieselbe Funktion rechnet den Bereichsanfang (rangeStartOf) UND die
 * 30-Tage-Zeitkette (Entscheidung 16) — zwei Implementierungen könnten
 * auseinanderlaufen, ohne dass ein Test es merkt.
 */
export { isoDayShift }

/**
 * Berlin-Uhrzeit 'HH:MM' eines Zeitstempels (für die Zeitkette neben der UTC-Angabe).
 * WARUM hourCycle 'h23' statt hour12: false: mit hour12 liefern manche
 * ICU-Versionen um Mitternacht '24:00' — genau im Bereich der Nachtläufe.
 */
export function berlinHHMM(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso))
}

/** Minute des Berlin-Tages (0..1439) — Vergleich mit schedule_config, das in Berlin-Lokalzeit steht. */
export function berlinMinutesOfDay(iso: string): number {
  const [h, m] = berlinHHMM(iso).split(':').map(Number)
  return h * 60 + m
}

/** [asOf − 48 h, asOf) als ISO-Strings. */
export function poolWindow(asOf: string): { from: string; to: string } {
  const to = new Date(asOf)
  return { from: new Date(to.getTime() - POOL_WINDOW_MS).toISOString(), to: to.toISOString() }
}

export function utcMinutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Minute des Tages → 'HH:MM'; NaN (leere Quantile) oder negativ → null, damit das JSON `null` statt 'NaN:NaN' trägt. */
export function hhmm(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0) return null
  const m = Math.round(minutes)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Minuten zwischen zwei Zeitstempeln; null, wenn einer fehlt oder b nicht nach a liegt. */
export function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return ms > 0 ? ms / 60000 : null
}

/**
 * Aufsteigend sortierte Zeitstempel zu Läufen clustern: ein neuer Lauf
 * beginnt, wenn die Lücke zum Ende des letzten Laufs > gapMs ist (= gapMs
 * gehört noch dazu). Techmeme: ein Cron-Lauf = eine Relevanz-Anfrage
 * (relevance.ts:85); Synthese-Charge: Upserts in Batches à 50 binnen Sekunden
 * (lib/synthesis/pipeline.ts:433).
 */
export function clusterRuns(isoTimestampsAsc: string[], gapMs: number): Array<{ start: string; end: string; calls: number }> {
  const runs: Array<{ start: string; end: string; calls: number }> = []
  for (const iso of isoTimestampsAsc) {
    const last = runs[runs.length - 1]
    if (last && new Date(iso).getTime() - new Date(last.end).getTime() <= gapMs) {
      last.end = iso
      last.calls++
    } else {
      runs.push({ start: iso, end: iso, calls: 1 })
    }
  }
  return runs
}

// ── Argumente, Bereich, Konfiguration ─────────────────────────────────────

/**
 * `null` = --since vorhanden, aber ungültig oder leer (Abbruch statt stillem
 * Lauf mit falschem Bereich). Baut auf parseSinceArg (Task 11,
 * lib/curation/precedents.ts) auf statt einer eigenen argValue-Implementierung
 * (Controller-Ruling K4) — dieselbe Flag-Lesart wie der Präzedenzfall-Schreib-Lauf.
 */
export function parseArgs(argv: string[]): ScriptArgs | null {
  const since = parseSinceArg(argv)
  if (since === null) return null
  return { dryRun: argv.includes('--dry-run'), since }
}

/**
 * Anfang des Messbereichs (Entscheidung 1): --since gewinnt, sonst der
 * frühere von Gate-Start und heute − lastDays — die Gate-Tage der Spec
 * („Offline": 2026-08-25..09-29) UND die letzten 30 Tage müssen drin sein.
 */
export function rangeStartOf(today: string, since: string | undefined, gateStart: string, lastDays: number): string {
  if (since) return since
  const recent = isoDayShift(today, -lastDays)
  return recent < gateStart ? recent : gateStart
}

/**
 * UTC-Vorfilter für created_at-Abfragen: rangeStart 00:00Z − 3 h. WARUM 3 h:
 * Berlin-Mitternacht liegt bei UTC+2 (Sommer) um 22:00Z, bei UTC+1 (Winter) um
 * 23:00Z des Vortags — 3 h decken beides mit Luft ab. Der exakte Schnitt folgt
 * mit inBerlinRange.
 */
export function rangeFromIso(rangeStart: string): string {
  return new Date(Date.parse(`${rangeStart}T00:00:00.000Z`) - 3 * 3600 * 1000).toISOString()
}

/** Exakter Bereichsschnitt nach dem UTC-Vorfilter: Berlin-Kalendertag von iso ≥ rangeStart. */
export function inBerlinRange(iso: string, rangeStart: string): boolean {
  return berlinDay(iso) >= rangeStart
}

/**
 * Seed der Zufalls-Baseline je Kalendertag: base + Tage seit 1970-01-01.
 * WARUM nicht base + Index des Tages in der Bereichsliste: --since oder ein
 * verschobener Bereichsanfang ändert den Index — derselbe Tag bekäme eine
 * andere Permutation, und das git-getrackte JSON änderte sich ohne
 * Datenänderung (BEFUND 2026-10-06, Review Task 15).
 */
export function daySeed(day: string, base: number): number {
  const [y, m, d] = day.split('-').map(Number)
  return base + Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * Start der Tagesanalyse als Berlin-Minute aus settings.schedule_config
 * (Shape app/api/cron/scheduled-tasks/route.ts:16-55, Zeiten Berlin-Lokalzeit).
 * Fehlt der Eintrag oder ist er kaputt → Default 05:00 (route.ts:52).
 */
export function dailyAnalysisMinuteOf(scheduleConfig: unknown): number {
  const da = (scheduleConfig as { dailyAnalysis?: { hour?: unknown; minute?: unknown } } | null)?.dailyAnalysis
  const hour = typeof da?.hour === 'number' && Number.isFinite(da.hour) ? da.hour : null
  if (hour === null) return DEFAULT_DAILY_ANALYSIS_BERLIN_MINUTE
  const minute = typeof da?.minute === 'number' && Number.isFinite(da.minute) ? da.minute : 0
  return hour * 60 + minute
}

// ── Statistik, Zufall ─────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

/**
 * Mittel nur über endliche Werte; null/NaN zählen nicht (z. B. Kosten je
 * Write-Unit ohne Write-Units). Nichts Endliches → NaN (im JSON null).
 */
export function meanFinite(xs: Array<number | null>): number {
  return mean(xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))
}

/** Stichproben-Standardabweichung (n − 1); NaN unter zwei Werten. */
export function sampleSd(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Fisher-Yates mit injiziertem PRNG (im Script mulberry32 aus
 * @/lib/curation/baseline-metrics, Task 14) — die Zufalls-Baseline muss bei
 * gleichem Seed bit-identisch bleiben, sonst ist das JSON nicht reproduzierbar.
 */
export function seededShuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── Job-Felder ────────────────────────────────────────────────────────────

/**
 * IDs aus selected_items in Reihenfolge, dedupliziert; jsonb null → [].
 * Über precedentSelectedItems (Task 11), damit Baseline und Präzedenzfälle
 * dieselbe Auswahl lesen (leere oder fehlende IDs fallen weg).
 */
export function selectedIdsOf(job: BaselineJobRow): string[] {
  return precedentSelectedItems(job.selected_items).map((s) => s.id)
}

/**
 * Write-Units = written_sections.length. Bündel + Einzelfassung zählen doppelt
 * (buildBundleWriteUnits in lib/claude/ghostwriter-pipeline.ts erzeugt für
 * topic/deep_dive/cover_story zusätzlich kind 'single') — also ≥ published_units.
 */
export function writeUnitsOf(job: BaselineJobRow): number {
  return Array.isArray(job.written_sections) ? job.written_sections.length : 0
}

function toItemRow(r: Record<string, unknown>): ItemRow {
  return {
    content_length: r.content_length === null || r.content_length === undefined ? null : Number(r.content_length),
    daily_repo_id: (r.daily_repo_id as string | null) ?? null,
    source_identifier: (r.source_identifier as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }
}

/** llm_usage-Zeile wie geladen (supabase/migrations/20260920090000_llm_usage.sql). */
export interface LlmUsageRaw {
  created_at: string
  use_case: string
  model: string | null
  cost_usd: unknown
  input_tokens: unknown
  output_tokens: unknown
  cache_write_tokens: unknown
  cache_read_tokens: unknown
}

/** llm_usage-Zeile, schmal (at = Epoch-ms für Fenstervergleiche). repriced = cost aus Token-Spalten nachberechnet. */
export interface LlmRow { at: number; iso: string; use_case: string; cost: number | null; repriced: boolean }

const tokenCount = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Kosten je llm_usage-Zeile (Task 15 Entscheidung 10): cost_usd, wenn gesetzt;
 * sonst computeCostUsd(model, Token-Spalten) mit der heutigen MODEL_PRICING
 * (repriced = true); bleibt das null (Modell ohne Preis), ist cost null.
 * BEFUND 2026-10-06 (Review Task 15): Opus 5.5 läuft seit Commit e5872ca,
 * MODEL_PRICING kannte es nicht → cost_usd = NULL in llm_usage; der Preis aus
 * Task 13 wirkt nur auf künftige Zeilen. Ohne Nachberechnung zählten diese
 * Aufrufe in den Draft-Kosten als 0 $ — still zu niedrig. Kein Prod-Write:
 * die Token stehen in jeder Zeile.
 */
export function llmRowOf(r: LlmUsageRaw): LlmRow {
  const stored = r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd)
  const base = { at: new Date(r.created_at).getTime(), iso: r.created_at, use_case: r.use_case }
  if (stored !== null && Number.isFinite(stored)) return { ...base, cost: stored, repriced: false }
  const computed = computeCostUsd(r.model ?? '', {
    inputTokens: tokenCount(r.input_tokens),
    outputTokens: tokenCount(r.output_tokens),
    cacheWriteTokens: tokenCount(r.cache_write_tokens),
    cacheReadTokens: tokenCount(r.cache_read_tokens),
  })
  return computed === null ? { ...base, cost: null, repriced: false } : { ...base, cost: computed, repriced: true }
}

// ── Laden ─────────────────────────────────────────────────────────────────

/**
 * Payload (selected_items, written_sections) für die übergebenen Jobs, in
 * Scheiben à JOB_PAYLOAD_CHUNK (BEFUND oben). Liefert für JEDEN übergebenen
 * Job eine Zeile — ohne Payload-Zeile (Job inzwischen gelöscht) mit
 * null-Feldern, damit selectedIdsOf/writeUnitsOf wie bei jsonb null reagieren.
 */
export async function loadJobPayloads(supabase: SupabaseAdmin, metas: BaselineJobMeta[]): Promise<Map<string, BaselineJobRow>> {
  const payload = new Map<string, { selected_items: BaselineJobRow['selected_items']; written_sections: BaselineJobRow['written_sections'] }>()
  const ids = [...new Set(metas.map((m) => m.id))]
  for (let i = 0; i < ids.length; i += JOB_PAYLOAD_CHUNK) {
    const { data, error } = await supabase
      .from('article_jobs')
      .select('id, selected_items, written_sections')
      .in('id', ids.slice(i, i + JOB_PAYLOAD_CHUNK))
    if (error) throw new Error(`article_jobs (payload): ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      payload.set(r.id as string, {
        selected_items: Array.isArray(r.selected_items) ? (r.selected_items as BaselineJobRow['selected_items']) : null,
        written_sections: Array.isArray(r.written_sections) ? (r.written_sections as unknown[]) : null,
      })
    }
  }
  const out = new Map<string, BaselineJobRow>()
  for (const m of metas) {
    const p = payload.get(m.id)
    out.set(m.id, { ...m, selected_items: p?.selected_items ?? null, written_sections: p?.written_sections ?? null })
  }
  return out
}

/**
 * Alle Eingaben eines Baseline-Tages. `reason` statt Exception, wenn der Tag
 * nicht messbar ist (Review-Fokus 2: ein manueller Job ohne veröffentlichten
 * Post — Draft archiviert, noch 'draft', Post gelöscht — wird übersprungen und
 * gezählt, nicht mit Recall 0 gewertet). DB-Fehler werfen (Script-Pfad).
 *
 * Hand-Items (Entscheidung 24): isHandItem über queue_item_events und
 * news_queue.metadata — wörtlich der Aufruf aus build-curation-precedents,
 * damit Baseline und curation_precedents dieselbe Hand-Menge führen.
 *
 * `extraIds`: weitere IDs, deren news_queue-Zeile gebraucht wird (Nachtlauf-
 * Items des Auto-Jobs, Task 15 Entscheidung 6) — sie liegen oft außerhalb
 * des gefilterten Pools.
 */
export async function loadDayInputs(
  supabase: SupabaseAdmin,
  job: BaselineJobRow,
  extraIds: string[] = [],
): Promise<{ inputs: DayInputs; reason: null } | { inputs: null; reason: DaySkipReason }> {
  // 1) Job → Post
  if (!job.generated_post_id) return { inputs: null, reason: 'no_post' }
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('id, status')
    .eq('id', job.generated_post_id)
    .maybeSingle()
  if (postError) throw new Error(`generated_posts: ${postError.message}`)
  if (!post) return { inputs: null, reason: 'no_post' }
  if (post.status !== 'published') return { inputs: null, reason: 'post_not_published' }
  const postId = post.id as string

  // 2) Ground Truth: published_units des Posts (Task 10). Ohne Einheiten ist
  //    der Backfill nicht gelaufen oder der Post hat keine H2 — Tag überspringen,
  //    sonst zählte jede Baseline mit Recall 0 gegen eine leere Menge.
  const { data: unitRows, error: unitError } = await supabase
    .from('published_units')
    .select('id, position, heading, bundle_type, member_ids')
    .eq('post_id', postId)
    .order('position', { ascending: true })
  if (unitError) throw new Error(`published_units: ${unitError.message}`)
  const units: BaselineUnit[] = (unitRows ?? []).map((u) => ({
    id: u.id as string,
    position: Number(u.position),
    heading: (u.heading as string | null) ?? '',
    bundleType: (u.bundle_type as string | null) ?? null,
    memberIds: Array.isArray(u.member_ids) ? (u.member_ids as string[]) : [],
  }))
  if (units.length === 0) return { inputs: null, reason: 'no_units' }

  // 3) Pool zum Laufzeitpunkt: queued_at in [asOf − 48 h, asOf). Strikt < asOf —
  //    BEFUND 2026-10-06 (Spec „Offline"): loadDayCandidates nimmt den vollen
  //    UTC-Tag und ist damit systematisch optimistisch (Items, die der Betreiber
  //    um 04:30 noch gar nicht sehen konnte). Kein Statusfilter: historische
  //    Items sind längst used/expired. Seitenweise à POOL_PAGE (max_rows = 1000),
  //    nach id geordnet, damit die Kappung bei POOL_LIMIT reproduzierbar ist.
  const asOf = new Date(job.created_at).toISOString()
  const { from, to } = poolWindow(asOf)
  const raw: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < POOL_LIMIT; offset += POOL_PAGE) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('id, title, source_identifier, total_score, bundle_type, metadata, content_length, daily_repo_id, queued_at')
      .gte('queued_at', from)
      .lt('queued_at', to)
      .order('id', { ascending: true })
      .range(offset, offset + POOL_PAGE - 1)
    if (error) throw new Error(`news_queue (pool): ${error.message}`)
    const page = (data ?? []) as Array<Record<string, unknown>>
    raw.push(...page)
    if (page.length < POOL_PAGE) break
  }
  const pool: PoolItem[] = raw
    .filter((r) => !isJunkTitle((r.title as string | null) ?? '') && (Number(r.content_length) || 0) >= MIN_CONTENT_LENGTH)
    .map((r) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? '',
      source_identifier: (r.source_identifier as string | null) ?? '',
      // NUMERIC(5,2) GENERATED (supabase/migrations/20260328_optimized_scoring.sql:25)
      // kommt aus PostgREST je nach Client als String — immer Number().
      total_score: Number(r.total_score) || 0,
      bundle_type: (r.bundle_type as string | null) ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      content_length: r.content_length === null || r.content_length === undefined ? null : Number(r.content_length),
      daily_repo_id: (r.daily_repo_id as string | null) ?? null,
      queued_at: r.queued_at as string,
    }))

  // Techmeme-Stories VOR dem Filter (Entscheidung 13): Techmeme-Quellen sind
  // oft < 500 Zeichen; zählte man nur den gefilterten Pool, fehlten ganze Stories.
  const techmemeItems: TechmemeItem[] = []
  for (const r of raw) {
    const md = r.metadata as Record<string, unknown> | null
    if (!md || md.techmeme !== true) continue
    const storyIndex = md.techmeme_story_index
    if (typeof storyIndex !== 'number' || !Number.isFinite(storyIndex)) continue
    techmemeItems.push({ id: r.id as string, story: String(md.techmeme_story ?? ''), storyIndex })
  }

  // 4) Auswahl (selected_items des manuellen Jobs) und news_queue-Zeilen
  //    aller IDs außerhalb des Pools (Member-IDs älterer Items, ältere oder
  //    kurze Auswahl-Items wie Techmeme-Themen, Nachtlauf-IDs) — daily_repo_id
  //    für Embeddings, content_length für die Verteilung, metadata für isHandItem.
  const selectedIds = selectedIdsOf(job)
  const itemRows = new Map<string, ItemRow>()
  for (const p of pool) {
    itemRows.set(p.id, { content_length: p.content_length, daily_repo_id: p.daily_repo_id, source_identifier: p.source_identifier, metadata: p.metadata })
  }
  const missing: string[] = []
  const seen = new Set<string>()
  for (const id of [...units.flatMap((u) => u.memberIds), ...selectedIds, ...extraIds]) {
    if (itemRows.has(id) || seen.has(id)) continue
    seen.add(id)
    missing.push(id)
  }
  for (let i = 0; i < missing.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('id, content_length, daily_repo_id, source_identifier, metadata')
      .in('id', missing.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`news_queue (members): ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) itemRows.set(r.id as string, toItemRow(r))
  }

  // 5) Hand-Items = isHandItem-Teilmenge der Auswahl, Events as-of
  //    job.created_at (Entscheidung 24) — derselbe Aufruf wie in
  //    build-curation-precedents. BEFUND 2026-10-06 (Review Task 15):
  //    Techmeme-Themen stehen mit status 'selected' in der Queue
  //    (lib/techmeme/queue-items.ts) und kommen über getSelectedItems() in
  //    jeden manuellen Job — mit hand = selected_items mäße die Gate-Referenz
  //    die Techmeme-Auto-Auswahl mit, während curation_precedents sie als
  //    pending_never_selected führt. Items ohne news_queue-Zeile: metadata
  //    null → Fallback operator (wie Task 11).
  const events = await loadEventsForItems(supabase, selectedIds)
  const handIds = selectedIds.filter((id) =>
    isHandItem({ id, metadata: itemRows.get(id)?.metadata ?? null }, eventsAsOf(events.get(id) ?? [], asOf)),
  )

  return {
    inputs: {
      day: berlinDay(asOf),
      jobId: job.id,
      postId,
      asOf,
      poolFrom: from,
      pool,
      poolTruncated: raw.length >= POOL_LIMIT,
      techmemeItems,
      selectedIds,
      handIds,
      units,
      itemRows,
    },
    reason: null,
  }
}

/**
 * daily_repo.embedding je Repo-ID, Scheiben à 200, pgvector über parseEmbedding
 * (String ODER Array, Vertrag 0). IDs ohne Zeile oder ohne Vektor fehlen in
 * der Map — assignStoryKeys gibt ihnen dann einen eigenen Cluster.
 */
export async function loadRepoEmbeddings(supabase: SupabaseAdmin, repoIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const ids = [...new Set(repoIds)]
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, embedding')
      .in('id', ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`daily_repo: ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const emb = parseEmbedding(r.embedding)
      if (emb.length > 0) out.set(r.id as string, emb)
    }
  }
  return out
}

/**
 * Job, den curation_precedents für einen Berlin-Tag führt (Entscheidung 25),
 * null ohne Zeile. Eine Zeile genügt: build-curation-precedents verarbeitet je
 * Tag genau einen Job (spätester mit veröffentlichtem Post) und ersetzt den
 * Tag bei jedem Lauf (Task 11 Entscheidung 12), alle Zeilen des Tages tragen
 * dieselbe job_id. WARUM, obwohl Baseline und Präzedenzfälle dieselbe
 * Funktion pickPrecedentJobs nutzen (Entscheidung 1): gleiche Regel heißt
 * nicht gleicher Datenstand. Wurde nach dem Präzedenzfall-Lauf ein jüngerer
 * Job desselben Tages veröffentlicht, führen die gespeicherten Zeilen einen
 * anderen Job als die Baseline — der Abgleich macht das je Tag sichtbar
 * (Entscheidung 25, BEFUND 2026-10-06, Review Task 15).
 */
export async function loadPrecedentJobId(supabase: SupabaseAdmin, day: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('curation_precedents')
    .select('job_id')
    .eq('day', day)
    .limit(1)
  if (error) throw new Error(`curation_precedents: ${error.message}`)
  const row = ((data ?? []) as Array<{ job_id: string | null }>)[0]
  return row?.job_id ?? null
}

/**
 * Eingaben für pickPrecedentJobs (Task 11) — dieselbe Tag-Job-Wahl wie
 * build-curation-precedents (Entscheidung 1): Post-Status je Post-ID und
 * published_units je Post (schmal, ohne Embedding → embedding null; die Wahl
 * liest nur memberIds). Scheiben à 200, published_units je Scheibe seitenweise
 * à 1000 (max_rows), nach (post_id, position) geordnet. Gelöschte Posts fehlen
 * in statusById → pickPrecedentJobs zählt sie als not_published.
 */
export async function loadPickInputs(
  supabase: SupabaseAdmin,
  postIds: string[],
): Promise<{ statusById: Map<string, string>; unitsByPost: Map<string, PrecedentUnit[]> }> {
  const statusById = new Map<string, string>()
  const unitsByPost = new Map<string, PrecedentUnit[]>()
  const ids = [...new Set(postIds)]
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK)
    const { data: posts, error: postError } = await supabase.from('generated_posts').select('id, status').in('id', slice)
    if (postError) throw new Error(`generated_posts: ${postError.message}`)
    for (const r of (posts ?? []) as Array<{ id: string; status: string }>) statusById.set(r.id, r.status)
    for (let offset = 0; ; offset += POOL_PAGE) {
      const { data, error } = await supabase
        .from('published_units')
        .select('post_id, position, heading, bundle_type, member_ids')
        .in('post_id', slice)
        .order('post_id', { ascending: true })
        .order('position', { ascending: true })
        .range(offset, offset + POOL_PAGE - 1)
      if (error) throw new Error(`published_units: ${error.message}`)
      const page = (data ?? []) as Array<Record<string, unknown>>
      for (const u of page) {
        const postId = u.post_id as string
        const list = unitsByPost.get(postId) ?? []
        list.push({
          position: Number(u.position),
          heading: (u.heading as string | null) ?? '',
          bundleType: (u.bundle_type as string | null) ?? null,
          memberIds: Array.isArray(u.member_ids) ? (u.member_ids as string[]) : [],
          embedding: null,
        })
        unitsByPost.set(postId, list)
      }
      if (page.length < POOL_PAGE) break
    }
  }
  return { statusById, unitsByPost }
}

// ── Messlogik (rein; das Script verdrahtet nur) ───────────────────────────

export type KMap = Record<string, number>

/**
 * Metriken eines Rankings an einem Tag, je K. unit_hits = Treffer@K auf ALLE
 * Einheiten, unit_hits_covered = Treffer@K nur auf pool-abgedeckte (Basis von
 * unit_recall_covered, Entscheidung 7).
 */
export interface RankedMetrics { unit_recall: KMap; unit_hits: KMap; unit_hits_covered: KMap; id_recall: KMap; precision: KMap }

/** Handauswahl: Rankingmetriken plus P/R über die volle Liste und Dubletten-Rate. */
export type HandMetrics = RankedMetrics & { precision_full: number; recall_full: number; duplicate_rate: number }

export interface AggregatedRanked { n: number; unit_recall: KMap; unit_recall_covered: KMap; id_recall: KMap; precision: KMap }

export interface DraftCostRow {
  job_id: string
  day: string
  write_units: number
  /** Einheiten des veröffentlichten Posts — nur für den gemessenen Job des Tages bekannt, sonst null. */
  published_units: number | null
  calls: number
  /** Zeilen mit cost_usd NULL, über computeCostUsd nachberechnet (llmRowOf). */
  repriced_calls: number
  /** Zeilen, die auch nach der Nachberechnung keinen Preis haben (zählen mit 0 $ → Untergrenze). */
  unpriced_calls: number
  cost_usd: number
  cost_per_write_unit_usd: number | null
  minutes: number | null
}

export interface ThroughputRow { job_id: string; day: string; source: string; write_units: number; minutes: number; write_units_per_minute: number }

export interface AnalysisEndDay {
  day: string
  /** Erster Zeitstempel des gewerteten Laufs (= erste Charge ab dailyAnalysis). */
  run_start: string
  last_queued_at: string
  utc: string | null
  berlin: string
  /** Zeilen des gewerteten Laufs. */
  rows: number
  /** Zeilen desselben Berlin-Tages NACH dem Lauf (Handergänzungen, manuelle Neuläufe) — nicht gewertet. */
  later_rows: number
}

/** Abgleich gemessener Job ↔ curation_precedents je Tag (Entscheidung 25). */
export interface PrecedentAgreement { match: number; mismatch: number; missing: number; mismatch_days: string[]; missing_days: string[] }

/**
 * Jobs je Berlin-Tag. Manuelle Jobs ohne Statusfilter in Eingabereihenfolge
 * (die Wahl des gemessenen Jobs trifft pickPrecedentJobs, Task 11, über einen
 * eigenen created_at-Vergleich). Auto: je Tag nur der JÜNGSTE Job mit
 * status='done' (Entscheidung 4) — error/processing-Jobs haben ebenfalls
 * selected_items (Fehler setzt markJobError, lib/article-jobs/service.ts:287-296,
 * status 'error' + completed_at), sind aber kein gelaufener Nachtlauf und
 * würden eine nie geschriebene Auswahl als „Ist" messen.
 * WARUM Vergleich statt „letzter gewinnt": die Funktion soll nicht still von
 * der Sortierung des Aufrufers abhängen (dieselbe Regel wie pickPrecedentJobs,
 * Task 11 Entscheidung 4; BEFUND 2026-10-06, Review Task 15).
 */
export function groupJobsByDay<J extends Pick<BaselineJobMeta, 'source' | 'status' | 'created_at'>>(
  jobs: J[],
): { manualByDay: Map<string, J[]>; autoByDay: Map<string, J> } {
  const manualByDay = new Map<string, J[]>()
  const autoByDay = new Map<string, J>()
  for (const j of jobs) {
    const day = berlinDay(j.created_at)
    if (j.source === 'manual') {
      const list = manualByDay.get(day) ?? []
      list.push(j)
      manualByDay.set(day, list)
    } else if (j.source === 'auto' && j.status === 'done') {
      const prev = autoByDay.get(day)
      if (!prev || Date.parse(j.created_at) > Date.parse(prev.created_at)) autoByDay.set(day, j)
    }
  }
  return { manualByDay, autoByDay }
}

/**
 * bundle_type auf null, außer bei Techmeme-Items mit 'topic' (Entscheidung 3).
 * BEFUND 2026-10-06: capByUnits (lib/claude/queue-article.ts, „Bündel kommen
 * zuerst und immer VOLLSTÄNDIG“) stellt jedes Item mit bundle_type VOR die
 * Score-Singles. Im historischen Pool tragen die vom Betreiber gelabelten Items
 * ihr Label für immer (PATCH app/api/admin/news-queue/bundle-type/route.ts;
 * reset-item setzt es nicht zurück) — ohne Neutralisierung stünden die
 * veröffentlichten Einheiten selbst vorn in der „total_score"-Baseline
 * (Ground-Truth-Leak). Techmeme-Story-Bündel sind eine Eigenschaft der Quelle
 * und bleiben — aber nur mit 'topic', dem einzigen automatisch gesetzten Wert
 * (lib/techmeme/queue-items.ts `bundleType: istThema ? 'topic' : null`,
 * promoteExistingTopicSources in lib/techmeme/job.ts). WARUM nur 'topic': die
 * bundle-type-Route prüft nicht auf Techmeme; deep_dive/cover_story/recap auf
 * einem Techmeme-Item kann nur der Betreiber gesetzt haben (BEFUND 2026-10-06,
 * Review Task 15). Rest-Leak: ein Betreiber-Relabel null → topic auf einem
 * Techmeme-Item ist ohne Event nicht erkennbar (Vorbehalt in note/CLAUDE.md).
 */
export function neutralizeHandLabels<T extends { bundle_type: string | null; metadata: Record<string, unknown> | null }>(items: T[]): T[] {
  return items.map((p) => ({
    ...p,
    bundle_type: p.metadata?.techmeme === true && p.bundle_type === 'topic' ? 'topic' : null,
  }))
}

/**
 * Eingabe für capByUnits der total_score-Baseline (Entscheidung 3): von Hand
 * eingestellte Items (metadata.manual === true) auf total_score 0, absteigend
 * nach total_score (stabil — der Pool kommt nach id geordnet), dann
 * neutralizeHandLabels. BEFUND 2026-10-06: die Admin-UI gibt Hand-Items
 * absichtlich total_score ≈ 20 bei normaler Obergrenze ≈ 11
 * (app/admin/news-queue/page.tsx:497-509; Spalte GENERATED,
 * supabase/migrations/20260328_optimized_scoring.sql:25) — das sind die
 * Meldungen, die der Betreiber gezielt nachlegt, also fast sicher
 * veröffentlichte Einheiten: zweites Ground-Truth-Leak derselben Art.
 * NICHT erfasst: queueFromDailyRepo setzt für daily_repo.source_type='article'
 * alle drei Scores auf 9,0 (queueFromDailyRepo in lib/news-queue/service.ts) — ohne
 * metadata-Marker; steht als Vorbehalt in `note` und CLAUDE.md.
 */
export function totalScoreCandidates(pool: PoolItem[]): PoolItem[] {
  const scored = pool.map((p) => (p.metadata?.manual === true ? { ...p, total_score: 0 } : p))
  return neutralizeHandLabels([...scored].sort((a, b) => b.total_score - a.total_score))
}

/**
 * total_score-Baseline je K in EINHEITEN (Entscheidung 3): je K ein eigener
 * Aufruf capByUnits(totalScoreCandidates(pool), K), Schlüssel String(K).
 * BEFUND 2026-10-06 (Review Task 15): capByUnits kappt auf ABSCHNITTE — ein
 * Techmeme-topic-Bündel bringt bis zu BUNDLE_SOURCES_MAX = 5 IDs. Die frühere
 * Fassung schnitt die 20-Einheiten-Liste bei K IDs ab (auch bei K = 20); die
 * Gate-Referenz sah dann weniger als 20 Einheiten, lag zu niedrig, und das
 * Gate „+0,10 über total_score“ wurde zu leicht. WARUM je K ein Aufruf statt
 * Präfix-Suche: capByUnits bleibt die einzige Stelle, die Einheitengrenzen kennt.
 */
export function totalScoreListsByK(pool: PoolItem[], ks: readonly number[]): Record<string, string[]> {
  const candidates = totalScoreCandidates(pool)
  const out: Record<string, string[]> = {}
  for (const k of ks) out[String(k)] = capByUnits(candidates, k).map((p) => p.id)
  return out
}

/**
 * Pool-Abdeckung (Entscheidung 7, Review-Fokus 1): nur Einheiten mit Markern
 * zählen; techmemeOnly = nicht abgedeckt UND alle Member sind Techmeme-Items
 * des Fensters — die fallen am Stufe-1-Längenfilter (< 500 Zeichen) heraus,
 * obwohl der Betreiber sie sieht (Entscheidung 2), und dürfen nicht dem
 * Backfill angelastet werden.
 */
export function coverageOf(
  units: BaselineUnit[],
  poolIds: Set<string>,
  techmemeIds: Set<string>,
): { attributable: BaselineUnit[]; covered: BaselineUnit[]; techmemeOnly: BaselineUnit[] } {
  const attributable = units.filter((u) => u.memberIds.length > 0)
  const covered = attributable.filter((u) => u.memberIds.some((id) => poolIds.has(id)))
  const techmemeOnly = attributable.filter((u) => !covered.includes(u) && u.memberIds.every((id) => techmemeIds.has(id)))
  return { attributable, covered, techmemeOnly }
}

/**
 * IDs, für die ein Embedding gebraucht wird (Entscheidung 6): alle
 * Ranking-Listen (null = keine Liste, z. B. Tag ohne Nachtlauf) und ALLE
 * Member-IDs der Einheiten, dedupliziert in Reihenfolge. WARUM Member immer
 * dabei: fehlt eine Member-ID, bekommt sie in assignStoryKeys keinen
 * Story-Schlüssel, und die Story-Ebene fällt für ihre Einheit still auf die
 * ID-Ebene zurück — kein Wert im JSON zeigte das an.
 */
export function wantedIdsOf(rankedLists: Array<string[] | null>, units: BaselineUnit[]): string[] {
  const out = new Set<string>()
  for (const list of rankedLists) for (const id of list ?? []) out.add(id)
  for (const u of units) for (const id of u.memberIds) out.add(id)
  return [...out]
}

/**
 * Item-ID → daily_repo_id für alle IDs mit news_queue-Zeile (Pool oder von
 * loadDayInputs nachgeladen) und gesetzter daily_repo_id. Techmeme- und
 * UI-Handitems (ohne daily_repo_id) und unbekannte IDs fehlen — sie landen
 * ohne Embedding in assignStoryKeys und bilden dort einen eigenen Cluster
 * (Task 14 Entscheidung 1).
 */
export function repoIdsOf(ids: string[], itemRows: Map<string, ItemRow>): Map<string, string> {
  const out = new Map<string, string>()
  for (const id of ids) {
    const repoId = itemRows.get(id)?.daily_repo_id
    if (repoId) out.set(id, repoId)
  }
  return out
}

/** Vektor je Item-ID über seine daily_repo_id; Repo ohne (gültigen) Vektor → die ID fehlt in der Map. */
export function itemEmbeddingsOf(idToRepo: Map<string, string>, repoEmb: Map<string, number[]>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const [id, repoId] of idToRepo) {
    const e = repoEmb.get(repoId)
    if (e) out.set(id, e)
  }
  return out
}

/**
 * content_length der veröffentlichten Items eines Tages (für
 * published_content_length): nur IDs mit news_queue-Zeile und endlichem Wert,
 * in Reihenfolge der IDs. WARUM hier statt im Script: die Typprüfung je Member
 * ist eine Verzweigung, die die Quantile bestimmt (BEFUND 2026-10-06, Review Task 15).
 */
export function publishedContentLengthsOf(publishedIds: Iterable<string>, itemRows: Map<string, ItemRow>): number[] {
  const out: number[] = []
  for (const id of publishedIds) {
    const len = itemRows.get(id)?.content_length
    if (typeof len === 'number' && Number.isFinite(len)) out.push(len)
  }
  return out
}

/**
 * Metriken eines Rankings: Story-Ebene (unitRecallAtK, precisionAtK) und
 * ID-Ebene (idRecallAtK) je K. unit_hits_covered[K] rechnet gegen die
 * abgedeckten Einheiten — Zähler und Nenner von unit_recall_covered bleiben
 * so pool-beschränkt, auch für hand/nightly mit IDs außerhalb des Pools
 * (BEFUND 2026-10-06: sonst wäre der Quotient > 1 möglich). Je K statt nur
 * K = 20: das Gate nutzt auch den Setzlisten-Recall@10 (Entscheidung 7).
 */
export function rankedMetricsOf(
  ids: string[],
  units: BaselineUnit[],
  covered: BaselineUnit[],
  storyOf: Map<string, string>,
  ks: readonly number[],
): RankedMetrics {
  const publishedIds = new Set(units.flatMap((u) => u.memberIds))
  const unit_recall: KMap = {}
  const unit_hits: KMap = {}
  const unit_hits_covered: KMap = {}
  const id_recall: KMap = {}
  const precision: KMap = {}
  for (const k of ks) {
    const key = String(k)
    const all = unitRecallAtK(ids, k, units, storyOf)
    unit_recall[key] = all.recall
    unit_hits[key] = all.hits
    unit_hits_covered[key] = unitRecallAtK(ids, k, covered, storyOf).hits
    id_recall[key] = idRecallAtK(ids, k, publishedIds)
    precision[key] = precisionAtK(ids, k, units, storyOf)
  }
  return { unit_recall, unit_hits, unit_hits_covered, id_recall, precision }
}

/**
 * Metriken für Listen, die je K schon auf K Einheiten gekappt sind
 * (totalScoreListsByK): je K wird die VOLLE Liste bewertet, kein ID-Schnitt —
 * rankedMetricsOf mit k = Listenlänge, Ergebnis unter dem Schlüssel K.
 * Precision-Nenner ist damit die Zahl der IDs (Task 14: min(k, length)).
 * Fehlt die Liste zu einem K, zählt sie als leer (Recall 0, Precision 0).
 */
export function unitCappedMetricsOf(
  listsByK: Record<string, string[]>,
  units: BaselineUnit[],
  covered: BaselineUnit[],
  storyOf: Map<string, string>,
  ks: readonly number[],
): RankedMetrics {
  const out: RankedMetrics = { unit_recall: {}, unit_hits: {}, unit_hits_covered: {}, id_recall: {}, precision: {} }
  for (const k of ks) {
    const key = String(k)
    const list = listsByK[key] ?? []
    const n = String(list.length)
    const m = rankedMetricsOf(list, units, covered, storyOf, [list.length])
    out.unit_recall[key] = m.unit_recall[n]
    out.unit_hits[key] = m.unit_hits[n]
    out.unit_hits_covered[key] = m.unit_hits_covered[n]
    out.id_recall[key] = m.id_recall[n]
    out.precision[key] = m.precision[n]
  }
  return out
}

/**
 * Hand-Metriken eines Tages; null bei leerer Liste (keine selected_items bzw.
 * kein Hand-Item darunter). WARUM null statt Zahlen: precisionAtK/duplicateRate
 * liefern für eine leere Liste 0 (Task 14 Entscheidung 3) — ein solcher Tag
 * zöge baselines.hand.precision_full, die Gate-Referenz für Precision@10, ohne
 * Messung nach unten. null wie beim fehlenden Nachtlauf: n zählt nur Tage
 * mit Handauswahl.
 */
export function handMetricsOf(
  handIds: string[],
  units: BaselineUnit[],
  covered: BaselineUnit[],
  storyOf: Map<string, string>,
  ks: readonly number[],
): HandMetrics | null {
  if (handIds.length === 0) return null
  return {
    ...rankedMetricsOf(handIds, units, covered, storyOf, ks),
    precision_full: precisionAtK(handIds, handIds.length, units, storyOf),
    recall_full: unitRecallAtK(handIds, handIds.length, units, storyOf).recall,
    duplicate_rate: duplicateRate(handIds, storyOf),
  }
}

/**
 * Mittel über die Tage. `m: null` (Tag ohne Nachtlauf bzw. ohne Handauswahl)
 * zählt nicht — n ist die Zahl der gemessenen Tage (Entscheidung 4).
 * unit_recall_covered je K nur über Tage mit covered > 0. Keine Tage → NaN (im JSON null).
 */
export function aggregateRanked(
  rows: Array<{ m: RankedMetrics | null; covered: number }>,
  ks: readonly number[],
): AggregatedRanked {
  const valid = rows.filter((r): r is { m: RankedMetrics; covered: number } => r.m !== null)
  const withCovered = valid.filter((r) => r.covered > 0)
  const kmap = (f: (r: { m: RankedMetrics; covered: number }, key: string) => number, from: Array<{ m: RankedMetrics; covered: number }>): KMap => {
    const out: KMap = {}
    for (const k of ks) out[String(k)] = mean(from.map((r) => f(r, String(k))))
    return out
  }
  return {
    n: valid.length,
    unit_recall: kmap((r, key) => r.m.unit_recall[key], valid),
    unit_recall_covered: kmap((r, key) => r.m.unit_hits_covered[key] / r.covered, withCovered),
    id_recall: kmap((r, key) => r.m.id_recall[key], valid),
    precision: kmap((r, key) => r.m.precision[key], valid),
  }
}

/** Hand-Zusatzkennzahlen gemittelt nur über Tage mit Handauswahl (handMetricsOf ≠ null). */
export function aggregateHandExtras(hands: Array<HandMetrics | null>): { precision_full: number; recall_full: number; duplicate_rate_mean: number } {
  const valid = hands.filter((h): h is HandMetrics => h !== null)
  return {
    precision_full: mean(valid.map((h) => h.precision_full)),
    recall_full: mean(valid.map((h) => h.recall_full)),
    duplicate_rate_mean: mean(valid.map((h) => h.duplicate_rate)),
  }
}

/** Gepaarte Tagesdifferenzen Hand − total_score bei Unit-Recall@k; nur Tage mit Handauswahl (sonst wäre die Differenz eine Messlücke, kein Effekt). */
export function pairedDiffs(days: Array<{ hand: RankedMetrics | null; total: RankedMetrics }>, k: number): number[] {
  const key = String(k)
  return days.filter((d) => d.hand !== null).map((d) => (d.hand as RankedMetrics).unit_recall[key] - d.total.unit_recall[key])
}

/**
 * Abgleich je gemessenem Tag (Entscheidung 25): führt curation_precedents
 * denselben Job wie die Baseline? Beide wählen über pickPrecedentJobs; ein
 * mismatch heißt also, dass die gespeicherten Präzedenzfälle auf einem älteren
 * Datenstand beruhen (z. B. später veröffentlichter Job) — Hand-Menge,
 * Negativ-Block und Phase-1-Backtest bezögen sich dann auf einen anderen Job
 * als die Gate-Referenz. missing = Tag ohne Präzedenzfälle (nicht
 * aufgefrischt, Steps 15c–15f).
 */
export function precedentAgreementOf(rows: Array<{ day: string; job_id: string; precedent_job_id: string | null }>): PrecedentAgreement {
  const out: PrecedentAgreement = { match: 0, mismatch: 0, missing: 0, mismatch_days: [], missing_days: [] }
  for (const r of rows) {
    if (r.precedent_job_id === null) {
      out.missing++
      out.missing_days.push(r.day)
    } else if (r.precedent_job_id === r.job_id) {
      out.match++
    } else {
      out.mismatch++
      out.mismatch_days.push(r.day)
    }
  }
  return out
}

/**
 * Techmeme-Übernahme je techmeme_story_index (Entscheidung 13): global über
 * techmeme_story dedupliziert — eine Story in zwei 48-h-Fenstern zählt einmal,
 * Rang = Index beim ersten Auftreten, published sobald ein Item der Story an
 * irgendeinem Tag veröffentlicht war.
 */
export function techmemeAdoption(
  days: Array<{ items: TechmemeItem[]; publishedIds: Set<string> }>,
): Array<{ story_index: number; stories: number; published: number; rate: number }> {
  const stories = new Map<string, { index: number; published: boolean }>()
  for (const d of days) {
    for (const t of d.items) {
      const rec = stories.get(t.story) ?? { index: t.storyIndex, published: false }
      if (d.publishedIds.has(t.id)) rec.published = true
      stories.set(t.story, rec)
    }
  }
  const byIndex = new Map<number, { stories: number; published: number }>()
  for (const rec of stories.values()) {
    const e = byIndex.get(rec.index) ?? { stories: 0, published: 0 }
    e.stories++
    if (rec.published) e.published++
    byIndex.set(rec.index, e)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([story_index, e]) => ({ story_index, stories: e.stories, published: e.published, rate: e.published / e.stories }))
}

/**
 * Kandidat für die Draft-Kosten (Entscheidung 10): manueller Job, status='done',
 * beide Zeitstempel. WARUM nur done: ein Fehler-Job (markJobError,
 * lib/article-jobs/service.ts:287-296) hat Kosten, aber nur einen Teil der
 * Write-Units — Kosten je Write-Unit wären zu hoch. WARUM nur manuell: dieselbe
 * Job-Menge wie der Schreibdurchsatz (Spec „Rollout → Phase 0"). EINE Regel für
 * draftCostOf und den Zähler in draftCostsOf (BEFUND 2026-10-06, Review Task 15:
 * doppelt geführt zählte eine Änderung Jobs still falsch als „ohne Usage").
 */
export function isCostCandidate(job: BaselineJobRow): boolean {
  return job.source === 'manual' && job.status === 'done' && !!job.started_at && !!job.completed_at
}

/**
 * Draft-Kosten eines manuellen Jobs (Entscheidung 10): nur Kandidaten
 * (isCostCandidate); llm_usage mit Draft-use_case im Fenster
 * [started_at, completed_at] (beide Grenzen inklusiv), ÷ Write-Units. Kosten
 * je Zeile aus llmRowOf: nachberechnete Zeilen zählen als repriced_calls,
 * Zeilen ohne Preis auch danach als unpriced_calls (mit 0 $ → Untergrenze).
 * WARUM null ohne llm_usage-Zeile: BEFUND 2026-10-06 — llm_usage existiert
 * erst seit 2026-09-20 (Migration 20260920090000_llm_usage.sql, Commit
 * 981a314b), und der Google-Zweig von callModelNonStreaming loggt nicht
 * (callModelNonStreaming: Google-Zweig ohne, Anthropic-Zweig mit
 * withUsageLogging, lib/claude/ghostwriter-pipeline.ts). Eine Zeile
 * mit cost_usd 0 wäre endlich, zählte in meanFinite mit und drückte das
 * Kostenmittel über die Gate-Tage im August stark nach unten. „Keine
 * Messung" ist kein „0 $".
 */
export function draftCostOf(job: BaselineJobRow, publishedUnits: number | null, llm: LlmRow[], useCases: Set<string>): DraftCostRow | null {
  if (!isCostCandidate(job)) return null
  const from = new Date(job.started_at as string).getTime()
  const to = new Date(job.completed_at as string).getTime()
  const rows = llm.filter((r) => r.at >= from && r.at <= to && useCases.has(r.use_case))
  if (rows.length === 0) return null
  const cost = rows.reduce((a, r) => a + (r.cost ?? 0), 0)
  const writeUnits = writeUnitsOf(job)
  return {
    job_id: job.id,
    day: berlinDay(job.created_at),
    write_units: writeUnits,
    published_units: publishedUnits,
    calls: rows.length,
    repriced_calls: rows.filter((r) => r.repriced).length,
    unpriced_calls: rows.filter((r) => r.cost === null).length,
    cost_usd: cost,
    cost_per_write_unit_usd: writeUnits > 0 ? cost / writeUnits : null,
    minutes: minutesBetween(job.started_at, job.completed_at),
  }
}

/**
 * Draft-Kosten über alle manuellen Jobs (Entscheidung 10): candidates =
 * isCostCandidate, rows = Kandidaten mit ≥ 1 Draft-llm_usage-Zeile, withoutUsage
 * = Kandidaten ohne solche Zeile — alles aus EINER Schleife, damit
 * candidates = rows.length + withoutUsage immer gilt. published_units aus
 * unitsByJob (nur der gemessene Job je Tag, sonst null).
 */
export function draftCostsOf(
  manualRows: BaselineJobRow[],
  unitsByJob: Map<string, number>,
  llm: LlmRow[],
  useCases: Set<string>,
): { candidates: number; rows: DraftCostRow[]; withoutUsage: number } {
  let candidates = 0
  let withoutUsage = 0
  const rows: DraftCostRow[] = []
  for (const j of manualRows) {
    if (!isCostCandidate(j)) continue
    candidates++
    const c = draftCostOf(j, unitsByJob.get(j.id) ?? null, llm, useCases)
    if (c) rows.push(c)
    else withoutUsage++
  }
  return { candidates, rows, withoutUsage }
}

/**
 * Analyse-Ende je Berlin-Tag (Entscheidung 8): queued_at der Zeilen mit
 * daily_repo_id je Berlin-Tag zu Läufen clustern (clusterRuns, gapMs) und das
 * Ende des ERSTEN Laufs nehmen, der zur Startzeit der Tagesanalyse
 * (schedule_config.dailyAnalysis, Berlin-Minute) oder später beginnt.
 * BEFUND 2026-10-06: daily_repo_id IS NOT NULL trennt die Charge NICHT exakt
 * ab — add-from-repo (queueFromDailyRepo in lib/news-queue/service.ts),
 * add-from-synthesis (POST app/api/admin/news-queue/route.ts) und
 * manuelle Synthese-Neuläufe (/api/synthesis-stream → lib/synthesis/pipeline.ts:442)
 * schreiben ebenfalls daily_repo_id, zu beliebigen Tageszeiten. Ein max über
 * den Tag läge damit systematisch zu spät — genau die Zahl, die den
 * vorgezogenen Winter-Slot begründen soll. Tage ohne Lauf ab Startzeit (Cron
 * ausgefallen, nur Handläufe) kommen in daysWithoutScheduledRun, nicht in die Quantile.
 * Nur volle Berlin-Tage [fromBerlinDay, beforeBerlinDay): WARUM — das Script
 * lädt mit 3 h Vorlauf; ein angeschnittener erster Tag ohne Morgen-Charge
 * machte eine Nachmittags-Handergänzung zum „Analyse-Ende", der laufende Tag
 * stünde vor dem Slot als „ohne Lauf" da (BEFUND 2026-10-06, Review Task 15).
 */
export function analysisEndByDay(
  queuedAtIsos: string[],
  opts: { notBeforeBerlinMinute: number; gapMs: number; fromBerlinDay: string; beforeBerlinDay: string },
): { days: AnalysisEndDay[]; daysWithoutScheduledRun: string[] } {
  const byDay = new Map<string, string[]>()
  for (const raw of queuedAtIsos) {
    // PostgREST liefert '+00:00' statt 'Z' — normalisieren, damit Sortierung und Ausgabe stimmen.
    const iso = new Date(raw).toISOString()
    const day = berlinDay(iso)
    if (day < opts.fromBerlinDay || day >= opts.beforeBerlinDay) continue
    const list = byDay.get(day) ?? []
    list.push(iso)
    byDay.set(day, list)
  }
  const days: AnalysisEndDay[] = []
  const daysWithoutScheduledRun: string[] = []
  for (const day of [...byDay.keys()].sort()) {
    const isos = (byDay.get(day) as string[]).sort()
    const runs = clusterRuns(isos, opts.gapMs)
    const run = runs.find((r) => berlinMinutesOfDay(r.start) >= opts.notBeforeBerlinMinute)
    if (!run) {
      daysWithoutScheduledRun.push(day)
      continue
    }
    const later = isos.filter((iso) => iso > run.end).length
    days.push({ day, run_start: run.start, last_queued_at: run.end, utc: hhmm(utcMinutesOfDay(run.end)), berlin: berlinHHMM(run.end), rows: run.calls, later_rows: later })
  }
  return { days, daysWithoutScheduledRun }
}

/**
 * Schreibdurchsatz (Entscheidung 12): nur manuelle Jobs (Spec „Rollout →
 * Phase 0": „Schreibdurchsatz der manuellen Jobs mit 20+ Abschnitten"),
 * status='done', ≥ minUnits Write-Units, beide Zeitstempel.
 */
export function throughputOf(jobs: BaselineJobRow[], minUnits: number): ThroughputRow[] {
  const out: ThroughputRow[] = []
  for (const j of jobs) {
    if (j.source !== 'manual' || j.status !== 'done') continue
    const writeUnits = writeUnitsOf(j)
    if (writeUnits < minUnits) continue
    const minutes = minutesBetween(j.started_at, j.completed_at)
    if (minutes === null) continue
    out.push({ job_id: j.id, day: berlinDay(j.created_at), source: j.source, write_units: writeUnits, minutes, write_units_per_minute: writeUnits / minutes })
  }
  return out
}

/** Newsletter-Eingang einer Quelle relativ zum Analyse-Slot (Entscheidung 9). */
export interface NewsletterArrival {
  source_email: string
  n: number
  /** Median des Vorlaufs in Minuten vor dem nächsten Slot. */
  lead_p50_minutes: number
  /** 10-%-Quantil des Vorlaufs = die späten 10 % der Eingänge; kleiner = kritischer. */
  lead_p10_minutes: number
  /** Berlin-Uhrzeit zu lead_p50_minutes. */
  arrival_p50_berlin: string | null
  /** Berlin-Uhrzeit zu lead_p10_minutes (90 % der Eingänge liegen davor). */
  arrival_p90_berlin: string | null
}

/**
 * Newsletter-Eingang je Quelle (Entscheidung 9): Zeit = email_received_at,
 * Fallback collected_at, als Vorlauf in Minuten vor dem nächsten Analyse-Slot
 * (Berlin): lead = (slot − Berlin-Minute + 1440) % 1440 — der Tag beginnt am
 * Slot. Sortiert nach lead_p10_minutes aufsteigend: die kritischste Quelle
 * zuerst. WARUM nicht UTC-Minute des Tages (BEFUND 2026-10-06, Review Task
 * 15): dort stünde eine US-Quelle um 15:00 UTC (12 h vor dem Slot) ganz oben
 * und eine Quelle um 02:30 UTC (gefährdet den Slot) unten, und Quellen um
 * 00:00 UTC bekämen einen Median in der Tagesmitte. Ein Eingang nach dem Slot
 * hat fast 1440 min Vorlauf — er landet ohnehin in der Folgeanalyse.
 * Schlüssel source_email (BEFUND 2026-10-06: daily_repo hat weder
 * source_identifier noch created_at), ohne Absender → '(ohne Absender)'.
 * Zeilen ohne beide Zeitstempel fallen heraus.
 */
export function newsletterArrivalOf(
  rows: Array<{ source_email: string | null; email_received_at: string | null; collected_at: string | null }>,
  slotBerlinMinute: number,
): NewsletterArrival[] {
  const bySource = new Map<string, number[]>()
  for (const r of rows) {
    const iso = r.email_received_at ?? r.collected_at
    if (!iso) continue
    const key = r.source_email ?? '(ohne Absender)'
    const list = bySource.get(key) ?? []
    list.push((slotBerlinMinute - berlinMinutesOfDay(iso) + 1440) % 1440)
    bySource.set(key, list)
  }
  // Vorlauf → Berlin-Uhrzeit (NaN bleibt NaN → hhmm liefert null)
  const clock = (lead: number) => hhmm((slotBerlinMinute - lead + 1440) % 1440)
  return [...bySource.entries()]
    .map(([source_email, leads]) => {
      const [p50, p10] = quantiles(leads, [0.5, 0.1])
      return { source_email, n: leads.length, lead_p50_minutes: p50, lead_p10_minutes: p10, arrival_p50_berlin: clock(p50), arrival_p90_berlin: clock(p10) }
    })
    .sort((a, b) => a.lead_p10_minutes - b.lead_p10_minutes || a.source_email.localeCompare(b.source_email))
}

/**
 * Techmeme-Läufe je UTC-Tag (Entscheidung 11): llm_usage-Zeilen eines
 * use_case ab dem UTC-Tag fromUtcDay, Kosten und Aufrufe je Tag, Läufe per
 * clusterRuns(gapMs).
 * WARUM UTC-Tag: der Techmeme-Cron läuft auf UTC-Zeiten (alle 4 h zu Minute 10, Spec „Ablauf").
 * WARUM fromUtcDay: das Script lädt llm_usage ab rangeFromIso (3 h vor
 * rangeStart) — ohne Schnitt stünde der Vortag mit nur 3 h Daten als
 * scheinbar vollständiger Tag im JSON (BEFUND 2026-10-06, Review Task 15).
 */
export function techmemeByUtcDay(
  llm: LlmRow[],
  useCase: string,
  gapMs: number,
  fromUtcDay: string,
): Array<{ day: string; cost_usd: number; calls: number; runs: Array<{ start: string; end: string; calls: number }> }> {
  const byDay = new Map<string, { cost: number; isos: string[] }>()
  for (const r of llm) {
    if (r.use_case !== useCase) continue
    const iso = new Date(r.iso).toISOString()
    const day = iso.slice(0, 10)
    if (day < fromUtcDay) continue
    const e = byDay.get(day) ?? { cost: 0, isos: [] }
    e.cost += r.cost ?? 0
    e.isos.push(iso)
    byDay.set(day, e)
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, e]) => ({ day, cost_usd: e.cost, calls: e.isos.length, runs: clusterRuns([...e.isos].sort(), gapMs) }))
}
