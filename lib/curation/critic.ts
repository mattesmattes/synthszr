/**
 * Kritiker der Morgenkonferenz (Task 9, Anhang A §3.8): prueft einen
 * ComposePlan gegen die harten Regeln aus §4.3 (COMPOSE_SYSTEM, Punkte 1–7)
 * deterministisch (checkHardRules/checkSoftRules) und — best effort, als
 * zweite Meinung — ueber ein Sonnet-Modell (critiqueWithModel). CRITIC_TOOL
 * ist woertlich aus Anhang A §4.4 uebernommen — nur dort geaendert, nicht hier.
 *
 * WARUM zwei Pruefwege: die deterministische Pruefung ist die, die Task 10
 * (phaseCompose) fuer die Revisionsschleife tatsaechlich braucht — nur ihre
 * `hard`-Codes loesen einen weiteren compose_day-Versuch aus (revisionHints).
 * Der Modell-Kritiker ist best effort (sein Fehler propagiert hier
 * unveraendert, der Aufrufer degradiert mit 'critic', Vertrag 3.9
 * phaseCompose) und liefert Hinweise, die eine rein regelbasierte Pruefung
 * nicht erkennt (inhaltliche Dubletten ohne Embedding-Treffer, falsch
 * gewaehlte Rollen, zu alte Meldungen) — deshalb getrennte `hard`/`soft`
 * Rueckgabe statt einer gemeinsamen Liste mit der deterministischen Pruefung.
 */
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { CallToolFn } from '@/lib/ai/call'
import { cosineSimilarity } from '@/lib/embeddings/generator'
import { handStoriesOf } from '@/lib/curation/cluster'
import type { ArchiveBrief, ClusterResult, ComposePlan, ComposeUnit, PoolSnapshot } from '@/lib/curation/types'

/** Schwellen aus §4.3 (Punkte 1–3, weiche Spannen in COMPOSE_SYSTEM) — hier benannt statt als Magic Numbers verstreut. */
export const HARD = {
  setzliste_min: 9,
  setzliste_max: 11,
  total_max: 20,
  sources_max: 5,
  source_share_max: 0.3,
  cover_max: 1,
  held_soft_max: 5,
  techmeme_topics_soft_max: 2,
} as const

/** Setzliste + Bank — die Menge, ueber die die meisten §4.3-Regeln laufen (Punkt 1, 2, 4). */
function recommendedAndBench(plan: ComposePlan): ComposeUnit[] {
  return plan.units.filter((u) => u.tier === 'recommended' || u.tier === 'bench')
}

/**
 * Deterministische Pruefung der harten Regeln (§4.3 Punkte 1–7). Liefert
 * einen Code je Verstoss, mehrere Codes je Regel moeglich (z. B. mehrere
 * story_duplicate-Paare) — die Reihenfolge der Codes ist nicht Teil des
 * Vertrags, revisionHints uebersetzt jeden Code unabhaengig von den anderen.
 */
