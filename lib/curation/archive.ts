/**
 * Archivbrief der Morgenkonferenz (Task 7, Spec 2026-10-05 Abschnitt
 * „Archivar"): der Text, den die Chefredaktion (Task 8, compose.ts) neben
 * Pool und Cluster als Kontext bekommt — Betreiber-Regeln, Rollen-Soft-Range
 * ueber die letzten 30 Tage, Techmeme-Uebernahmequote, Coverage as-of
 * („schon gelaufen" / „Nachlese"), Praezedenz-Einheiten (RPC auf
 * published_units), der Phase-0-Negativblock, eigene Korrektur-Paare
 * (vorherige Shadow-/Backtest-Laeufe mit abweichendem Ergebnis) und
 * Panel-Feedback (Betreiber-Reaktion auf einzelne Vorschlaege).
 *
 * systemPrefix ist der stabile Teil (cache_control ephemeral in
 * buildComposeMessages, Task 8) — er aendert sich innerhalb eines Tages
 * praktisch nicht (Regeln, 30-Tage-Statistik). dayBlock ist der volatile
 * Tagesteil (Coverage/Praezedenzen/Negativblock/Paare/Panel), neu je Lauf.
 */
import { cosineSimilarity } from '@/lib/embeddings/generator'
import { parseEmbedding } from '@/lib/news-queue/semantic-dedup'
import { berlinDay, isoDayShift } from '@/lib/curation/precedents'
import { loadNegativeBlock } from '@/lib/curation/negatives'
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import type { ArchiveBrief, ArchiveMeta, BriefMode, RunMode, UnitOutcome } from '@/lib/curation/types'

export interface ArchiveCandidate { id: string; title: string; embedding: number[] }
export interface ArchiveInput { asOf: string; candidates: ArchiveCandidate[]; briefMode: BriefMode; mode: RunMode }
export interface CoverageUnit { id: string; post_id: string; heading: string; published_at: string; embedding: number[] }
export interface PrecedentHit { unit_id: string; post_id: string; heading: string; bundle_type: string | null; published_at: string; similarity: number; candidate_index: number }
export interface CorrectionPair { outcome: UnitOutcome; title: string; role: string | null; final_role: string | null; day: string; heading: string | null }
export interface PanelItem { id: string; title: string; role: string | null; at: string }

// WARUM 200 ueberall (Seiten UND .in()-Scheiben): Vertrag §0 — .in()-Listen
// ab ~400 UUIDs loesen gegen Prod einen HeadersOverflowError aus
// (scripts/lib/taste-ground-truth.ts:7-11); dieselbe Groesse fuer
// Bereichs-Seiten haelt den Code einheitlich, ohne dass eine zweite Zahl
// begruendet werden muesste.
const PAGE = 200
const IN_CHUNK = 200

const MAX_DROPPED_AFTER = 10
const MAX_DROPPED_NEVER = 20
const MAX_PAIRS_TOTAL = 60
const MAX_PANEL_PER_ROLE = 5

const ROLES = ['topic', 'recap', 'deep_dive', 'cover_story', 'none']

/** Berlin-unabhaengige Verschiebung eines VOLLEN Zeitstempels (anders als isoDayShift, das auf 'YYYY-MM-DD'-Tagen arbeitet). */
function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString()
}

/**
 * Soft-Range je Rolle ueber eine Menge von Posts: wie oft die Rolle je Post
 * vorkommt (Posts ohne die Rolle zaehlen 0), dann min/median/max ueber alle
 * Posts. 'none' ist eine eigene Pseudo-Rolle fuer Einheiten ohne Label.
 */
export function roleSoftRange(rolesByPost: Array<Array<string | null>>): Record<string, { min: number; median: number; max: number }> {
  const out: Record<string, { min: number; median: number; max: number }> = {}
  for (const role of ROLES) {
    const counts = rolesByPost.map(post => post.filter(r => (r ?? 'none') === role).length).sort((a, b) => a - b)
    if (!counts.length) continue
    out[role] = { min: counts[0], median: counts[Math.floor(counts.length / 2)], max: counts[counts.length - 1] }
  }
  return out
}

/**
 * Bester Kandidaten-Treffer je Coverage-Einheit: ran = schon gelaufen
 * (Cosine >= 0,8, dieselbe Schwelle wie merged in precedents.ts), followups =
 * verwandt (0,6 <= Cosine < 0,8). Je Kandidat zaehlt nur der aehnlichste
 * Treffer — ein Kandidat, der zu mehreren Einheiten passt, soll nicht
 * mehrfach im Brief auftauchen.
 */
