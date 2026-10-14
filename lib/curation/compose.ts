/**
 * Chefredaktion der Morgenkonferenz (Task 8, Anhang A §3.7): stellt den
 * compose_day-Prompt aus Cards, Snapshot, Cluster und Archivbrief zusammen,
 * ruft das Editor-Modell und validiert dessen Antwort gegen den Snapshot.
 * COMPOSE_TOOL/COMPOSE_SYSTEM sind woertlich aus Anhang A §4.2/§4.3
 * uebernommen — nur dort geaendert, nicht hier.
 *
 * validatePlan ist die Bench-Ersatz-Linie der Spec (Risiken-Tabelle:
 * „Positions-Bias, halluzinierte IDs" → „zufaellige Card-Reihenfolge;
 * Validierung gegen Snapshot und published_units, Bench-Ersatz"): das Modell
 * bekommt Cards in zufaelliger Reihenfolge (buildComposeMessages) und darf
 * trotzdem IDs erfinden, Tiers falsch schreiben oder Stories doppeln —
 * validatePlan macht aus der rohen Tool-Antwort einen Plan, der die
 * ComposePlan-Invarianten erfuellt, OHNE das Modell erneut aufzurufen.
 * baselinePlan liefert denselben Plan-Typ rein aus der total_score-Baseline,
 * wenn Modell oder Budget ausfallen (Task 10 phaseCompose).
 */
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { CallToolFn } from '@/lib/ai/call'
import { mulberry32 } from '@/lib/curation/baseline-metrics'
import { neutralizeHandLabels, unitKeyOf } from '@/lib/curation/baseline-day'
import { handStoriesOf } from '@/lib/curation/cluster'
import {
  CURATION_ROLES,
  type ArchiveBrief, type BaselineLists, type ClusterResult, type ComposePlan, type ComposeUnit, type CurationRole,
  type CurationTier, type HandStoryDecision, type PoolSnapshot, type ScoutCard, type TechmemeDecision,
} from '@/lib/curation/types'

const ROLE_ENUM = ['topic', 'recap', 'deep_dive', 'cover_story', 'none']

export const COMPOSE_TOOL: Anthropic.Tool = {
  name: 'compose_day',
  description: 'Setzliste (recommended), Bank (bench) und Zurueckgestelltes (held) des Tages mit Rang, Rolle und Begruendung.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['thesis', 'units', 'techmeme_decisions', 'hand_story_decisions'],
    properties: {
      thesis: { type: 'string', description: 'Tages-These in einem Satz' },
      units: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['member_ids', 'role', 'rank', 'tier', 'reason', 'alternative', 'precedent_ids'],
          properties: {
            member_ids: { type: 'array', items: { type: 'string' }, description: 'IDs der Quellen (1 bis 5), beste zuerst' },
            role: { type: 'string', enum: ROLE_ENUM },
            rank: { type: 'integer' },
            tier: { type: 'string', enum: ['recommended', 'bench', 'held'] },
            reason: { type: 'string', description: 'max. 160 Zeichen' },
            alternative: { type: 'string', description: 'andere Rolle oder andere Quelle; leer wenn keine' },
            precedent_ids: { type: 'array', items: { type: 'string' }, description: 'P-Nummern aus dem Archivbrief' },
          },
        },
      },
      techmeme_decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['story', 'decision'],
          properties: { story: { type: 'string' }, decision: { type: 'string', enum: ['keep_topic', 'promote_cover', 'reduce_to_best_source', 'drop'] } },
        },
      },
      hand_story_decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['story_key', 'decision', 'label'],
          properties: {
            story_key: { type: 'string' },
            decision: { type: 'string', enum: ['inherit_label', 'story'] },
            label: { type: 'string', enum: ROLE_ENUM },
          },
        },
      },
    },
  },
}