export function checkHardRules(
  plan: ComposePlan,
  snapshot: PoolSnapshot,
  cluster: ClusterResult,
  embeddings: Map<string, number[]>,
): string[] {
  const codes: string[] = []
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))
  const recommended = plan.units.filter((u) => u.tier === 'recommended')
  const union = recommendedAndBench(plan)

  // Punkt 1: Setzliste 9 bis 11 Einheiten; Setzliste + Bank hoechstens 20.
  if (recommended.length < HARD.setzliste_min || recommended.length > HARD.setzliste_max) {
    codes.push(`setzliste_size:${recommended.length}`)
  }
  if (union.length > HARD.total_max) {
    codes.push(`total_size:${union.length}`)
  }

  // Punkt 2: hoechstens eine cover_story (in recommended ∪ bench — held zaehlt nicht zum Post).
  const coverCount = union.filter((u) => u.role === 'cover_story').length
  if (coverCount > HARD.cover_max) {
    codes.push(`cover_count:${coverCount}`)
  }

  // Punkt 3a: hoechstens 5 Quellen je Einheit — gilt fuer JEDE Einheit, nicht nur die Setzliste.
  for (const unit of plan.units) {
    if (unit.member_ids.length > HARD.sources_max) codes.push(`sources_max:${unit.unit_key}`)
  }

  // Punkt 3b: hoechstens 30 % der Setzliste aus derselben Quelle — nur ab 4
  // Einheiten (Vertrag), WARUM: bei weniger Einheiten erzwingt jede einzelne
  // Quelle schon > 30 % (1 von 3 ≈ 33 %) — die Regel waere dann immer
  // verletzt und ohne Aussagekraft. Eine Einheit zaehlt zur Quelle ihres
  // ERSTEN Members (Vertrag).
  if (recommended.length >= 4) {
    const countBySource = new Map<string, number>()
    for (const unit of recommended) {
      const leader = itemById.get(unit.member_ids[0])
      if (!leader) continue
      countBySource.set(leader.source_identifier, (countBySource.get(leader.source_identifier) ?? 0) + 1)
    }
    for (const [source, count] of countBySource) {
      const share = count / recommended.length
      if (share > HARD.source_share_max) codes.push(`source_share:${source}:${share.toFixed(2)}`)
    }
  }

  // Punkt 4: keine zwei Einheiten zur selben Story — gleicher story_key ODER
  // Anfuehrer (erstes Member) inhaltlich gleich (Cosine >= 0,8). Cosine nur,
  // wenn BEIDE Embeddings existieren und gleich lang sind: cosineSimilarity
  // wirft bei Dimensionsungleichheit (Vertrag §0) — ein fehlendes oder
  // inkompatibles Embedding darf den Kritiker nicht abbrechen, sondern nur
  // diesen einen Vergleich auslassen.
  for (let i = 0; i < union.length; i++) {
    for (let j = i + 1; j < union.length; j++) {
      const a = union[i]
      const b = union[j]
      const sameStory = a.story_key === b.story_key
      const embA = embeddings.get(a.member_ids[0])
      const embB = embeddings.get(b.member_ids[0])
      const sameContent = !!embA?.length && !!embB?.length && embA.length === embB.length && cosineSimilarity(embA, embB) >= 0.8
      if (sameStory || sameContent) codes.push(`story_duplicate:${a.unit_key}|${b.unit_key}`)
    }
  }

  // Punkt 5: nur IDs aus den Cards — jede member_id muss im Snapshot stehen
  // (je unbekannter ID genau EIN Code, auch wenn sie in mehreren Einheiten steht).
  const seenUnknown = new Set<string>()
  for (const unit of plan.units) {
    for (const id of unit.member_ids) {
      if (itemById.has(id) || seenUnknown.has(id)) continue
      seenUnknown.add(id)
      codes.push(`unknown_id:${id}`)
    }
  }

  // Punkt 6: jede Hand-Story ist genau EINER Einheit zugeordnet — nie
  // weggelassen (hand_missing), nie auf mehrere Einheiten verteilt
  // (hand_split). handStoriesOf liefert ALLE Member einer Hand-Story
  // (auch angehaengte Pipeline-Quellen), eine Einheit "beruehrt" die Story,
  // wenn irgendeines ihrer member_ids darin vorkommt.
  for (const [storyKey, memberIds] of Object.entries(handStoriesOf(snapshot, cluster))) {
    const touchingUnits = plan.units.filter((u) => u.member_ids.some((id) => memberIds.includes(id)))
    if (touchingUnits.length === 0) codes.push(`hand_missing:${storyKey}`)
    else if (touchingUnits.length > 1) codes.push(`hand_split:${storyKey}`)
  }

  // Punkt 7: held enthaelt nur Hand-Einheiten.
  for (const unit of plan.units) {
    if (unit.tier === 'held' && !unit.is_hand) codes.push(`held_not_hand:${unit.unit_key}`)
  }

  return codes
}

/**
 * Weiche Hinweise (§4.3 „Weiche Regeln" + Techmeme-Quote): kein Revisions-
 * Trigger fuer Task 10, aber Teil der gespeicherten Critique (Vertrag 2,
 * Critique.soft) und damit sichtbar fuer den Betreiber.
 */