export function coverageHits(
  candidates: ArchiveCandidate[],
  coverage: CoverageUnit[],
): { ran: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }>; followups: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }> } {
  const ran: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }> = []
  const followups: Array<{ candidate_id: string; heading: string; published_at: string; sim: number }> = []
  for (const c of candidates) {
    let best: { u: CoverageUnit; sim: number } | null = null
    for (const u of coverage) {
      if (!u.embedding.length || u.embedding.length !== c.embedding.length) continue
      const sim = cosineSimilarity(c.embedding, u.embedding)
      if (!best || sim > best.sim) best = { u, sim }
    }
    if (!best) continue
    const hit = { candidate_id: c.id, heading: best.u.heading, published_at: best.u.published_at, sim: Number(best.sim.toFixed(3)) }
    if (best.sim >= 0.8) ran.push(hit)
    else if (best.sim >= 0.6) followups.push(hit)
  }
  return { ran, followups }
}

/** Techmeme-Uebernahmequote je Story-Rang (techmeme_story_index): used / stories, aufsteigend nach Rang. */
export function techmemeAdoptionOf(rows: Array<{ story_index: number; status: string }>): Array<{ index: number; stories: number; used: number; rate: number }> {
  const by = new Map<number, { stories: number; used: number }>()
  for (const r of rows) {
    const e = by.get(r.story_index) ?? { stories: 0, used: 0 }
    e.stories++
    if (r.status === 'used') e.used++
    by.set(r.story_index, e)
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([index, e]) => ({ index, stories: e.stories, used: e.used, rate: e.stories ? e.used / e.stories : 0 }))
}

// 'YYYY-MM-DD' sortiert lexikographisch = chronologisch (Muster negatives.ts byDayDesc).
const byDayDesc = (a: CorrectionPair, b: CorrectionPair) => b.day.localeCompare(a.day)

/**
 * Kappung der Korrektur-Paare (Controller-Ruling R3): alle `added` und alle
 * `relabeled` ungekappt zuerst — jede eigene Korrektur soll das Modell sehen
 * —, danach bis zu 10 `dropped_after_selection` und bis zu 20
 * `dropped_never_selected`, je nach Tag absteigend (juengste zuerst).
 * Hartgrenze 60 ueber die bereits in Prioritaetsreihenfolge zusammengesetzte
 * Liste trifft automatisch "zuerst added, dann relabeled, dann die juengsten".
 */
function capPairs(pairs: CorrectionPair[]): CorrectionPair[] {
  const added = pairs.filter(p => p.outcome === 'added')
  const relabeled = pairs.filter(p => p.outcome === 'relabeled')
  const droppedAfter = pairs.filter(p => p.outcome === 'dropped_after_selection').sort(byDayDesc).slice(0, MAX_DROPPED_AFTER)
  const droppedNever = pairs.filter(p => p.outcome === 'dropped_never_selected').sort(byDayDesc).slice(0, MAX_DROPPED_NEVER)
  return [...added, ...relabeled, ...droppedAfter, ...droppedNever].slice(0, MAX_PAIRS_TOTAL)
}

/** Panel-Kappung je Rolle UND Seite (R3): hoechstens 5 je Rolle, Eingabereihenfolge entscheidet bei Gleichstand. */
function capPanelSide(items: PanelItem[]): PanelItem[] {
  const perRole = new Map<string, number>()
  const out: PanelItem[] = []
  for (const item of items) {
    const role = item.role ?? 'none'
    const n = perRole.get(role) ?? 0
    if (n >= MAX_PANEL_PER_ROLE) continue
    perRole.set(role, n + 1)
    out.push(item)
  }
  return out
}

function formatSystemPrefix(
  rules: string,
  softRange: Record<string, { min: number; median: number; max: number }>,
  adoption: ReturnType<typeof techmemeAdoptionOf>,
): string {
  const lines: string[] = ['Betreiber-Regeln', rules || 'keine', '']
  lines.push('Rollen je Post (30 Tage)')
  const roles = Object.entries(softRange)
  if (roles.length === 0) lines.push('keine Daten')
  else for (const [role, r] of roles) lines.push(`- ${role}: min ${r.min} / median ${r.median} / max ${r.max}`)
  lines.push('')
  lines.push('Techmeme-Übernahme je Rang')
  if (adoption.length === 0) lines.push('keine Daten')
  else for (const a of adoption) lines.push(`- #${a.index} ${a.used}/${a.stories}`)
  return lines.join('\n')
}