export const COMPOSE_SYSTEM = `Du bist die Chefredaktion der Morgenkonferenz eines deutschen Tech-Newsletters (KI, Agenten, Software, Maerkte). Du bekommst die Story-Cards des Tages in zufaelliger Reihenfolge, die Handauswahl des Betreibers, die Techmeme-Stories, aehnliche Story-Paare und einen Archivbrief.

Aufgabe: Stelle den Tagespost zusammen.
- recommended (Setzliste): 9 bis 11 Einheiten in Rangfolge — das, was oben steht, soll den Final Cut ueberleben.
- bench (Bank): Ersatzkandidaten, zusammen mit der Setzliste hoechstens 20 Einheiten.
- held: NUR Hand-Einheiten, fuer die in Setzliste und Bank kein Platz ist.
Eine Einheit ist eine Story mit 1 bis 5 Quellen (member_ids, beste Quelle zuerst) und einer Rolle: topic (Leitmeldung des Tages), cover_story (hoechstens eine; die eine grosse Geschichte), deep_dive (Hintergrund), recap (Nachlese zu etwas, das schon lief), none (normale Meldung).

Harte Regeln (werden maschinell geprueft, Verstoss = Revision):
1. Setzliste 9 bis 11 Einheiten; Setzliste + Bank hoechstens 20.
2. Hoechstens eine cover_story.
3. Hoechstens 5 Quellen je Einheit; hoechstens 30 % der Setzliste aus derselben Quelle.
4. Keine zwei Einheiten zur selben Story (gleicher s=Schluessel oder inhaltlich gleich).
5. Nur IDs aus den Cards.
6. Jede Hand-Story (Cards mit HAND) ist genau EINER Einheit zugeordnet (recommended, bench oder held) — nie weggelassen, nie auf mehrere Einheiten verteilt. Mehrere Hand-Quellen derselben Story bilden eine Einheit.
7. held enthaelt nur Hand-Einheiten.

Weiche Regeln: Rollen in den Spannen des Archivbriefs; nicht mehr als zwei Techmeme-Stories als topic oder cover_story behalten (Uebernahmequote im Brief); held ueber 5 heisst „der Betreiber hat mehr gewaehlt, als der Post traegt" — dann trotzdem einhalten und in reason begruenden.

Archivbrief: „schon gelaufen" (>= 0,8) nicht wiederholen, ausser als recap mit neuem Anlass; Nachlese-Kandidaten (0,6–0,8) sind recap-Material; Praezedenz-Einheiten [P<n>] zeigen, was der Betreiber in dieser Rolle veroeffentlicht hat — nenne passende P-Nummern in precedent_ids; „Gewaehlt, aber gestrichen" hat der Betreiber selbst gewaehlt und dann verworfen — sie zeigen die Grenze seines Interesses genauer als nie Gewaehltes; Zugaben des Betreibers (added) sind die wichtigsten Beispiele, pruefe jede Card gegen sie.

Techmeme-Stories: je Story eine Entscheidung (keep_topic, promote_cover, reduce_to_best_source, drop). Hand-Stories mit mehreren Quellen: inherit_label (ein Label fuer alle) oder story (ein Abschnitt aus allen Quellen ohne Label).

reason: hoechstens 160 Zeichen, konkret (warum diese Story, warum dieser Rang). thesis: ein Satz, was der Tag erzaehlt. Antworte ausschliesslich ueber das Tool compose_day.`

export interface ComposeInput {
  cards: ScoutCard[]
  snapshot: PoolSnapshot
  cluster: ClusterResult
  brief: ArchiveBrief | null
  seed: number
  revisionHints?: string[]
  previousPlan?: ComposePlan
}

/**
 * Fisher-Yates ueber mulberry32(seed) — deterministisch je Seed (Test
 * „Cards gemischt (seed-stabil)"), aber nicht in Eingabe- oder
 * total_score-Reihenfolge. WARUM ueberhaupt mischen (Spec „Risiken":
 * „Positions-Bias, halluzinierte IDs" → Gegenmassnahme „zufaellige
 * Card-Reihenfolge"): ein Prompt, in dem die Cards nach total_score sortiert
 * stehen, liesse das Modell die Position statt den Inhalt bewerten — vorn
 * stehende Cards wuerden systematisch bevorzugt, unabhaengig vom Tagesthema.
 */