export function checkSoftRules(plan: ComposePlan, snapshot: PoolSnapshot, cluster: ClusterResult): string[] {
  const codes: string[] = []

  const held = plan.units.filter((u) => u.tier === 'held')
  if (held.length > HARD.held_soft_max) codes.push(`held_many:${held.length}`)

  // label_conflict: nur moeglich, wenn eine Hand-Story bereits auf mehrere
  // Einheiten verteilt ist (hand_split) — dann zeigt diese Regel zusaetzlich,
  // ob die verteilten Einheiten sich auch in der Rolle widersprechen.
  for (const [storyKey, memberIds] of Object.entries(handStoriesOf(snapshot, cluster))) {
    const roles = new Set(plan.units.filter((u) => u.member_ids.some((id) => memberIds.includes(id))).map((u) => u.role))
    if (roles.size > 1) codes.push(`label_conflict:${storyKey}`)
  }

  // techmeme_topics: Techmeme hat die Story schon vorgeclustert
  // (story_key 'tm:<story>', Task 5 cluster.ts) — mehr als zwei solcher
  // Stories als topic/cover_story heisst, der Tag wird von Techmeme
  // bestimmt statt von eigener redaktioneller Auswahl.
  const techmemeTopics = plan.units.filter((u) => (u.role === 'topic' || u.role === 'cover_story') && u.story_key.startsWith('tm:')).length
  if (techmemeTopics > HARD.techmeme_topics_soft_max) codes.push(`techmeme_topics:${techmemeTopics}`)

  return codes
}

export const CRITIC_TOOL: Anthropic.Tool = {
  name: 'report_critique',
  description: 'Harte Verstoesse (muessen behoben werden) und weiche Hinweise zum Tagesplan.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['hard', 'soft'],
    properties: {
      hard: { type: 'array', items: { type: 'string' } },
      soft: { type: 'array', items: { type: 'string' } },
    },
  },
}

/** Quote aus Anhang A §4.4, woertlich. */
const CRITIC_SYSTEM_BASE = `Du bist der Kritiker der Morgenkonferenz. Pruefe den Plan gegen die harten Regeln (Liste folgt) und gegen den Snapshot (ID → Titel). Melde als hard nur klare Verstoesse mit Einheit und Grund; als soft Dubletten-Verdacht, falsche Rollen, Quellenhaeufung, zu alte Meldungen. Antworte ausschliesslich ueber das Tool report_critique.`

/** Hard-Regel-Text aus §4.3 (Punkte 1–7), woertlich wie in COMPOSE_SYSTEM (compose.ts) — hier eigenstaendig gehalten, Task 9 importiert nichts aus compose.ts (Vertrag: Consumes nur cluster.ts/cosineSimilarity/CallToolFn). */
const HARD_RULE_TEXT = `Harte Regeln (werden maschinell geprueft, Verstoss = Revision):
1. Setzliste 9 bis 11 Einheiten; Setzliste + Bank hoechstens 20.
2. Hoechstens eine cover_story.
3. Hoechstens 5 Quellen je Einheit; hoechstens 30 % der Setzliste aus derselben Quelle.
4. Keine zwei Einheiten zur selben Story (gleicher s=Schluessel oder inhaltlich gleich).
5. Nur IDs aus den Cards.
6. Jede Hand-Story (Cards mit HAND) ist genau EINER Einheit zugeordnet (recommended, bench oder held) — nie weggelassen, nie auf mehrere Einheiten verteilt. Mehrere Hand-Quellen derselben Story bilden eine Einheit.
7. held enthaelt nur Hand-Einheiten.`

/** System per §4.4: Kritiker-Auftrag, danach der Hard-Regel-Text (§4.3, Punkte 1–7). */
const CRITIC_SYSTEM = `${CRITIC_SYSTEM_BASE}\n\n${HARD_RULE_TEXT}`

const CritiqueOutputSchema = z.object({ hard: z.array(z.string()), soft: z.array(z.string()) })

