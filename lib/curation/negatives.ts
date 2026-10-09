/**
 * Block „Gewählt, aber gestrichen" — die Betreiber-Negativmenge für den
 * Archivbrief (Spec 2026-10-05, Abschnitt „Betreiber-Negativmenge im
 * Archivbrief", behebt Befund 2 und 29).
 *
 * Quelle sind die Präzedenzfälle der Stufe 'dropped_after_selection'
 * (lib/curation/precedents.ts): Items, die der Betreiber selbst gewählt und
 * dann aus dem Post gestrichen hat. 'merged' (Similarity ≥ 0,8 zu einer
 * veröffentlichten Einheit) ist dort schon ausgeschlossen — sonst lernte das
 * Team Dubletten-Zusammenlegungen als Ablehnung.
 *
 * Phase 0 nutzt den Block nur in der Baseline-Messung
 * (scripts/measure-curation-baseline.ts, Feld `negativeBlock`); der Archivar
 * (Phase 1) hängt denselben Text in den Tagesblock des Prompts.
 */
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import { DEFAULT_DEDUP_THRESHOLD, parseEmbedding } from '@/lib/news-queue/semantic-dedup'
import { berlinDay, isoDayShift } from '@/lib/curation/precedents'

export interface NegativeUnit {
  item_id: string
  title: string
  source: string
  bundle_type_selected: string | null
  day: string
  contrast_heading: string | null
}

// Betreiber-Vorgabe 2026-10-05 (Spec „Archivbrief"): ≤20 Einheiten, davon
// ≤8 je Rolle für gelabelte, der Rest ungelabelt — ~2k Tokens.
const MAX_TOTAL = 20
const MAX_PER_ROLE = 8

// Kontrastfenster: ab DEFAULT_DEDUP_THRESHOLD (0,8) gilt ein Paar als
// dieselbe Story ('merged' in precedents.ts) — darunter bis 0,65 (inklusiv)
// ist es eine verwandte Story, die STATT der gestrichenen lief. Unter 0,65 kein Bezug.
const CONTRAST_MIN = 0.65
const CONTRAST_MAX = DEFAULT_DEDUP_THRESHOLD

// WARUM 200: .in()-Listen ab ~400 UUIDs lösen gegen Prod einen
// HeadersOverflowError aus (scripts/lib/taste-ground-truth.ts:6-11).
const IN_CHUNK = 200

/** Prompt-Hinweis wörtlich aus der Spec (Abschnitt „Betreiber-Negativmenge im Archivbrief"). */
export const NEGATIVE_BLOCK_INTRO =
  'Diese Meldungen hat der Betreiber selbst gewählt und dann aus dem Post gestrichen — sie zeigen die Grenze seines Interesses genauer als nie Gewähltes.'

// 'YYYY-MM-DD' sortiert lexikographisch = chronologisch. Array.sort ist
// stabil, Gleichstand behält also die Eingabereihenfolge.
const byDayDesc = (a: NegativeUnit, b: NegativeUnit) => b.day.localeCompare(a.day)

/**
 * Kappung des Blocks. Bei Kappung zuerst gelabelte (nach Tag absteigend,
 * ≤ maxPerRole je Rolle), dann ungelabelte (nach Tag absteigend), bis
 * maxTotal erreicht ist. Gibt dieselben Objekte zurück, die hereinkamen
 * (keine Kopien) — loadNegativeBlock hängt daran per Map Metadaten je Einheit.
 *
 * WARUM gelabelte zuerst (Betreiber-Vorgabe 2026-10-05): ein bewusst
 * vergebenes Label und die anschließende Streichung sagen mehr über die
 * Interessengrenze als eine namenlose Einzelmeldung, die im Final Cut
 * einfach keinen Platz fand.
 */
