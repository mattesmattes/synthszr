/**
 * Präzedenzfälle je Tag und Item — die drei Label-Stufen der Spec plus
 * `merged` (Spec „Datenquellen und Lernen", Betreiber-Vorgabe 2026-10-05).
 *
 * BEFUND 2026-10-06: Die stärkste Lernquelle ist „selected, aber
 * gestrichen" — Items, die der Betreiber im manuellen Job hatte
 * (article_jobs.selected_items) und die im veröffentlichten Post fehlen.
 * Fallen, die diese Datei entschärft:
 *
 *   1. Ein gestrichenes Item, das einem veröffentlichten Heading mit
 *      Cosine >= 0,8 entspricht, ist eine ZUSAMMENLEGUNG (zwei Quellen,
 *      ein Abschnitt), keine Ablehnung. Schwelle = DEFAULT_DEDUP_THRESHOLD,
 *      dieselbe wie im Nachtlauf-Dedup.
 *   2. Ein Item, das zwar im Job stand, aber nicht vom Betreiber gewählt
 *      wurde (unberührtes Techmeme-Thema, Hand-Begriff Vertrag 2.3), hat er
 *      auch nicht „gestrichen" — es ist nur „nie gewählt".
 *   3. cosineSimilarity (lib/embeddings/generator.ts:151) liefert NaN bei
 *      einem Null-Vektor. NaN darf nie als `best` stehen bleiben, sonst
 *      ist jeder spätere Vergleich false und der ganze Tag kippt auf
 *      dropped_after_selection.
 *   4. Altposts tragen H2 ohne Queue-Marker (Prod-Read 2026-10-06: 171 von
 *      858 H2 an 78 von 91 Tagen). Ein Hand-Item, das unter so einem Heading
 *      lief, findet keine ID — ohne Gegenmaßnahme landete es als
 *      dropped_after_selection in der Negativmenge.
 *   5. Der Hand-Status gilt ZUM ZEITPUNKT des Jobs (eventsAsOf): ein später
 *      vom Nachtlauf neu gewähltes Item verlöre sonst rückwirkend seinen
 *      Hand-Status (Task 4 Entscheidung 2: jüngstes Herkunfts-Event zählt).
 *   6. Ein reiner Upsert mischte bei erneutem Lauf Zeilen alter und neuer
 *      Jobs desselben Tages — replacePrecedentDay ersetzt den Tag.
 *
 * classifyPrecedents, pickPrecedentJobs, eventsAsOf, berlinDay,
 * precedentSelectedItems, buildPrecedentSelected, precedentJobsSince,
 * staleDaysOf und parseSinceArg sind rein (kein Supabase, keine
 * Embedding-Erzeugung); Task 15 importiert einen Teil davon für die Baseline.
 * Das Script bleibt eine dünne Lade-/Schreibschleife — jede Entscheidung,
 * welche Tage es ersetzt oder leert, steht hier und ist getestet.
 * replacePrecedentDay bekommt den Client als Parameter (Vertrag 0) und ist
 * der einzige Schreibzugriff. Embeddings kommen fertig aus daily_repo
 * (Items) und published_units (Einheiten), die Hand-Entscheidung aus
 * isHandItem (lib/curation/origin.ts).
 *
 * isoDayShift (Controller-Ruling K4, Nachtrag zu Vertrag 2.7): Berlin-
 * unabhängige Tagesverschiebung eines ISO-Tages. Task 12 und Task 15
 * importieren diesen Helfer von hier statt eigene Kopien zu bauen.
 */
import { isHandItem } from '@/lib/curation/origin'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import { DEFAULT_DEDUP_THRESHOLD } from '@/lib/news-queue/semantic-dedup'
import type { QueueEventRow, SupabaseAdmin } from '@/lib/news-queue/events'

export type PrecedentStage = 'published' | 'dropped_after_selection' | 'pending_never_selected' | 'merged'