/**
 * Setzt systemPrefix (stabil) und dayBlock (volatil) aus den geladenen
 * Teilen zusammen. candidateTitles traegt ZWEI Arten von Schluesseln: die
 * echte Kandidaten-ID (fuer coverageHits-Treffer, die einen Kandidaten per
 * `candidate_id` referenzieren) und den synthetischen Schluessel `c<index>`
 * (fuer Praezedenz-Treffer — die RPC kennt die Kandidaten nur ueber ihre
 * Position im uebergebenen Embedding-Array, nicht ueber ihre ID).
 */
export function formatBrief(parts: {
  rules: string
  softRange: Record<string, { min: number; median: number; max: number }>
  adoption: ReturnType<typeof techmemeAdoptionOf>
  coverage: ReturnType<typeof coverageHits>
  precedents: PrecedentHit[]
  negativeText: string
  pairs: CorrectionPair[]
  panel: { accepted: PanelItem[]; rejected: PanelItem[] }
  candidateTitles: Map<string, string>
}): { systemPrefix: string; dayBlock: string; precedentIds: Record<string, string> } {
  const systemPrefix = formatSystemPrefix(parts.rules, parts.softRange, parts.adoption)
  const sections: string[] = []

  const coverageLine = (h: { candidate_id: string; heading: string; published_at: string }) =>
    `- ${parts.candidateTitles.get(h.candidate_id) ?? h.candidate_id} ≈ „${h.heading}" (${berlinDay(h.published_at)})`

  if (parts.coverage.ran.length > 0) {
    sections.push(['Schon gelaufen (≥0,8)', ...parts.coverage.ran.map(coverageLine)].join('\n'))
  }
  if (parts.coverage.followups.length > 0) {
    sections.push(['Nachlese-Kandidaten (0,6–0,8)', ...parts.coverage.followups.map(coverageLine)].join('\n'))
  }

  // WARUM P<n> statt unit_id: das Compose-Modell (Task 8) zitiert Praezedenzen
  // im Plan ueber dieses kurze Tag (precedent_ids), nicht ueber die UUID —
  // precedentIds loest P<n> hier zurueck auf die echte published_units-ID auf
  // (validatePlan, Task 8), der Prompt selbst bleibt kurz und lesbar.
  const precedentIds: Record<string, string> = {}
  if (parts.precedents.length > 0) {
    const lines = ['Präzedenz-Einheiten']
    parts.precedents.forEach((p, i) => {
      const tag = `P${i + 1}`
      precedentIds[tag] = p.unit_id
      const titel = parts.candidateTitles.get(`c${p.candidate_index}`) ?? `Kandidat ${p.candidate_index}`
      lines.push(`[${tag}] ${p.heading} (${p.bundle_type ?? 'ohne Label'}, ${berlinDay(p.published_at)}) ~ ${titel}`)
    })
    sections.push(lines.join('\n'))
  }

  if (parts.negativeText) sections.push(parts.negativeText)

  const pairsCapped = capPairs(parts.pairs)
  if (pairsCapped.length > 0) {
    const lines = ['Korrektur-Paare aus eigenen Plänen']
    for (const p of pairsCapped) lines.push(`- ${p.title} [${p.role ?? '-'} → ${p.outcome}(${p.final_role ?? '-'})] ${p.day}`)
    sections.push(lines.join('\n'))
  }

  const accepted = capPanelSide(parts.panel.accepted)
  const rejected = capPanelSide(parts.panel.rejected)
  if (accepted.length > 0 || rejected.length > 0) {
    const lines = ['Panel: angenommen / abgelehnt']
    if (accepted.length > 0) {
      lines.push('Angenommen:')
      for (const item of accepted) lines.push(`- ${item.title} (${item.role ?? '-'})`)
    }
    if (rejected.length > 0) {
      lines.push('Abgelehnt:')
      for (const item of rejected) lines.push(`- ${item.title} (${item.role ?? '-'})`)
    }
    sections.push(lines.join('\n'))
  }

  return { systemPrefix, dayBlock: sections.join('\n\n'), precedentIds }
}

