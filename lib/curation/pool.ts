/**
 * Tages-Pool as-of: identische Logik für den Shadow-Lauf (asOf = jetzt) und
 * für einen Backtest-Tag (asOf = ein vergangener Kickoff, Vertrag 2.10) —
 * loadPoolAsOf kennt den Unterschied nur über isLiveAsOf.
 *
 * WARUM eigenes Modul statt Erweiterung von baseline-day.ts: Phase-0-Module
 * werden nicht geändert (Vertrag §0). poolExclusionAsOf, loadPostPublishTimes,
 * eventsAsOf, loadRepoEmbeddings, isJunkTitle, isHandItem, loadEventsForItems,
 * parseEmbedding und prepareTextForEmbedding sind rein wiederverwendet; neu
 * ist nur, was Phase 1 zusätzlich braucht: Excerpts per RPC statt Volltext,
 * ein Embedding-Cache für Items ohne daily_repo-Zeile (Techmeme, manuell
 * eingestellt), und die Techmeme-Story-Gruppierung für den Scout (Task 6).
 */
import { loadRepoEmbeddings } from '@/lib/curation/baseline-day'
import { eventsAsOf, loadPostPublishTimes, poolExclusionAsOf } from '@/lib/curation/precedents'
import { isHandItem } from '@/lib/curation/origin'
import { loadEventsForItems, type QueueEventRow, type SupabaseAdmin } from '@/lib/news-queue/events'
import { isJunkTitle } from '@/lib/news-queue/service'
import { parseEmbedding } from '@/lib/news-queue/semantic-dedup'
import { prepareTextForEmbedding } from '@/lib/embeddings/generator'
import { createEmbedFailGuard, type EmbedTexts, type PostOutcome } from '@/scripts/lib/published-units-backfill'
import type { PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

export interface PoolOptions {
  asOf: string
  minContentLength: number
  windowHours: number
}

/** news_queue-Spalten, die der Pool braucht — exakt der SELECT in POOL_SELECT. */
export interface PoolRawRow {
  id: string
  title: string
  source_identifier: string
  source_display_name: string | null
  total_score: number | string | null
  bundle_type: string | null
  metadata: Record<string, unknown> | null
  content_length: number | null
  daily_repo_id: string | null
  queued_at: string
  expires_at: string | null
  used_in_post_id: string | null
  status: string
  selected_at: string | null
  source_pub_rate: number | string | null
}

// WARUM ein Strang statt Verkettung: `+` zweier String-Literale weitet den
// Typ auf `string` (kein Template-Literal), supabase-js kann die Spalten
// dann nicht mehr aus dem Select-String ableiten und liefert GenericStringError[].
export const POOL_SELECT = 'id, title, source_identifier, source_display_name, total_score, bundle_type, metadata, content_length, daily_repo_id, queued_at, expires_at, used_in_post_id, status, selected_at, source_pub_rate'

// WARUM 1000/2000: PostgREST kappt jede Antwort still bei max_rows = 1000
// (wie POOL_PAGE/POOL_LIMIT in baseline-day.ts) — Seiten à 1000 bis zur
// Obergrenze 2000, truncated meldet, wenn die Obergrenze erreicht wurde.
const PAGE = 1000
const LIMIT = 2000
// WARUM 200: .in()-Listen ab ~400 UUIDs lösen gegen Prod einen
// HeadersOverflowError aus (scripts/lib/taste-ground-truth.ts:7-11).
const IN_CHUNK = 200
// get_pool_excerpts kappt den Volltext auf diese Länge (Migration Task 1).
const EXCERPT_CHARS = 1500
// WARUM 16 statt 200 wie bei den DB-Scheiben: Batches gehen an die
// Embedding-API (Netzwerk, Kosten je Aufruf), nicht an Postgres — ein Fehler
// betrifft hier höchstens 16 statt 200 Items, und createEmbedFailGuard zählt
// Aufrufe, nicht Items.
const EMBED_BATCH = 16
const LIVE_WINDOW_MS = 15 * 60_000

/** Shadow-Lauf (asOf ≈ jetzt) vs. Backtest-Tag (asOf lange vorbei) — |now − asOf| < 15 min. */
export function isLiveAsOf(asOf: string, now: number = Date.now()): boolean {
  return Math.abs(now - Date.parse(asOf)) < LIVE_WINDOW_MS
}

/** metadata.techmeme === true mit nicht-leerem techmeme_story (Techmeme-Job, Task 1 Migration). */
function isTechmeme(metadata: Record<string, unknown> | null): boolean {
  if (!metadata || metadata.techmeme !== true) return false
  return typeof metadata.techmeme_story === 'string' && metadata.techmeme_story.length > 0
}

/**
 * Hand-Kandidat = selected_at gesetzt und <= asOf; live zusätzlich jedes
 * aktuell status='selected' Item (das selected_at des laufenden Nachtlaufs
 * kann knapp NACH asOf liegen, z. B. ein Select, der zwischen Kickoff-asOf
 * und dem tatsächlichen Pool-Laden passiert — isHandItem entscheidet später
 * über eventsAsOf, ob es auch zeitlich Hand ist).
 */
function isHandCandidate(row: PoolRawRow, asOf: string, live: boolean): boolean {
  if (live && row.status === 'selected') return true
  return !!row.selected_at && Date.parse(row.selected_at) <= Date.parse(asOf)
}

/**
 * Reine as-of-Filterung ohne DB-Zugriff: used_earlier/expired über
 * poolExclusionAsOf (Vertrag 2.10, BEFUND 2026-10-08 — das 48-h-Fenster ist
 * zeitlich as-of, der Status in news_queue nicht). skipped nur live
 * ausgeschlossen: im Backtest ist ein Skip von heute für einen Tag vor
 * Monaten nicht rekonstruierbar (news_queue kennt nur den HEUTIGEN Status) —
 * ein historisches Item bleibt also im Pool, als hätte es niemand
 * übersprungen. Techmeme-Items und Hand-Kandidaten überstehen Junk- und
 * Längenfilter: ein vom Betreiber gewähltes oder von Techmeme gelistetes
 * Item ist kein Falsch-Positiv der Heuristik, sondern eine echte
 * Betreiber-Entscheidung, die der Pool nicht stillschweigend verwerfen darf.
 */
export function filterPoolAsOf(
  rows: PoolRawRow[],
  asOf: string,
  postTimeById: Map<string, string>,
  opts: { minContentLength: number; live: boolean },
): { kept: PoolRawRow[]; excluded: PoolSnapshot['excluded'] } {
  const excluded = { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 }
  const kept: PoolRawRow[] = []
  for (const row of rows) {
    const exclusion = poolExclusionAsOf({ id: row.id, expires_at: row.expires_at, used_in_post_id: row.used_in_post_id }, asOf, '', postTimeById)
    if (exclusion === 'used_earlier') {
      excluded.used_earlier++
      continue
    }
    if (exclusion === 'expired') {
      excluded.expired++
      continue
    }
    if (opts.live && row.status === 'skipped') {
      excluded.skipped++
      continue
    }
    const protectedItem = isTechmeme(row.metadata) || isHandCandidate(row, asOf, opts.live)
    if (!protectedItem && isJunkTitle(row.title)) {
      excluded.junk++
      continue
    }
    const contentLength = Number(row.content_length) || 0
    if (!protectedItem && contentLength < opts.minContentLength) {
      excluded.short++
      continue
    }
    kept.push(row)
  }
  return { kept, excluded }
}

/** news_queue-Zeile → PoolSnapshotItem; Excerpt und Hand-Begriff kommen von außen (RPC bzw. Events). */
export function toSnapshotItem(row: PoolRawRow, excerpt: string, hand: boolean): PoolSnapshotItem {
  const metadata = row.metadata
  const techmeme = isTechmeme(metadata)
  return {
    id: row.id,
    title: row.title,
    source_identifier: row.source_identifier,
    source_display_name: row.source_display_name,
    total_score: Number(row.total_score) || 0,
    bundle_type: row.bundle_type,
    metadata,
    content_length: row.content_length,
    daily_repo_id: row.daily_repo_id,
    queued_at: row.queued_at,
    source_pub_rate: Number(row.source_pub_rate) || 0,
    excerpt,
    hand,
    techmeme_story: techmeme ? (metadata!.techmeme_story as string) : null,
    techmeme_story_index: techmeme && typeof metadata!.techmeme_story_index === 'number' ? (metadata!.techmeme_story_index as number) : null,
  }
}

/**
 * Techmeme-Items nach techmeme_story gruppiert (Scout-Eingabe, Task 6):
 * index = kleinster techmeme_story_index der Gruppe (Rang der Story auf der
 * Startseite), member_ids nach total_score absteigend (bestes Mitglied
 * zuerst), Gruppen nach index aufsteigend.
 */
export function techmemeStoriesOf(items: PoolSnapshotItem[]): PoolSnapshot['techmemeStories'] {
  const byStory = new Map<string, PoolSnapshotItem[]>()
  for (const item of items) {
    if (!item.techmeme_story) continue
    const members = byStory.get(item.techmeme_story)
    if (members) members.push(item)
    else byStory.set(item.techmeme_story, [item])
  }
  const stories = [...byStory.entries()].map(([story, members]) => ({
    story,
    index: Math.min(...members.map((m) => m.techmeme_story_index ?? Number.MAX_SAFE_INTEGER)),
    member_ids: [...members].sort((a, b) => b.total_score - a.total_score).map((m) => m.id),
  }))
  return stories.sort((a, b) => a.index - b.index)
}

/**
 * Tages-Pool as-of laden: Fenster seitenweise lesen, as-of filtern, Excerpts
 * per RPC holen, Hand-Begriff über die Events der Hand-Kandidaten bestimmen.
 */
export async function loadPoolAsOf(supabase: SupabaseAdmin, opts: PoolOptions): Promise<PoolSnapshot> {
  const windowFrom = new Date(Date.parse(opts.asOf) - opts.windowHours * 3_600_000).toISOString()
  const raw: PoolRawRow[] = []
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const { data, error } = await supabase
      .from('news_queue')
      .select(POOL_SELECT)
      .gte('queued_at', windowFrom)
      .lt('queued_at', opts.asOf)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`news_queue: ${error.message}`)
    const page = (data ?? []) as PoolRawRow[]
    raw.push(...page)
    if (page.length < PAGE) break
  }
  const live = isLiveAsOf(opts.asOf)
  const usedPostIds = [...new Set(raw.map((r) => r.used_in_post_id).filter((id): id is string => !!id))]
  const postTimeById = await loadPostPublishTimes(supabase, usedPostIds)
  const { kept, excluded } = filterPoolAsOf(raw, opts.asOf, postTimeById, { minContentLength: opts.minContentLength, live })

  // WARUM per RPC statt direkt `content` lesen: der Volltext ist teils
  // mehrere Kilobyte je Item, bis zu 2000 Items je Pool — get_pool_excerpts
  // kappt serverseitig auf 1500 Zeichen (Migration Task 1), damit der
  // Snapshot (in curation_runs.pool, jsonb) klein bleibt und die Scout-Cards
  // (Task 6) nicht den vollen Artikeltext als Prompt-Kontext bekommen.
  const excerptById = new Map<string, string>()
  for (let i = 0; i < kept.length; i += IN_CHUNK) {
    const ids = kept.slice(i, i + IN_CHUNK).map((r) => r.id)
    const { data, error } = await supabase.rpc('get_pool_excerpts', { ids, max_chars: EXCERPT_CHARS })
    if (error) throw new Error(`get_pool_excerpts: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; excerpt: string | null }>) excerptById.set(r.id, r.excerpt ?? '')
  }

  // Hand-Begriff gilt ZUM ZEITPUNKT asOf (eventsAsOf), nicht zum Ladezeitpunkt —
  // ein später vom Nachtlauf neu gewähltes Item verlöre sonst rückwirkend
  // seinen Hand-Status (wie precedents.ts, BEFUND 2026-10-06 Fallstrick 5).
  const handCandidates = kept.filter((r) => isHandCandidate(r, opts.asOf, live))
  const eventsByItem = handCandidates.length
    ? await loadEventsForItems(supabase, handCandidates.map((r) => r.id))
    : new Map<string, QueueEventRow[]>()
  const handIds = handCandidates
    .filter((r) => isHandItem({ id: r.id, metadata: r.metadata }, eventsAsOf(eventsByItem.get(r.id) ?? [], opts.asOf)))
    .map((r) => r.id)
  const handSet = new Set(handIds)

  const items = kept.map((r) => toSnapshotItem(r, excerptById.get(r.id) ?? '', handSet.has(r.id)))
  return {
    asOf: opts.asOf,
    windowFrom,
    items,
    truncated: raw.length >= LIMIT,
    excluded,
    handIds,
    techmemeStories: techmemeStoriesOf(items),
  }
}

/**
 * Embeddings der Pool-Items: zuerst daily_repo (Synthese-Pipeline hat die
 * meisten Items schon embeddet), dann der Cache curation_item_embeddings
 * (Techmeme- und manuell eingestellte Items ohne daily_repo-Zeile, aus einem
 * früheren Lauf desselben Tages), erst der Rest frisch — Reihenfolge, weil
 * jede Stufe teurer ist als die vorige (Spalten-Scan < Cache-Select <
 * Embedding-API).
 */
export async function loadPoolEmbeddings(
  supabase: SupabaseAdmin,
  items: PoolSnapshotItem[],
  embed: EmbedTexts,
): Promise<{ embeddings: Map<string, number[]>; generated: number; failed: number }> {
  const embeddings = new Map<string, number[]>()

  const repoIds = items.map((i) => i.daily_repo_id).filter((id): id is string => !!id)
  const repoEmbeddingById = await loadRepoEmbeddings(supabase, repoIds)
  for (const item of items) {
    const embedding = item.daily_repo_id ? repoEmbeddingById.get(item.daily_repo_id) : undefined
    if (embedding && embedding.length > 0) embeddings.set(item.id, embedding)
  }

  const afterRepo = items.filter((i) => !embeddings.has(i.id))
  for (let i = 0; i < afterRepo.length; i += IN_CHUNK) {
    const ids = afterRepo.slice(i, i + IN_CHUNK).map((item) => item.id)
    const { data, error } = await supabase.from('curation_item_embeddings').select('item_id, embedding').in('item_id', ids)
    if (error) throw new Error(`curation_item_embeddings: ${error.message}`)
    for (const r of (data ?? []) as Array<{ item_id: string; embedding: unknown }>) {
      const embedding = parseEmbedding(r.embedding)
      if (embedding.length > 0) embeddings.set(r.item_id, embedding)
    }
  }

  const todo = afterRepo.filter((i) => !embeddings.has(i.id))
  const guard = createEmbedFailGuard()
  let generated = 0
  let failed = 0
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH)
    try {
      const vectors = await embed(batch.map((item) => prepareTextForEmbedding(item.title, item.excerpt)))
      const cacheRows: Array<{ item_id: string; embedding: string }> = []
      for (let j = 0; j < batch.length; j++) {
        const vector = vectors[j]
        if (vector && vector.length > 0) {
          embeddings.set(batch[j].id, vector)
          cacheRows.push({ item_id: batch[j].id, embedding: `[${vector.join(',')}]` })
          generated++
        } else {
          failed++
        }
      }
      if (cacheRows.length > 0) {
        const { error } = await supabase.from('curation_item_embeddings').upsert(cacheRows, { onConflict: 'item_id' })
        // Cache-Schreibfehler sind best-effort: das Embedding steht schon in
        // der Map und wirkt in diesem Lauf, nur der naechste Lauf muesste es
        // erneut erzeugen.
        if (error) console.warn(`[Curation] curation_item_embeddings upsert: ${error.message}`)
      }
      // 'written' ist hier nur das Erfolgssignal des Guards (Vertrag: die
      // PublishedUnit-Form von createEmbedFailGuard passt nicht zu
      // Pool-Items — record() liest nur outcome.kind und, bei 'written',
      // outcome.units.length > 0, der Inhalt von units bleibt ungenutzt).
      guard.record({ kind: 'written', units: batch, embedded: cacheRows.length } as unknown as PostOutcome)
    } catch (err) {
      failed += batch.length
      const message = err instanceof Error ? err.message : String(err)
      const abort = guard.record({ kind: 'embed_failed', units: batch, error: message } as unknown as PostOutcome)
      if (abort) throw new Error(`embeddings: ${guard.consecutive()} Fehler in Folge — ${message}`)
    }
  }

  return { embeddings, generated, failed }
}