function seededShuffle<T>(values: T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Baut die drei Prompt-Teile: cachedPrefix (stabil, cache_control in
 * callTool) ist COMPOSE_SYSTEM plus der Betreiber-Prefix des Archivbriefs;
 * system ist der volatile Tagesblock des Briefs (oder ein Degradations-
 * Hinweis ohne Brief); user traegt Hand-Stories, Techmeme-Stories, aehnliche
 * Story-Paare und zuletzt die gemischten Cards — in genau dieser Reihenfolge,
 * weil COMPOSE_SYSTEM sie dem Modell in dieser Reihenfolge ankuendigt.
 */
export function buildComposeMessages(input: ComposeInput): { cachedPrefix: string; system: string; user: string } {
  const { cards, snapshot, cluster, brief, seed, revisionHints, previousPlan } = input
  const cachedPrefix = `${COMPOSE_SYSTEM}\n\n${brief?.systemPrefix ?? ''}`
  const system = brief ? brief.dayBlock : 'Kein Archivbrief verfügbar (degradiert).'

  const sections: string[] = []

  const handEntries = Object.entries(handStoriesOf(snapshot, cluster))
  if (handEntries.length > 0) {
    const lines = handEntries.map(([storyKey, memberIds]) => `s=${storyKey}: ${memberIds.join(', ')}`)
    sections.push(['Hand-Stories (jede genau einer Einheit zuordnen)', ...lines].join('\n'))
  }

  if (snapshot.techmemeStories.length > 0) {
    const lines = snapshot.techmemeStories.map((s) => `${s.story} #${s.index}: ${s.member_ids.join(', ')}`)
    sections.push(['Techmeme-Stories', ...lines].join('\n'))
  }

  if (cluster.related.length > 0) {
    const lines = cluster.related.map(([a, b, sim]) => `${a} ~ ${b} (${sim})`)
    sections.push(['Ähnliche Story-Paare (0,65–0,8)', ...lines].join('\n'))
  }

  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))
  const cardLines = seededShuffle(cards, seed)
    .map((card) => {
      const pItem = itemById.get(card.id)
      if (!pItem) return null
      const storyKey = cluster.storyKeyOf[card.id] ?? card.id
      const source = pItem.source_display_name ?? pItem.source_identifier
      const hand = pItem.hand ? ' HAND' : ''
      const techmeme = pItem.techmeme_story ? ` TM:${pItem.techmeme_story}` : ''
      return `[${card.id}] s=${storyKey} q=${source} t=${pItem.total_score.toFixed(1)}${hand}${techmeme} — ${pItem.title} — ${card.core}`
    })
    .filter((line): line is string => line !== null)
  sections.push(['Cards', ...cardLines].join('\n'))

  if (revisionHints && revisionHints.length > 0) {
    sections.push(['Revision — behebe:', ...revisionHints, JSON.stringify(previousPlan ?? null)].join('\n'))
  }

  return { cachedPrefix, system, user: sections.join('\n\n') }
}

export interface RawComposePlan {
  thesis: string
  units: Array<{
    member_ids: string[]
    role: string
    rank: number
    tier: string
    reason: string
    alternative: string
    precedent_ids: string[]
  }>
  techmeme_decisions: Array<{ story: string; decision: string }>
  hand_story_decisions: Array<{ story_key: string; decision: string; label: string }>
}

/** Lose Zod-Form der Tool-Antwort (strict schon im Tool-Schema erzwungen) — validatePlan macht die inhaltliche Pruefung. */
const ComposeOutputSchema = z.object({
  thesis: z.string(),
  units: z.array(z.object({
    member_ids: z.array(z.string()),
    role: z.string(),
    rank: z.number(),
    tier: z.string(),
    reason: z.string(),
    alternative: z.string(),
    precedent_ids: z.array(z.string()),
  })),
  techmeme_decisions: z.array(z.object({ story: z.string(), decision: z.string() })),
  hand_story_decisions: z.array(z.object({ story_key: z.string(), decision: z.string(), label: z.string() })),
})