export function selectNegativeBlock(
  rows: NegativeUnit[],
  opts?: { maxTotal?: number; maxPerRole?: number },
): NegativeUnit[] {
  const maxTotal = opts?.maxTotal ?? MAX_TOTAL
  const maxPerRole = opts?.maxPerRole ?? MAX_PER_ROLE
  const labeled = rows.filter(r => r.bundle_type_selected).sort(byDayDesc)
  const unlabeled = rows.filter(r => !r.bundle_type_selected).sort(byDayDesc)

  const out: NegativeUnit[] = []
  const perRole = new Map<string, number>()
  for (const row of labeled) {
    if (out.length >= maxTotal) break
    const role = row.bundle_type_selected as string
    const n = perRole.get(role) ?? 0
    if (n >= maxPerRole) continue
    perRole.set(role, n + 1)
    out.push(row)
  }
  for (const row of unlabeled) {
    if (out.length >= maxTotal) break
    out.push(row)
  }
  return out
}

/**
 * Deutscher Prompt-Block. Je Einheit eine Zeile
 * „- <day> · <source> · <title> [<label>]" (Label nur, wenn gesetzt) und
 * darunter „  stattdessen lief: <contrast_heading>", falls im selben Post eine
 * verwandte Story veröffentlicht wurde. Leere Liste → leerer String, damit der
 * Aufrufer den Block ganz weglassen kann statt eine leere Überschrift zu senden.
 */
export function formatNegativeBlock(units: NegativeUnit[]): string {
  if (units.length === 0) return ''
  const lines = ['Gewählt, aber gestrichen', NEGATIVE_BLOCK_INTRO]
  for (const u of units) {
    const label = u.bundle_type_selected ? ` [${u.bundle_type_selected}]` : ''
    lines.push(`- ${u.day} · ${u.source} · ${u.title}${label}`)
    if (u.contrast_heading) lines.push(`  stattdessen lief: ${u.contrast_heading}`)
  }
  return lines.join('\n')
}

interface PrecedentRowLite { item_id: string; day: string; bundle_type_selected: string | null; post_id: string | null }
interface QueueRowLite { id: string; title: string; source_display_name: string | null; source_identifier: string; daily_repo_id: string | null }
interface UnitRowLite { post_id: string; heading: string; embedding: unknown }

/**
 * Lädt den Block aus curation_precedents (stage 'dropped_after_selection')
 * der letzten `days` Tage vor `asOf` (Berlin-Tag, Default heute). as-of
 * heißt `day < asOf`: der Backtest eines Tages darf nur sehen, was VOR
 * diesem Tag gestrichen wurde (Spec „im Backtest as-of").
 *
 * Reihenfolge der Reads: curation_precedents → news_queue (Titel/Quelle) →
 * daily_repo (Item-Embedding, nur für die gekappte Menge) → published_units
 * (Einheiten derselben Posts). Kontrast = Heading mit höchster Cosine in
 * [CONTRAST_MIN, CONTRAST_MAX) — ≥ 0,8 wäre 'merged' und steht gar nicht
 * in dieser Stufe. Ohne Embedding (Techmeme-/Manual-Items haben keine
 * daily_repo_id) bleibt der Kontrast null.
 *
 * Wirft bei DB-Fehler (Script-Pfad, Muster loadEventsForItems): ein stiller
 * Leerblock sähe in der Baseline wie „nichts gestrichen" aus.
 */