interface PublishedUnitCoverageRow { id: string; post_id: string; heading: string; published_at: string; embedding: unknown }

/** Veroeffentlichte Einheiten mit Embedding in [from, to) — Coverage-Fenster fuer coverageHits. */
export async function loadCoverageAsOf(supabase: SupabaseAdmin, from: string, to: string): Promise<CoverageUnit[]> {
  const out: CoverageUnit[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('published_units')
      .select('id, post_id, heading, published_at, embedding')
      .gte('published_at', from)
      .lt('published_at', to)
      .not('embedding', 'is', null)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`published_units: ${error.message}`)
    const page = (data ?? []) as PublishedUnitCoverageRow[]
    for (const row of page) {
      const embedding = parseEmbedding(row.embedding)
      if (embedding.length > 0) out.push({ id: row.id, post_id: row.post_id, heading: row.heading, published_at: row.published_at, embedding })
    }
    if (page.length < PAGE) break
  }
  return out
}

/** Praezedenz-Einheiten je Rolle via RPC (ein Round-Trip fuer alle Kandidaten). Embeddings als pgvector-Strings. */
export async function loadPrecedentUnits(
  supabase: SupabaseAdmin,
  candidateEmbeddings: number[][],
  before: string,
  perRole = 8,
): Promise<PrecedentHit[]> {
  const { data, error } = await supabase.rpc('get_precedent_units', {
    candidate_embeddings: candidateEmbeddings.map(v => `[${v.join(',')}]`),
    before,
    per_role: perRole,
  })
  if (error) throw new Error(`get_precedent_units: ${error.message}`)
  return (data ?? []) as PrecedentHit[]
}

interface PublishedUnitRoleRow { post_id: string; bundle_type: string | null }

/** Rollen-Soft-Range ueber die letzten `days` Tage vor asOf: bundle_type je Post gruppiert, dann roleSoftRange. */
export async function loadRoleSoftRange(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<ReturnType<typeof roleSoftRange>> {
  const since = shiftIso(asOf, days)
  const byPost = new Map<string, Array<string | null>>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('published_units')
      .select('post_id, bundle_type')
      .gte('published_at', since)
      .lt('published_at', asOf)
      .order('post_id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`published_units: ${error.message}`)
    const page = (data ?? []) as PublishedUnitRoleRow[]
    for (const row of page) {
      const list = byPost.get(row.post_id) ?? []
      list.push(row.bundle_type)
      byPost.set(row.post_id, list)
    }
    if (page.length < PAGE) break
  }
  return roleSoftRange([...byPost.values()])
}

interface RunPoolRow { id: string; day: string; pool: { items?: Array<{ id: string; title: string }> } | null }
interface CorrectionUnitRow { run_id: string; member_ids: string[]; role: string | null; outcome: UnitOutcome; final_role: string | null; matched_heading: string | null }

/**
 * Eigene Korrektur-Paare: abgeglichene Laeufe (reconciled_at gesetzt) in den
 * letzten `days` Tagen desselben Modus, deren Einheiten ein Outcome tragen.
 * Der Titel kommt NICHT aus news_queue (das Item kann laengst geloescht
 * sein), sondern aus dem eigenen pool-Snapshot des Runs (run.pool.items) —
 * derselbe Snapshot, den der Lauf selbst beim Start eingefroren hat.
 */
export async function loadCorrectionPairs(supabase: SupabaseAdmin, asOf: string, mode: RunMode, days = 14): Promise<CorrectionPair[]> {
  const since = shiftIso(asOf, days)
  const runs: RunPoolRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('curation_runs')
      .select('id, day, pool')
      .eq('mode', mode)
      .not('reconciled_at', 'is', null)
      .gte('asof', since)
      .lt('asof', asOf)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`curation_runs: ${error.message}`)
    const page = (data ?? []) as RunPoolRow[]
    runs.push(...page)
    if (page.length < PAGE) break
  }
  if (runs.length === 0) return []

  const dayByRun = new Map(runs.map(r => [r.id, r.day]))
  const titleByRunMember = new Map(runs.map(r => [r.id, new Map((r.pool?.items ?? []).map(it => [it.id, it.title]))]))

  const runIds = runs.map(r => r.id)
  const pairs: CorrectionPair[] = []
  for (let i = 0; i < runIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('curation_units')
      .select('run_id, member_ids, role, outcome, final_role, matched_heading')
      .in('run_id', runIds.slice(i, i + IN_CHUNK))
      .not('outcome', 'is', null)
    if (error) throw new Error(`curation_units: ${error.message}`)
    for (const row of (data ?? []) as CorrectionUnitRow[]) {
      const firstMember = row.member_ids[0]
      const title = firstMember ? titleByRunMember.get(row.run_id)?.get(firstMember) : undefined
      const day = dayByRun.get(row.run_id)
      if (!title || !day) {
        console.warn(`[Curation] Korrektur-Paar ohne Titel übersprungen (run ${row.run_id})`)
        continue
      }
      pairs.push({ outcome: row.outcome, title, role: row.role, final_role: row.final_role, day, heading: row.matched_heading })
    }
  }
  return pairs
}