export function parseComposeOutput(raw: unknown): RawComposePlan | null {
  const parsed = ComposeOutputSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** `${role ?? 'single'}::${storyKey}` — role null (Tool-Wert 'none') heisst „keine Rolle, eine Einzel-Einheit". */
export function unitKeyFor(role: CurationRole | null, storyKey: string): string {
  return `${role ?? 'single'}::${storyKey}`
}

const VALID_TIERS = new Set<string>(['recommended', 'bench', 'held'])

/**
 * Macht aus der rohen Tool-Antwort einen ComposePlan, der dessen Invarianten
 * erfuellt (Modul-Kommentar oben): unbekannte IDs entfernt, Dubletten
 * dedupliziert (erstes Vorkommen gewinnt), Einheiten ohne gueltigen Member
 * fallen komplett weg, mehr als 5 Quellen werden auf die 5 mit hoechstem
 * total_score gekappt (WARUM nach Score statt Eingabereihenfolge: die Harte
 * Regel 3 begrenzt auf 5 Quellen — die staerksten Belege sollen ueberleben,
 * nicht die, die das Modell zufaellig zuerst nannte), role 'none' → null,
 * ein ungueltiger tier-Wert faellt auf 'bench' (die unsichere Einheit landet
 * in der Bank statt in der Setzliste oder in held, das nur Hand-Einheiten
 * zusteht). story_key/unit_key werden danach aus den FINALEN member_ids
 * gebildet (Vertrag 3.7: „story_key = storyKeyOf[erster Member]" steht nach
 * der Kappung). Zwei Einheiten mit demselben unit_key duerfen nicht beide in
 * der Setzliste stehen (Harte Regel 4, „keine zwei Einheiten zur selben
 * Story") — die zweite wird zur Bank mit einem Suffix am Key, statt verworfen
 * zu werden (der Kritiker, Task 9, meldet story_duplicate trotzdem, aber der
 * Betreiber sieht die Story weiterhin). rank wird abschliessend je Tier in
 * der Reihenfolge der verbliebenen Einheiten neu ab 1 vergeben — der vom
 * Modell gelieferte rank ist nur ein Vorschlag, der durch Streichungen und
 * Tier-Korrekturen seine Luecken verlieren wuerde.
 */
export function validatePlan(
  raw: RawComposePlan,
  snapshot: PoolSnapshot,
  cluster: ClusterResult,
  precedentIds: Record<string, string>,
): ComposePlan {
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))
  const handIds = new Set(snapshot.handIds)
  const fixes: string[] = []
  const keyCounts = new Map<string, number>()

  const drafts: Omit<ComposeUnit, 'rank'>[] = []

  for (const u of raw.units) {
    const seen = new Set<string>()
    const known: string[] = []
    for (const id of u.member_ids) {
      if (!itemById.has(id)) { fixes.push(`unbekannte ID ${id} entfernt`); continue }
      if (seen.has(id)) continue
      seen.add(id)
      known.push(id)
    }
    if (known.length === 0) {
      fixes.push('Einheit ohne Member entfernt')
      continue
    }

    let member_ids = known
    let capped = false
    if (known.length > 5) {
      member_ids = [...known].sort((a, b) => itemById.get(b)!.total_score - itemById.get(a)!.total_score).slice(0, 5)
      capped = true
    }

    const story_key = cluster.storyKeyOf[member_ids[0]] ?? member_ids[0]
    if (capped) fixes.push(`Quellen auf 5 gekappt (${story_key})`)

    // Unbekannte Rolle → null statt ungeprueftem Cast (Final-Review
    // 2026-10-14 (R28), Minor 3): faellt `strict` weg (strictDropped,
    // lib/ai/call.ts), kann das Modell eine Rolle erfinden — sie verletzte den
    // CHECK auf curation_units.role, insertUnits scheiterte jeden Tick, und
    // der Run endete als error.
    let role: CurationRole | null = null
    if (u.role !== 'none') {
      if (CURATION_ROLES.includes(u.role as CurationRole)) role = u.role as CurationRole
      else fixes.push(`unbekannte Rolle '${u.role}' → keine Rolle`)
    }

    let tier: CurationTier = VALID_TIERS.has(u.tier) ? (u.tier as CurationTier) : 'bench'
    if (!VALID_TIERS.has(u.tier)) fixes.push(`tier '${u.tier}' → bench`)

    let unit_key = unitKeyFor(role, story_key)
    const count = (keyCounts.get(unit_key) ?? 0) + 1
    keyCounts.set(unit_key, count)
    if (count > 1) {
      fixes.push(`doppelter unit_key ${unit_key} → bench#${count}`)
      unit_key = `${unit_key}#${count}`
      tier = 'bench'
    }

    drafts.push({
      unit_key,
      member_ids,
      story_key,
      role,
      tier,
      reason: u.reason.slice(0, 160),
      alternative: u.alternative === '' ? null : u.alternative,
      precedent_ids: u.precedent_ids.map((p) => precedentIds[p]).filter((id): id is string => id !== undefined),
      is_hand: member_ids.some((id) => handIds.has(id)),
    })
  }

  const rankByTier = new Map<CurationTier, number>()
  const units: ComposeUnit[] = drafts.map((d) => {
    const rank = (rankByTier.get(d.tier) ?? 0) + 1
    rankByTier.set(d.tier, rank)
    return { ...d, rank }
  })

  const techmeme_decisions: TechmemeDecision[] = raw.techmeme_decisions.map((d) => ({
    story: d.story,
    decision: d.decision as TechmemeDecision['decision'],
  }))
  // label 'none' → null, analog zu role oben: der Betreiber kann einer
  // Hand-Story nur ein Label aus derselben Rollen-Enum vererben.
  const hand_story_decisions: HandStoryDecision[] = raw.hand_story_decisions.map((d) => ({
    story_key: d.story_key,
    decision: d.decision as HandStoryDecision['decision'],
    label: d.label === 'none' ? null : (d.label as CurationRole),
  }))

  return { thesis: raw.thesis, units, techmeme_decisions, hand_story_decisions, fixes, source: 'model' }
}