export interface PrecedentSelected {
  id: string
  /** Label zum Zeitpunkt der Auswahl (article_jobs.selected_items[].bundle_type). */
  bundle_type: string | null
  /** daily_repo.embedding des Items; null bei Techmeme/ohne daily_repo_id. */
  embedding: number[] | null
  /** isHandItem(item, eventsAsOf(events, job.created_at)) — vom Script berechnet. */
  isHand: boolean
}

export interface PrecedentUnit {
  position: number
  heading: string
  bundleType: string | null
  /** leer = H2 ohne Queue-Marker (Altbestand) → „nicht attribuierbar". */
  memberIds: string[]
  /**
   * published_units.embedding (Text: Heading + erster Absatz, Task 10);
   * null nur, wenn Heading UND erster Absatz leer waren oder das Embedding
   * im Task-10-Lauf fehlschlug. Ohne ersten Absatz: reines Heading-Embedding.
   */
  embedding: number[] | null
}

export interface PrecedentInputs {
  /** Berlin-Datum von article_jobs.created_at, 'YYYY-MM-DD'. */
  day: string
  jobId: string
  postId: string
  /** aus article_jobs.selected_items[].id, angereichert aus news_queue */
  selected: PrecedentSelected[]
  /** news_queue.id mit queued_at in [job.created_at − 48h, job.created_at), nicht in selected */
  poolNeverSelected: string[]
  /** published_units des Posts */
  publishedUnits: PrecedentUnit[]
}

export interface PrecedentRow {
  day: string
  item_id: string
  story_key: string | null
  stage: PrecedentStage
  bundle_type_selected: string | null
  bundle_type_published: string | null
  job_id: string
  post_id: string
  matched_heading: string | null
  similarity: number | null
}

/** Cosine nur für beidseitig nicht-leere, gleich lange Vektoren; sonst oder bei NaN → null. */
function safeCosine(a: number[] | null, b: number[] | null): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null
  const s = cosineSimilarity(a, b)
  return Number.isFinite(s) ? s : null
}

/**
 * Ähnlichste Einheit zu einem Item-Embedding. WARUM safeCosine:
 * cosineSimilarity wirft bei ungleicher Länge und liefert NaN bei
 * Null-Vektor — ein kaputter Vektor in EINER Einheit darf weder den Tag
 * abbrechen noch als `best` alle weiteren Vergleiche blockieren.
 */
function bestMatch(embedding: number[], units: PrecedentUnit[]): { unit: PrecedentUnit; similarity: number } | null {
  let best: { unit: PrecedentUnit; similarity: number } | null = null
  for (const unit of units) {
    const similarity = safeCosine(embedding, unit.embedding)
    if (similarity === null) continue
    if (!best || similarity > best.similarity) best = { unit, similarity }
  }
  return best
}

/**
 * Hand-Items ohne ID-Treffer und ohne merged, die vermutlich unter einem
 * Heading OHNE Marker liefen (Entscheidung 7). Je nicht attribuierbarer
 * Einheit höchstens EIN Kandidat, eins-zu-eins, global nach absteigender
 * Cosine (Gleichstand: kleinere Position, dann frühere Eingabe — WARUM
 * explizit: Array.sort ist stabil, ohne Positionsregel entschiede die
 * zufällige Reihenfolge der Einheiten in der Eingabe). Keine
 * Mindest-Similarity: lieber ein echtes Negativ verlieren als ein falsches
 * lernen. Einheiten oder Kandidaten ohne Embedding bleiben unzugeordnet.
 */