export async function loadNegativeBlock(
  supabase: SupabaseAdmin,
  opts: { days: number; asOf?: string },
): Promise<{ text: string; units: NegativeUnit[]; approxTokens: number }> {
  const asOf = opts.asOf ?? berlinDay(new Date().toISOString())
  const since = isoDayShift(asOf, -opts.days)

  const { data: prec, error: precError } = await supabase
    .from('curation_precedents')
    .select('item_id, day, bundle_type_selected, post_id')
    .eq('stage', 'dropped_after_selection')
    .gte('day', since)
    .lt('day', asOf)
    .order('day', { ascending: false })
  if (precError) throw new Error(`curation_precedents: ${precError.message}`)
  const precedents = (prec ?? []) as PrecedentRowLite[]
  if (precedents.length === 0) return { text: '', units: [], approxTokens: 0 }

  // Titel/Quelle aus news_queue. Präzedenzfälle überleben Löschungen
  // (kein FK, Vertrag 2.1), der Titel nicht — gelöschte Items fallen aus dem Block.
  const queueById = new Map<string, QueueRowLite>()
  const itemIds = precedents.map(p => p.item_id)
  for (let i = 0; i < itemIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('id, title, source_display_name, source_identifier, daily_repo_id')
      .in('id', itemIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`news_queue: ${error.message}`)
    for (const row of (data ?? []) as QueueRowLite[]) queueById.set(row.id, row)
  }

  // WARUM post_id je Einheit statt je item_id: curation_precedents ist nur auf
  // (day, item_id) unique (Vertrag 2.1) — dasselbe Item kann an zwei Tagen aus
  // zwei verschiedenen Posts gestrichen worden sein, und jede Einheit braucht
  // den Kontrast aus IHREM Post. selectNegativeBlock gibt dieselben Objekte
  // zurück, die Map bleibt also nach der Kappung gültig.
  const candidates: NegativeUnit[] = []
  const postOf = new Map<NegativeUnit, string | null>()
  for (const p of precedents) {
    const q = queueById.get(p.item_id)
    if (!q) continue
    const candidate: NegativeUnit = {
      item_id: p.item_id,
      title: q.title,
      source: q.source_display_name ?? q.source_identifier,
      bundle_type_selected: p.bundle_type_selected,
      day: p.day,
      contrast_heading: null,
    }
    candidates.push(candidate)
    postOf.set(candidate, p.post_id)
  }
  const missing = precedents.length - candidates.length
  if (missing > 0) console.warn(`[Curation] ${missing} Präzedenzfälle ohne news_queue-Zeile übersprungen`)

  // Erst kappen, dann Embeddings laden: Kontrast kostet zwei weitere Reads
  // und lohnt nur für die ≤20 Einheiten, die im Block landen.
  const units = selectNegativeBlock(candidates)

  const repoIds = [...new Set(
    units.map(u => queueById.get(u.item_id)?.daily_repo_id).filter((id): id is string => !!id),
  )]
  const embByRepo = new Map<string, number[]>()
  for (let i = 0; i < repoIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('daily_repo')
      .select('id, embedding')
      .in('id', repoIds.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`daily_repo: ${error.message}`)
    for (const row of (data ?? []) as Array<{ id: string; embedding: unknown }>) {
      const emb = parseEmbedding(row.embedding)
      if (emb.length > 0) embByRepo.set(row.id, emb)
    }
  }

  const unitsByPost = new Map<string, Array<{ heading: string; embedding: number[] }>>()
  if (embByRepo.size > 0) {
    const postIds = [...new Set(units.map(u => postOf.get(u)).filter((id): id is string => !!id))]
    for (let i = 0; i < postIds.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from('published_units')
        .select('post_id, heading, embedding')
        .in('post_id', postIds.slice(i, i + IN_CHUNK))
      if (error) throw new Error(`published_units: ${error.message}`)
      for (const row of (data ?? []) as UnitRowLite[]) {
        const emb = parseEmbedding(row.embedding)
        if (emb.length === 0) continue
        const list = unitsByPost.get(row.post_id) ?? []
        list.push({ heading: row.heading, embedding: emb })
        unitsByPost.set(row.post_id, list)
      }
    }
  }

  for (const u of units) {
    const repoId = queueById.get(u.item_id)?.daily_repo_id
    const emb = repoId ? embByRepo.get(repoId) : undefined
    const postId = postOf.get(u)
    if (!emb || !postId) continue
    let best: { heading: string; sim: number } | null = null
    for (const pu of unitsByPost.get(postId) ?? []) {
      // cosineSimilarity wirft bei ungleicher Dimension (generator.ts:137);
      // published_units kann in der Übergangszeit Zeilen ohne 768er-Vektor haben.
      if (pu.embedding.length !== emb.length) continue
      const sim = cosineSimilarity(emb, pu.embedding)
      if (sim < CONTRAST_MIN || sim >= CONTRAST_MAX) continue
      if (!best || sim > best.sim) best = { heading: pu.heading, sim }
    }
    u.contrast_heading = best?.heading ?? null
  }

  const text = formatNegativeBlock(units)
  // Grobe Schätzung (deutscher Fließtext ≈ 3,5 Zeichen je Token) — reicht,
  // um die ~2k-Token-Vorgabe der Spec in der Baseline zu plausibilisieren.
  return { text, units, approxTokens: Math.ceil(text.length / 3.5) }
}