/**
 * Fallback-Plan rein aus der total_score-Baseline (Task 10 phaseCompose,
 * wenn Modell/Budget/Kritiker ausfallen) — kein Modellaufruf, keine Korrektur
 * noetig (fixes bleibt leer, thesis leer, keine Techmeme-/Hand-Entscheidungen).
 * Gruppierung ueber unitKeyOf wie die total_score-Baseline selbst
 * (totalScoreCandidates, baseline-day.ts): neutralizeHandLabels vorher, sonst
 * waere eine von Hand gesetzte Rolle eine eigene „Einheit" in einer Referenz,
 * die gerade die Nicht-Hand-Pipeline misst. Rang 1–10 → recommended, 11–20 →
 * bench (Vertrag 3.7). Hand-Stories, die in den obersten 20 keinen Platz
 * fanden, werden NICHT verworfen — held ist in dieser Baseline wie im
 * Modellplan „Hand-Einheiten ohne Platz" (Harte Regel 7, COMPOSE_SYSTEM oben).
 */
export function baselinePlan(snapshot: PoolSnapshot, cluster: ClusterResult, baseline: BaselineLists): ComposePlan {
  const itemById = new Map(neutralizeHandLabels(snapshot.items).map((item) => [item.id, item]))
  const handIds = new Set(snapshot.handIds)

  const order: string[] = []
  const membersByKey = new Map<string, string[]>()
  for (const id of baseline.total_score['20'] ?? []) {
    const item = itemById.get(id)
    if (!item) continue
    const key = unitKeyOf(id, item.bundle_type, item.metadata)
    if (!membersByKey.has(key)) { membersByKey.set(key, []); order.push(key) }
    membersByKey.get(key)!.push(id)
  }

  const units: ComposeUnit[] = order.map((unit_key, i) => {
    const member_ids = membersByKey.get(unit_key)!
    const tier: CurationTier = i < 10 ? 'recommended' : 'bench'
    const rank = i < 10 ? i + 1 : i - 10 + 1
    const story_key = cluster.storyKeyOf[member_ids[0]] ?? member_ids[0]
    return {
      unit_key, member_ids, story_key, role: null, rank, tier,
      reason: '', alternative: null, precedent_ids: [], is_hand: member_ids.some((id) => handIds.has(id)),
    }
  })

  const placedIds = new Set(units.flatMap((u) => u.member_ids))
  let heldRank = 0
  for (const [story_key, member_ids] of Object.entries(handStoriesOf(snapshot, cluster))) {
    if (member_ids.some((id) => placedIds.has(id))) continue
    heldRank++
    units.push({
      unit_key: unitKeyFor(null, story_key), member_ids, story_key, role: null, rank: heldRank, tier: 'held',
      reason: '', alternative: null, precedent_ids: [], is_hand: true,
    })
  }

  return { thesis: '', units, techmeme_decisions: [], hand_story_decisions: [], fixes: [], source: 'baseline' }
}

/**
 * EIN Modellaufruf fuer den Tagesplan: 24k Output-Tokens (alle 20 Einheiten
 * voll geschrieben, Spec-Entscheidung 1 „alle 20 voll"), effort 'medium'.
 * `thinking` bleibt unspezifiziert — callTool (lib/ai/call.ts) entscheidet
 * ueber die Modell-Capabilities, wie fuer jeden anderen Use-Case auch.
 * validatePlan laeuft NACH dem Call, nicht als `validate` selbst — `validate`
 * braucht Snapshot/Cluster/precedentIds nicht und bleibt dadurch die reine
 * Zod-Pruefung, die auch ein Retry innerhalb von callTool wiederverwenden kann.
 */
export async function composeDay(
  callTool: CallToolFn,
  input: ComposeInput,
  precedentIds: Record<string, string>,
): Promise<{ plan: ComposePlan; costUsd: number; model: string }> {
  const { cachedPrefix, system, user } = buildComposeMessages(input)
  const { result, costUsd, model } = await callTool({
    useCase: 'curation_editor',
    cachedPrefix,
    system,
    user,
    tool: COMPOSE_TOOL,
    maxTokens: 24000,
    effort: 'medium',
    validate: parseComposeOutput,
  })
  const plan = validatePlan(result, input.snapshot, input.cluster, precedentIds)
  return { plan, costUsd, model }
}