function excludedByUnattributable(candidates: PrecedentSelected[], openUnits: PrecedentUnit[]): Set<string> {
  const pairs: Array<{ ui: number; ci: number; s: number }> = []
  openUnits.forEach((unit, ui) => {
    candidates.forEach((cand, ci) => {
      const s = safeCosine(cand.embedding, unit.embedding)
      if (s !== null) pairs.push({ ui, ci, s })
    })
  })
  pairs.sort((a, b) => (b.s - a.s) || (openUnits[a.ui].position - openUnits[b.ui].position) || (a.ci - b.ci))
  const usedUnits = new Set<number>()
  const usedCands = new Set<number>()
  const excluded = new Set<string>()
  for (const p of pairs) {
    if (usedUnits.has(p.ui) || usedCands.has(p.ci)) continue
    usedUnits.add(p.ui)
    usedCands.add(p.ci)
    excluded.add(candidates[p.ci].id)
  }
  return excluded
}

/**
 * Stufe je Item (Vertrag 2.7):
 *   published               — id ∈ memberIds einer Einheit (gilt für selected UND Pool)
 *   merged                  — sonst, Hand-Item und maxCosine >= threshold (alle Einheiten)
 *   (keine Zeile)           — sonst, Hand-Item, eins-zu-eins einer Einheit OHNE
 *                             memberIds zugeordnet, die kein merged-Item erklärt (Entscheidung 7)
 *   dropped_after_selection — sonst, Hand-Item
 *   pending_never_selected  — sonst (selected, nicht Hand) sowie der restliche Pool
 *
 * Je item_id höchstens eine Zeile: erstes Vorkommen in `selected` gewinnt, der
 * Pool füllt nur IDs auf, die nicht in `selected` stehen (Ziel ist
 * unique (day, item_id)). Reihenfolge: selected, dann Pool, je in
 * Eingabereihenfolge. story_key bleibt in Phase 0 null.
 */
export function classifyPrecedents(input: PrecedentInputs, threshold: number = DEFAULT_DEDUP_THRESHOLD): PrecedentRow[] {
  const { day, jobId, postId, publishedUnits } = input

  const unitByMember = new Map<string, PrecedentUnit>()
  for (const unit of publishedUnits) {
    for (const id of unit.memberIds) {
      if (!unitByMember.has(id)) unitByMember.set(id, unit)
    }
  }

  const base = (item_id: string): PrecedentRow => ({
    day, item_id, story_key: null, stage: 'pending_never_selected',
    bundle_type_selected: null, bundle_type_published: null,
    job_id: jobId, post_id: postId, matched_heading: null, similarity: null,
  })

  const seen = new Set<string>()
  const selectedRows: Array<{ row: PrecedentRow; item: PrecedentSelected }> = []
  const mergedTargets = new Set<PrecedentUnit>()

  for (const item of input.selected) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const row = base(item.id)
    row.bundle_type_selected = item.bundle_type

    const published = unitByMember.get(item.id)
    if (published) {
      row.stage = 'published'
      row.bundle_type_published = published.bundleType
    } else if (item.isHand) {
      const match = item.embedding && item.embedding.length > 0 ? bestMatch(item.embedding, publishedUnits) : null
      if (match && match.similarity >= threshold) {
        row.stage = 'merged'
        row.matched_heading = match.unit.heading
        row.similarity = match.similarity
        mergedTargets.add(match.unit)
      } else {
        row.stage = 'dropped_after_selection'
      }
    }
    // sonst bleibt pending_never_selected: im Job, aber nie vom Betreiber gewählt
    selectedRows.push({ row, item })
  }

  // Entscheidung 7: Einheiten ohne Marker, die kein merged-Item schon erklärt.
  const openUnits = publishedUnits.filter((u) => u.memberIds.length === 0 && !mergedTargets.has(u))
  const candidates = selectedRows.filter((s) => s.row.stage === 'dropped_after_selection').map((s) => s.item)
  const excluded = openUnits.length > 0 && candidates.length > 0
    ? excludedByUnattributable(candidates, openUnits)
    : new Set<string>()

  const rows: PrecedentRow[] = selectedRows.filter((s) => !excluded.has(s.item.id)).map((s) => s.row)

  for (const id of input.poolNeverSelected) {
    if (seen.has(id)) continue
    seen.add(id)
    const row = base(id)
    // Entscheidung 6: ein Pool-Item, das im Post lief (Marker ohne Eintrag
    // in selected_items), ist published — nicht „nie gewählt".
    const published = unitByMember.get(id)
    if (published) {
      row.stage = 'published'
      row.bundle_type_published = published.bundleType
    }
    rows.push(row)
  }

  return rows
}