function parseCritiqueOutput(raw: unknown): { hard: string[]; soft: string[] } | null {
  const parsed = CritiqueOutputSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * EIN Modellaufruf als zweite Meinung neben checkHardRules/checkSoftRules.
 * `cluster` und `brief` stehen in der Signatur, weil Task 10 (phaseCompose)
 * critiqueWithModel mit denselben Argumenten aufruft wie checkHardRules
 * (plan, snapshot, cluster) plus dem Archivbrief des Laufs — der Kritiker-
 * Prompt selbst braucht weder Cluster-Struktur noch Archivbrief (er prueft
 * den FERTIGEN Plan gegen Snapshot und Regeltext, nicht gegen Praezedenzen),
 * deshalb bleiben beide hier ungenutzt. Fehler (Netzwerk, CallRefusedError,
 * CallInvalidError) werden NICHT gefangen — der Aufrufer degradiert mit
 * 'critic' (Vertrag 3.9 phaseCompose) und braucht dafuer den echten Fehler.
 */
export async function critiqueWithModel(
  callTool: CallToolFn,
  plan: ComposePlan,
  snapshot: PoolSnapshot,
  _cluster: ClusterResult,
  _brief: ArchiveBrief | null,
): Promise<{ hard: string[]; soft: string[]; costUsd: number }> {
  const snapshotLines = snapshot.items.map((item) => `[${item.id}] ${item.title}`).join('\n')
  const user = [JSON.stringify(plan), `Snapshot:\n${snapshotLines}`, HARD_RULE_TEXT].join('\n\n')

  const { result, costUsd } = await callTool({
    useCase: 'curation_critic',
    system: CRITIC_SYSTEM,
    user,
    tool: CRITIC_TOOL,
    maxTokens: 4096,
    effort: 'low',
    validate: parseCritiqueOutput,
  })

  return { ...result, costUsd }
}

/** Menschenlesbare Revisionsanweisung je Code — Reihenfolge und Anzahl folgen `hard` 1:1. */
export function revisionHints(hard: string[]): string[] {
  return hard.map(revisionHint)
}

function revisionHint(code: string): string {
  const sep = code.indexOf(':')
  const prefix = sep < 0 ? code : code.slice(0, sep)
  const rest = sep < 0 ? '' : code.slice(sep + 1)

  switch (prefix) {
    case 'setzliste_size':
      return `Die Setzliste muss 9 bis 11 Einheiten haben (aktuell ${rest}).`
    case 'total_size':
      return `Setzliste und Bank zusammen duerfen hoechstens 20 Einheiten haben (aktuell ${rest}).`
    case 'cover_count':
      return `Es darf hoechstens eine cover_story geben (aktuell ${rest}).`
    case 'sources_max':
      return `Die Einheit ${rest} hat mehr als 5 Quellen — auf hoechstens 5 kuerzen.`
    case 'source_share': {
      const at = rest.lastIndexOf(':')
      const source = at < 0 ? rest : rest.slice(0, at)
      const share = at < 0 ? '' : rest.slice(at + 1)
      return `Die Quelle ${source} stellt mehr als 30 % der Setzliste (${share}) — Anteil senken.`
    }
    case 'story_duplicate': {
      const [a, b] = rest.split('|')
      return `Die Einheiten ${a} und ${b} behandeln dieselbe Story — zusammenlegen oder eine streichen.`
    }
    case 'unknown_id':
      return `Die ID ${rest} existiert nicht im Snapshot — entfernen.`
    case 'hand_missing':
      return `Die Hand-Story ${rest} fehlt — ordne sie genau einer Einheit zu (recommended, bench oder held).`
    case 'hand_split':
      return `Die Hand-Story ${rest} ist auf mehrere Einheiten verteilt — zu einer Einheit zusammenfassen.`
    case 'held_not_hand':
      return `Die Einheit ${rest} steht in held, ist aber keine Hand-Einheit — nach recommended oder bench verschieben.`
    default:
      return `Ungeklaerter Hinweis: ${code}.`
  }
}