interface PanelEventRow { queue_item_id: string; event: string; at: string }
interface QueueTitleRow { id: string; title: string; bundle_type: string | null }

/**
 * Panel-Feedback (angenommen/abgelehnt) aus queue_item_events, NICHT aus
 * ranking_suggestions: ranking_suggestions haengt per FK an news_queue und
 * wird beim Ablauf/Loeschen eines Items per Cascade mitgeloescht — nach ein
 * paar Tagen waere jedes Feedback zu einem abgelaufenen Item spurlos weg.
 * queue_item_events hat keinen FK (Vertrag 2.1) und ueberlebt genau deshalb.
 * Je Item zaehlt das JUENGSTE Event im Fenster (Reihenfolge `at` aufsteigend,
 * spaetere ueberschreiben fruehere) — dasselbe "juengstes Event zaehlt"-Muster
 * wie der Hand-Begriff in precedents.ts.
 */
export async function loadPanelFeedback(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<{ accepted: PanelItem[]; rejected: PanelItem[] }> {
  const since = shiftIso(asOf, days)
  const latestByItem = new Map<string, { event: string; at: string }>()
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('queue_item_events')
      .select('queue_item_id, event, at')
      .in('event', ['panel_accept', 'panel_reject'])
      .gte('at', since)
      .lt('at', asOf)
      .order('at')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`queue_item_events: ${error.message}`)
    const page = (data ?? []) as PanelEventRow[]
    for (const row of page) latestByItem.set(row.queue_item_id, { event: row.event, at: row.at })
    if (page.length < PAGE) break
  }
  if (latestByItem.size === 0) return { accepted: [], rejected: [] }

  const ids = [...latestByItem.keys()]
  const queueById = new Map<string, QueueTitleRow>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from('news_queue').select('id, title, bundle_type').in('id', ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`news_queue: ${error.message}`)
    for (const row of (data ?? []) as QueueTitleRow[]) queueById.set(row.id, row)
  }

  const accepted: PanelItem[] = []
  const rejected: PanelItem[] = []
  for (const [id, { event, at }] of latestByItem) {
    const q = queueById.get(id)
    if (!q) continue // geloescht — kein Titel, kein Eintrag
    const item: PanelItem = { id, title: q.title, role: q.bundle_type, at }
    ;(event === 'panel_accept' ? accepted : rejected).push(item)
  }
  return { accepted, rejected }
}

/** Betreiber-Regeln aus settings.curation_operator_rules (Markdown). Fehlende Zeile → leer, kein Fehler (Vertrag: Zeile existiert erst ab [FREIGABE]). */
export async function loadOperatorRules(supabase: SupabaseAdmin): Promise<string> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'curation_operator_rules').maybeSingle()
  if (error) throw new Error(`settings: ${error.message}`)
  const value = (data as { value?: { text?: string } } | null)?.value
  return value?.text ?? ''
}

interface TechmemeQueueRow { status: string; metadata: Record<string, unknown> | null }

/** Techmeme-Items (metadata.techmeme = true) der letzten `days` Tage, Uebernahmequote je Story-Rang. */
export async function loadTechmemeAdoption(supabase: SupabaseAdmin, asOf: string, days = 30): Promise<ReturnType<typeof techmemeAdoptionOf>> {
  const since = shiftIso(asOf, days)
  const rows: Array<{ story_index: number; status: string }> = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('news_queue')
      .select('status, metadata')
      .eq('metadata->>techmeme', 'true')
      .gte('queued_at', since)
      .lt('queued_at', asOf)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`news_queue: ${error.message}`)
    const page = (data ?? []) as TechmemeQueueRow[]
    for (const row of page) {
      const idx = row.metadata?.techmeme_story_index
      if (typeof idx === 'number') rows.push({ story_index: idx, status: row.status })
    }
    if (page.length < PAGE) break
  }
  return techmemeAdoptionOf(rows)
}