/**
 * Events eines Items bis einschließlich `asOfIso` (job.created_at), Reihenfolge
 * bleibt (loadEventsForItems sortiert nach at, id). WARUM `<=`: selectAndEnrichItems
 * ruft selectItemsForArticle VOR dem article_jobs-Insert (lib/article-jobs/service.ts:162-171),
 * die select-Events des Jobs selbst liegen also vor created_at und zählen mit.
 */
export function eventsAsOf(events: QueueEventRow[], asOfIso: string): QueueEventRow[] {
  const limit = Date.parse(asOfIso)
  return events.filter((e) => Date.parse(e.at) <= limit)
}

/** Berlin-Kalendertag eines Zeitstempels, 'YYYY-MM-DD' (Muster lib/wrapup/collect.ts:141). */
export function berlinDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
}

/**
 * Berlin-unabhängige Tagesverschiebung eines ISO-Tages 'YYYY-MM-DD'
 * (Controller-Ruling K4, Nachtrag zu Vertrag 2.7): Datum als UTC-Mitternacht
 * parsen, deltaDays*86400000 addieren, toISOString().slice(0,10) — derselbe
 * Rumpf wie Task 15 Step 4. Task 12 und Task 15 importieren diesen Helfer
 * von hier statt eigene Kopien zu bauen.
 */
