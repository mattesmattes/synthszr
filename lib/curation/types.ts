import type { CurationTier } from '@/lib/utils/markdown-to-tiptap'
export type { CurationTier }

export type CurationRole = 'topic' | 'recap' | 'deep_dive' | 'cover_story'
export const CURATION_ROLES: readonly CurationRole[] = ['topic', 'recap', 'deep_dive', 'cover_story']
export type RunMode = 'shadow' | 'backtest'
export type RunStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
export type RunPhase = 'pool' | 'scout' | 'cluster' | 'archive' | 'compose' | 'units' | 'finished'
export type BriefMode = 'none' | 'precedents-only' | 'full'
export type Degradation = 'pool_embeddings' | 'scout_partial' | 'archive' | 'critic' | 'compose_fallback' | 'budget'

/**
 * Abgleichfenster der Rekonziliation: der Post des Tages zaehlt, wenn er bis
 * 24 h nach `asof` veroeffentlicht ist (Spec „Rekonziliation": same-day,
 * ≤ 24 h). Hier statt in reconcile.ts, weil service.ts (getRunsToReconcile)
 * dieselbe Grenze braucht und reconcile.ts service.ts importiert — eine
 * Quelle ohne Import-Zyklus (Final-Review 2026-10-14 (R21)).
 */
export const MATCH_WINDOW_MS = 24 * 3600 * 1000

/** Ein Item des Tages-Pools, as-of eingefroren (Snapshot auf dem Run). */
export interface PoolSnapshotItem {
  id: string
  title: string
  source_identifier: string
  source_display_name: string | null
  total_score: number
  bundle_type: string | null
  metadata: Record<string, unknown> | null
  content_length: number | null
  daily_repo_id: string | null
  queued_at: string
  source_pub_rate: number
  excerpt: string                     // aus get_pool_excerpts, max 1500 Zeichen
  hand: boolean                       // isHandItem as-of
  techmeme_story: string | null
  techmeme_story_index: number | null
}
export interface PoolSnapshot {
  asOf: string
  windowFrom: string
  items: PoolSnapshotItem[]
  truncated: boolean
  excluded: { used_earlier: number; expired: number; skipped: number; junk: number; short: number }
  handIds: string[]
  techmemeStories: Array<{ story: string; index: number; member_ids: string[] }>
}

export interface ScoutCard { id: string; core: string }

export interface ClusterResult {
  storyKeyOf: Record<string, string>                 // item_id → story_key (Anfuehrer-ID oder 'tm:<story>')
  clusters: Record<string, string[]>                 // story_key → member ids (Reihenfolge = Rang im Cluster)
  related: Array<[string, string, number]>           // [story_key_a, story_key_b, sim] mit 0.65 <= sim < 0.8
}

export interface ArchiveMeta {
  coverage_hits: number; followups: number; precedents: number; negatives: number
  pairs: number; panel_accept: number; panel_reject: number; approx_tokens: number; missing: string[]
}
export interface ArchiveBrief {
  systemPrefix: string                               // Betreiber-Regeln, Rollen-Soft-Range, Techmeme-Quote (gecacht)
  dayBlock: string                                   // Coverage, Praezedenzen, Negativ-Block, Paare, Panel
  precedentIds: Record<string, string>               // 'P3' → published_units.id
  meta: ArchiveMeta
}

export interface ComposeUnit {
  unit_key: string
  member_ids: string[]
  story_key: string
  role: CurationRole | null
  rank: number                                       // 1..n je Tier
  tier: CurationTier
  reason: string                                     // <= 160 Zeichen
  alternative: string | null
  precedent_ids: string[]                            // published_units.id
  is_hand: boolean
}
export interface TechmemeDecision { story: string; decision: 'keep_topic' | 'promote_cover' | 'reduce_to_best_source' | 'drop' }
export interface HandStoryDecision { story_key: string; decision: 'inherit_label' | 'story'; label: CurationRole | null }
export interface ComposePlan {
  thesis: string
  units: ComposeUnit[]
  techmeme_decisions: TechmemeDecision[]
  hand_story_decisions: HandStoryDecision[]
  fixes: string[]                                    // was validatePlan korrigiert hat
  source: 'model' | 'baseline'
}

export interface Critique { hard: string[]; soft: string[]; model_hard: string[]; model_soft: string[] }

export interface BaselineLists { total_score: Record<string, string[]> }   // '10' | '20' → IDs (capByUnits je K)

export interface RunLogEntry { at: string; text: string; ok: boolean }