/**
 * Baut den vollstaendigen Archivbrief. Jede Quelle laeuft in ihrem EIGENEN
 * try/catch: ein kaputter Teil (z. B. die RPC fehlt, Migration noch nicht
 * eingespielt) darf den Rest des Briefs nicht mitreissen — der Spec-Fehlerpfad
 * verlangt "Archivar: RPC fehlt/wirft → Compose ohne Archivbrief, degraded",
 * nicht "ganzer Lauf bricht ab". meta.missing haelt fest, was fehlte, damit
 * Task 10 den Run als degraded('archive') markieren kann.
 *
 * briefMode steuert nur, WELCHE Quellen ueberhaupt versucht werden: 'none'
 * laedt nichts Tagesaktuelles (nur Regeln/Soft-Range/Techmeme-Quote bleiben
 * im stabilen systemPrefix), 'precedents-only' ergaenzt Coverage, Praezedenzen
 * und den Negativblock, 'full' zusaetzlich die eigenen Korrektur-Paare und
 * das Panel-Feedback.
 */
export async function buildArchiveBrief(supabase: SupabaseAdmin, input: ArchiveInput): Promise<ArchiveBrief> {
  const { asOf, candidates, briefMode, mode } = input
  const day = berlinDay(asOf)
  const meta: ArchiveMeta = {
    coverage_hits: 0, followups: 0, precedents: 0, negatives: 0,
    pairs: 0, panel_accept: 0, panel_reject: 0, approx_tokens: 0, missing: [],
  }

  let rules = ''
  try { rules = await loadOperatorRules(supabase) } catch { meta.missing.push('rules') }

  let softRange: Record<string, { min: number; median: number; max: number }> = {}
  try { softRange = await loadRoleSoftRange(supabase, asOf) } catch { meta.missing.push('softrange') }

  let adoption: ReturnType<typeof techmemeAdoptionOf> = []
  try { adoption = await loadTechmemeAdoption(supabase, asOf) } catch { meta.missing.push('adoption') }

  let coverage: ReturnType<typeof coverageHits> = { ran: [], followups: [] }
  let precedents: PrecedentHit[] = []
  let negativeText = ''
  let pairs: CorrectionPair[] = []
  let panel: { accepted: PanelItem[]; rejected: PanelItem[] } = { accepted: [], rejected: [] }

  if (briefMode !== 'none') {
    try {
      const from = `${isoDayShift(day, -7)}T00:00:00.000Z`
      const coverageUnits = await loadCoverageAsOf(supabase, from, asOf)
      coverage = coverageHits(candidates, coverageUnits)
      meta.coverage_hits = coverage.ran.length
      meta.followups = coverage.followups.length
    } catch { meta.missing.push('coverage') }

    try {
      precedents = await loadPrecedentUnits(supabase, candidates.map(c => c.embedding), asOf)
      meta.precedents = precedents.length
    } catch { meta.missing.push('precedents') }

    try {
      const negative = await loadNegativeBlock(supabase, { days: 14, asOf: day })
      negativeText = negative.text
      meta.negatives = negative.units.length
    } catch { meta.missing.push('negatives') }
  }

  if (briefMode === 'full') {
    try {
      pairs = await loadCorrectionPairs(supabase, asOf, mode)
      meta.pairs = pairs.length
    } catch { meta.missing.push('pairs') }

    try {
      panel = await loadPanelFeedback(supabase, asOf)
      meta.panel_accept = panel.accepted.length
      meta.panel_reject = panel.rejected.length
    } catch { meta.missing.push('panel') }
  }

  // candidateTitles traegt beide Schluesselformen — s. formatBrief-Kommentar.
  const candidateTitles = new Map<string, string>()
  candidates.forEach((c, i) => {
    candidateTitles.set(c.id, c.title)
    candidateTitles.set(`c${i}`, c.title)
  })

  const { systemPrefix, dayBlock, precedentIds } = formatBrief({ rules, softRange, adoption, coverage, precedents, negativeText, pairs, panel, candidateTitles })
  meta.approx_tokens = Math.ceil((systemPrefix.length + dayBlock.length) / 3.5)

  return { systemPrefix, dayBlock, precedentIds, meta }
}
