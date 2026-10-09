/**
 * Herkunft und Hand-Begriff je Queue-Item.
 *
 * BEFUND 2026-10-06 (Spec „Herkunft und Hand-Begriff"): `status='selected'`
 * setzen vier Akteure — die Admin-Route (`news-queue/route.ts` case 'select'),
 * die Panel-Annahme (`ranking-feedback/route.ts`), der Techmeme-Job
 * (`techmeme/job.ts`, Marker `metadata.techmeme=true`) und der Nachtlauf
 * (`queue-article.ts`) — und die Zeile kennt keinen davon: `selected_at` steht
 * drin, der Setzer nicht. „Vom Betreiber gewählt" war damit nirgends
 * operational; am 03.10. ließ der Betreiber 89 von 100 Techmeme-Items
 * verfallen, die ein naiver Hand-Begriff als seine Wahl gezählt hätte.
 *
 * Seit Phase 0 schreibt jeder Setzer ein Event nach `queue_item_events`
 * (lib/news-queue/events.ts). Diese Datei liest NUR: Herkunft = Akteur des
 * jüngsten Events mit to_status='selected'; jedes spätere Operator-Event macht
 * das Item „bestätigt"; Hand-Item = Herkunft operator ODER bestätigt. Die
 * Hand-Invariante, `held`, der fill-Modus und die Rekonziliation (Phase 2)
 * sowie `classifyPrecedents` (Task 11) benutzen dieselbe Funktion `isHandItem`.
 *
 * Die Events kommen aufsteigend nach (at, id) aus `loadEventsForItems`; hier
 * wird NICHT sortiert — die Array-Reihenfolge ist die Zeitachse.
 */
import type { QueueEventName, QueueEventRow } from '@/lib/news-queue/events'

export type ItemOrigin = 'operator' | 'techmeme' | 'agent' | 'pipeline'

export interface OriginInput {
  id: string
  metadata: Record<string, unknown> | null
}

/** Index des jüngsten Events mit to_status='selected', −1 wenn keines. */
function originEventIndex(events: QueueEventRow[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].to_status === 'selected') return i
  }
  return -1
}

/**
 * Fallback für Zeilen ohne Herkunfts-Event: Bestand vor Phase 0 oder ein
 * verpasster Hook. Reihenfolge ist Spec-Vorgabe („Herkunft und Hand-Begriff"):
 * `metadata.curation.run_id` → agent (der Protokollant kann auch Techmeme-Items
 * in seinen Lauf aufnehmen, dann ist der Lauf die Herkunft; zählt nur als
 * nicht-leerer String, damit halb geschriebene Metadaten kein agent-Item
 * erzeugen), `metadata.techmeme === true` → techmeme, sonst operator.
 *
 * `operator` ist für Bestandszeilen bewusst unscharf: auch der Nachtlauf
 * (`queue-article.ts` → `selectItemsForArticle`, die Balanced-Pfade; der Pfad
 * mit expliziten queueItemIds ist Handauswahl) setzt Items mit `metadata: {}`
 * auf selected, ohne Marker — die fallen hier ebenfalls unter operator. Task 11
 * beschränkt sich deshalb auf `source='manual'`-Jobs; ab Phase 0 trägt jede
 * Nachtlauf-Wahl ein select-Event mit actor pipeline, und dieser Fallback
 * greift für sie nicht mehr.
 */
function originFromMetadata(metadata: Record<string, unknown> | null): ItemOrigin {
  if (!metadata) return 'operator'
  const curation = metadata.curation
  if (
    typeof curation === 'object' &&
    curation !== null &&
    typeof (curation as Record<string, unknown>).run_id === 'string' &&
    ((curation as Record<string, unknown>).run_id as string).length > 0
  ) {
    return 'agent'
  }
  if (metadata.techmeme === true) return 'techmeme'
  return 'operator'
}

/**
 * Akteur des jüngsten Events mit to_status='selected'; ohne solches Event der
 * Fallback aus den Metadaten (s. originFromMetadata).
 */
export function originOf(item: OriginInput, events: QueueEventRow[]): ItemOrigin {
  const idx = originEventIndex(events)
  if (idx >= 0) return events[idx].actor
  return originFromMetadata(item.metadata)
}

/**
 * Operator-Handlungen, die ein fremd gewähltes Item zum Hand-Item machen.
 * Spec: „`relabel` über PATCH bundle-type, `keep`/`promote` im Panel
 * (= panel_accept), `select` nach Reset". reset/skip/remove/panel_reject sind
 * das Gegenteil einer Bestätigung und fehlen hier bewusst. `select` aus dem
 * Task-5-Hook trägt immer to_status='selected' und ist damit selbst das
 * Herkunfts-Event; hier zählt es nur für select-Events anderer Schreiber ohne
 * Statuswechsel (Vertrag 2.3).
 */
const CONFIRMING_EVENTS: ReadonlySet<QueueEventName> = new Set<QueueEventName>(['relabel', 'panel_accept', 'select'])

/**
 * true, wenn ein Operator-Event aus CONFIRMING_EVENTS NACH dem Herkunfts-Event
 * liegt. Ein Operator-Event VOR dem Herkunfts-Event zählt nicht: es galt einem
 * früheren Zustand (Item wurde danach zurückgesetzt und neu gewählt).
 *
 * Ohne Herkunfts-Event (Bestand vor Phase 0, verpasster Hook) zählt jedes
 * Operator-Event — Index −1, alles liegt „danach". So wird ein altes
 * Techmeme-Item, dem der Betreiber ein Label gibt, zum Hand-Item, obwohl sein
 * Einstellen nie protokolliert wurde.
 */
export function isConfirmedByOperator(events: QueueEventRow[]): boolean {
  const start = originEventIndex(events) + 1
  for (let i = start; i < events.length; i++) {
    const e = events[i]
    if (e.actor === 'operator' && CONFIRMING_EVENTS.has(e.event)) return true
  }
  return false
}

/**
 * Hand-Item = Herkunft operator ODER vom Betreiber bestätigt. Ein unberührtes
 * Techmeme-Item ist keines; ein Techmeme-Item mit Betreiber-Label ist eines.
 */
export function isHandItem(item: OriginInput, events: QueueEventRow[]): boolean {
  return originOf(item, events) === 'operator' || isConfirmedByOperator(events)
}