export function isoDayShift(day: string, deltaDays: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`) + deltaDays * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * article_jobs.selected_items (jsonb, PipelineItem[]) → { id, bundle_type } je
 * Item, dedupliziert (erstes Vorkommen gewinnt), Einträge ohne String-ID fallen weg.
 */
export function precedentSelectedItems(raw: unknown): Array<{ id: string; bundle_type: string | null }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ id: string; bundle_type: string | null }> = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, bundle_type } = entry as { id?: unknown; bundle_type?: unknown }
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push({ id, bundle_type: typeof bundle_type === 'string' && bundle_type.length > 0 ? bundle_type : null })
  }
  return out
}

export interface PrecedentJob {
  id: string
  created_at: string
  generated_post_id: string | null
  selected_items: unknown
}

export type PrecedentSkipReason =
  | 'no_post' | 'not_published' | 'superseded' | 'no_units' | 'no_attributable_units' | 'no_selected'

export interface PrecedentPick<J> {
  /** Berlin-Tag → verarbeiteter Job, Tage aufsteigend. */
  byDay: Map<string, J>
  /** Je Grund die Zahl übersprungener JOBS (nicht Tage). */
  skipped: Record<PrecedentSkipReason, number>
}

/**
 * Welche Jobs klassifiziert werden (Review-Fokus 2, Entscheidungen 3, 4).
 * Je Berlin-Tag der JÜNGSTE manuelle Job mit veröffentlichtem Post; frühere
 * Jobs mit veröffentlichtem Post = superseded. Danach OHNE Rückfall auf
 * ältere Jobs: keine Einheiten → no_units, nur Einheiten ohne Marker →
 * no_attributable_units, leere Auswahl → no_selected. Jobs ohne Post →
 * no_post, Post nicht 'published' (draft, archived, gelöscht) →
 * not_published. Nur `byDay` geht in classifyPrecedents — für jeden
 * Skip-Grund entsteht also keine Zeile. Task 15 (measure-curation-baseline)
 * importiert GENAU diese Funktion, damit Präzedenzen und Baseline je Tag
 * denselben Job führen.
 */
export function pickPrecedentJobs<J extends PrecedentJob>(
  jobs: J[],
  postStatusById: Map<string, string>,
  unitsByPost: Map<string, PrecedentUnit[]>,
): PrecedentPick<J> {
  const skipped: Record<PrecedentSkipReason, number> = {
    no_post: 0, not_published: 0, superseded: 0, no_units: 0, no_attributable_units: 0, no_selected: 0,
  }
  const latest = new Map<string, J>()
  for (const job of jobs) {
    if (!job.generated_post_id) { skipped.no_post++; continue }
    if (postStatusById.get(job.generated_post_id) !== 'published') { skipped.not_published++; continue }
    const day = berlinDay(job.created_at)
    const prev = latest.get(day)
    if (!prev) { latest.set(day, job); continue }
    skipped.superseded++
    // WARUM Vergleich statt „letzter gewinnt": die Funktion soll nicht still
    // von der Sortierung des Aufrufers abhängen.
    if (Date.parse(job.created_at) > Date.parse(prev.created_at)) latest.set(day, job)
  }

  const byDay = new Map<string, J>()
  for (const day of [...latest.keys()].sort()) {
    const job = latest.get(day) as J
    const units = unitsByPost.get(job.generated_post_id as string) ?? []
    if (units.length === 0) { skipped.no_units++; continue }
    if (units.every((u) => u.memberIds.length === 0)) { skipped.no_attributable_units++; continue }
    if (precedentSelectedItems(job.selected_items).length === 0) { skipped.no_selected++; continue }
    byDay.set(day, job)
  }
  return { byDay, skipped }
}

/**
 * Jobs ab Berlin-Tag `since` (inklusive); ohne `since` alle. WARUM Berlin-Tag:
 * der DB-Vorfilter des Scripts ist bewusst zu weit (`gte created_at
 * <since>T00:00:00+02:00` — im Winter eine Stunde zu früh), der exakte
 * Schnitt muss zu dem Tag passen, den der Lauf ersetzt. Ein Job vor `since`
 * darf weder gewählt werden noch seinen Tag in staleDaysOf leeren.
 */
export function precedentJobsSince<J extends PrecedentJob>(jobs: J[], since: string | undefined): J[] {
  return since ? jobs.filter((j) => berlinDay(j.created_at) >= since) : jobs
}

/**
 * Berlin-Tage aus dem Job-Bereich, die pickPrecedentJobs NICHT wählt —
 * diese Tage leert der Schreib-Lauf (Entscheidung 12, `stale_days`).
 * Aufsteigend, ohne Duplikate. WARUM eine eigene reine Funktion (BEFUND
 * 2026-10-06, Prüfer): das ist die Löschmenge des [FREIGABE]-Laufs auf Prod.
 * Ein Tag mit einem gewählten Job bleibt stehen, auch wenn am selben Tag
 * weitere Jobs übersprungen wurden (superseded, no_post).
 */
export function staleDaysOf<J extends PrecedentJob>(jobs: J[], pick: PrecedentPick<J>): string[] {
  return [...new Set(jobs.map((j) => berlinDay(j.created_at)))]
    .filter((d) => !pick.byDay.has(d))
    .sort()
}

/**
 * `--since=YYYY-MM-DD` oder `--since YYYY-MM-DD` (Task 15 Steps 15d/15f —
 * Dry-Run 15d, Schreiben 15f [FREIGABE] — rufen die Leerzeichen-Form). undefined = Flag fehlt, null = ungültig oder ohne Wert.
 * WARUM null statt „nicht gesetzt": ein Tippfehler im Datum darf nicht still
 * zum Volllauf werden, der im Schreib-Lauf jeden Tag ersetzt
 * (Muster scripts/backfill-taste-features.ts:59-65).
 */
export function parseSinceArg(argv: string[]): string | undefined | null {
  const idx = argv.findIndex((a) => a === '--since' || a.startsWith('--since='))
  if (idx < 0) return undefined
  const raw = argv[idx].includes('=') ? argv[idx].slice('--since='.length) : argv[idx + 1]
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) return null
  return raw
}

/** Die news_queue-Spalten, die das Script je gewähltem Item lädt. */
export interface PrecedentQueueRow {
  id: string
  bundle_type: string | null
  metadata: Record<string, unknown> | null
  daily_repo_id: string | null
}

/**
 * selected_items eines Jobs → Eingabe für classifyPrecedents.
 *   - bundle_type: Label ZUM ZEITPUNKT der Auswahl (PipelineItem), Fallback
 *     news_queue.bundle_type (Entscheidung 1) — das aktuelle Label kann seit
 *     dem Job umgelabelt sein.
 *   - embedding: daily_repo.embedding über news_queue.daily_repo_id;
 *     Techmeme/ohne daily_repo_id/ohne Vektor → null.
 *   - isHand: isHandItem mit den Events BIS `asOfIso` (job.created_at,
 *     Entscheidung 8); Item nicht mehr in news_queue → metadata null →
 *     Fallback 'operator' (Entscheidung 2).
 */
export function buildPrecedentSelected(
  items: Array<{ id: string; bundle_type: string | null }>,
  queueById: Map<string, PrecedentQueueRow>,
  embByRepo: Map<string, number[]>,
  eventsById: Map<string, QueueEventRow[]>,
  asOfIso: string,
): PrecedentSelected[] {
  return items.map((p) => {
    const q = queueById.get(p.id)
    const repoId = q?.daily_repo_id ?? null
    return {
      id: p.id,
      bundle_type: p.bundle_type ?? q?.bundle_type ?? null,
      embedding: repoId ? (embByRepo.get(repoId) ?? null) : null,
      isHand: isHandItem({ id: p.id, metadata: q?.metadata ?? null }, eventsAsOf(eventsById.get(p.id) ?? [], asOfIso)),
    }
  })
}

/** Batchgröße für den Upsert (Vertrag 0: Scheiben à 200). */
export const PRECEDENT_WRITE_BATCH = 200

/**
 * Ersetzt ALLE Zeilen eines Berlin-Tages durch `rows` (Entscheidung 12):
 * erst delete where day = ?, dann Upsert onConflict day,item_id in Batches.
 * Leere `rows` = Tag nur leeren (Tag fällt aus pickPrecedentJobs heraus).
 *
 * WARUM ersetzen statt nur upserten (BEFUND 2026-10-06, Prüfer): ein Upsert
 * löscht nie — ein zweiter Job am selben Tag, ein Neulauf von Task 10 oder
 * ein archivierter Post hinterließen alte Zeilen (zwei job_id je Tag,
 * falsche dropped_after_selection im Negativblock von Task 12).
 * Nicht transaktional (PostgREST): scheitert der Upsert, ist der Tag leer
 * und der Aufrufer zählt ihn als fehlgeschlagen — ein erneuter Lauf stellt
 * ihn her. Wirft Error('curation_precedents delete|upsert (<day>): …').
 */
export async function replacePrecedentDay(supabase: SupabaseAdmin, day: string, rows: PrecedentRow[]): Promise<number> {
  const { error: delError } = await supabase.from('curation_precedents').delete().eq('day', day)
  if (delError) throw new Error(`curation_precedents delete (${day}): ${delError.message}`)
  let written = 0
  for (let i = 0; i < rows.length; i += PRECEDENT_WRITE_BATCH) {
    const batch = rows.slice(i, i + PRECEDENT_WRITE_BATCH)
    const { error } = await supabase.from('curation_precedents').upsert(batch, { onConflict: 'day,item_id' })
    if (error) throw new Error(`curation_precedents upsert (${day}): ${error.message}`)
    written += batch.length
  }
  return written
}