export type UnitOutcome = 'kept' | 'relabeled' | 'merged' | 'dropped_after_selection' | 'dropped_never_selected' | 'added'

export interface RunMetrics {
  attribution: 'job' | 'published_at' | 'created_at_day' | 'none'
  published_units: number
  published_attributable: number                     // mit member_ids oder Embedding
  plan: { recommended: number; bench: number; held: number }
  unit_recall_20: number                             // (recommended ∪ bench) ∩ published / published, Story-Ebene
  unit_recall_id_20: number                          // strenge ID-Variante
  setzlisten_recall_10: number
  setzlisten_precision_10: number
  duplicate_rate_recommended: number
  published_covered: number                          // Abschnitte mit mindestens einem Member im Pool-Snapshot
  unit_recall_covered_20: number                     // Treffer auf abgedeckte Abschnitte / abgedeckte (Gate-Boden, Betreiber 2026-10-15)
  setzlisten_recall_covered_10: number
  cut_rate: number                                   // Setzlisten-Einheiten mit outcome dropped_after_selection / Setzliste
  additions: number
  additions_rate: number                             // added / published
  hand_stories: number
  held_rate: number                                  // held / hand_stories
  baseline_total_score_unit_recall_20: number | null
  baseline_total_score_recall_10: number | null
  diff_vs_total_score_20: number | null
  outcomes: Record<UnitOutcome, number>
}

export interface RunRow {
  id: string; day: string; mode: RunMode; asof: string; status: RunStatus; phase: RunPhase
  brief_mode: BriefMode; attempts: number; last_advanced_at: string | null; cancel_requested: boolean
  /** Backtest-Arm (Final-Review 2026-10-14 (R25)) — trennt Ablationsstufen und Iterationen; Shadow: null. */
  label: string | null
  log: RunLogEntry[]; degraded: Degradation[]; budget_usd: number; spend_usd: number; compose_attempts: number
  pool: PoolSnapshot | null; cards: ScoutCard[] | null; story_keys: ClusterResult | null
  brief: ArchiveBrief | null; baseline: BaselineLists | null; plan: ComposePlan | null; critique: Critique | null
  reconciled_at: string | null; matched_post_id: string | null; matched_job_id: string | null; metrics: RunMetrics | null
  model_scout: string | null; model_editor: string | null; model_critic: string | null
  error_message: string | null; created_at: string; finished_at: string | null
}
/** Leichte Listenansicht ohne die schweren JSON-Spalten. */
export type RunSummary = Omit<RunRow, 'pool' | 'cards' | 'story_keys' | 'brief' | 'plan' | 'critique' | 'log'>
export const RUN_SUMMARY_COLUMNS =
  'id, day, mode, asof, status, phase, brief_mode, label, attempts, last_advanced_at, cancel_requested, degraded, budget_usd, spend_usd, compose_attempts, baseline, reconciled_at, matched_post_id, matched_job_id, metrics, model_scout, model_editor, model_critic, error_message, created_at, finished_at'

export interface UnitRow {
  id: string; run_id: string; unit_key: string; member_ids: string[]; story_key: string | null
  role: string | null; rank: number | null; tier: CurationTier | null; reason: string | null; alternative: string | null
  precedent_ids: string[]; is_hand: boolean; panel_action: string | null; panel_at: string | null
  outcome: UnitOutcome | null; final_role: string | null; final_rank: number | null
  matched_post_id: string | null; matched_heading: string | null; similarity: number | null; created_at: string
}
export type UnitInsert = Omit<UnitRow, 'id' | 'run_id' | 'created_at'>

export interface CurationSettings {
  shadow_enabled: boolean          // Default false — [FREIGABE] schaltet scharf
  kickoff_utc: string              // 'HH:MM', Default '04:25'
  budget_usd: number               // je Run, Default 4
  daily_budget_usd: number         // alle Runs eines Tages, Default 12
  min_content_length: number       // Default 500 (ranking-service.ts:25); UI-Slider 1000 ist nicht persistiert
  pool_window_hours: number        // Default 48
  scout_batch_size: number         // Default 25
  critic_enabled: boolean          // Default true (Sonnet-Kritiker zusaetzlich zur deterministischen Pruefung)
}
export const DEFAULT_CURATION_SETTINGS: CurationSettings = {
  shadow_enabled: false, kickoff_utc: '04:25', budget_usd: 4, daily_budget_usd: 12,
  min_content_length: 500, pool_window_hours: 48, scout_batch_size: 25, critic_enabled: true,
}
