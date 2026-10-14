/**
 * Scout der Morgenkonferenz (Task 6): je Pool-Item EIN Kernsatz per Haiku,
 * in Batches, mit Card-Cache (curation_cards). SCOUT_TOOL/SCOUT_SYSTEM sind
 * woertlich aus Anhang A §4.1 uebernommen — nur dort geaendert, nicht hier.
 *
 * WARUM nur CallInvalidError gefangen wird: callTool (lib/ai/call.ts) hat
 * bei einer leeren/ungueltigen Tool-Antwort schon EINEN Retry selbst
 * unternommen (Modul-Kommentar dort) — CallInvalidError heisst „auch nach
 * diesem Retry nichts Brauchbares", und genau dafuer gibt es den
 * Batch-Fallback (alle Items `missing`, Engine setzt spaeter fallbackCard
 * ein, Task 10 phaseScout). Jeder ANDERE Fehler (Netzwerk, CallRefusedError,
 * ein Tippfehler im Aufruf) ist kein Tool-Antwort-Problem, sondern ein
 * echter Ausfall — den soll scoutBatch NICHT stillschweigend in „alle
 * Items fehlen" uebersetzen, sonst verschleiert ein Netzwerkfehler sich als
 * normale Teil-Degradierung. Deshalb rethrow.
 */
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import { CallInvalidError, type CallToolFn } from '@/lib/ai/call'
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import type { PoolSnapshotItem, ScoutCard } from '@/lib/curation/types'

/** Scheibengroesse fuer .in()-Filter (Vertrag 0). */
const IN_CHUNK = 200

/** Kappe fuer `core` (Vertrag 3.5) — ein Kernsatz, kein Absatz. */
const CORE_MAX_CHARS = 240

export const SCOUT_TOOL: Anthropic.Tool = {
  name: 'report_cards',
  description: 'Liefert je Meldung einen Kernsatz (max. 25 Woerter) fuer die Redaktionskonferenz.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['cards'],
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'core'],
          properties: { id: { type: 'string' }, core: { type: 'string' } },
        },
      },
    },
  },
}

export const SCOUT_SYSTEM = `Du bist der Scout einer deutschen Tech-Redaktion (Newsletter ueber KI, Agenten, Software). Du bekommst Meldungen mit ID, Titel, Quelle und Auszug. Schreibe je Meldung EINEN Kernsatz auf Deutsch mit hoechstens 25 Woertern: Was ist passiert, wer, welche Zahl oder welches Produkt. Keine Bewertung, keine Empfehlung, keine Wiederholung des Titels. Gib die IDs unveraendert zurueck. Antworte ausschliesslich ueber das Tool report_cards.`

/** Zod-Form der Tool-Antwort — lose genug fuer parseScoutOutput, das selbst auf batchIds filtert. */
const ScoutOutputSchema = z.object({
  cards: z.array(z.object({ id: z.string(), core: z.string().min(1) })),
})

/** Eine Zeile je Item: `[<id>] <title> — <source> — <excerpt>` (Vertrag 3.5). */
export function buildScoutUser(items: PoolSnapshotItem[]): string {
  return items
    .map((item) => `[${item.id}] ${item.title} — ${item.source_display_name ?? item.source_identifier} — ${item.excerpt}`)
    .join('\n')
}

/**
 * Validiert die Tool-Antwort gegen die IDs DIESES Batches: Zod-Form pruefen,
 * IDs ausserhalb von `batchIds` ignorieren (ein Modell, das erfundene IDs
 * zurueckgibt, darf keine falschen Cards erzeugen), erstes Vorkommen gewinnt
 * bei Dubletten, `core` auf CORE_MAX_CHARS kappen. Liefert `null`, wenn
 * weniger als die Haelfte der Batch-IDs getroffen wurde — WARUM die
 * 50-%-Schwelle: eine Antwort, die nur ein paar Items beantwortet, ist kein
 * teilweiser Erfolg, sondern ein Hinweis, dass das Modell den Batch nicht
 * verstanden hat; callTool wertet `null` als ungueltig und retried einmal
 * (lib/ai/call.ts), danach greift scoutBatch mit CallInvalidError.
 */
export function parseScoutOutput(raw: unknown, batchIds: Set<string>): Map<string, string> | null {
  const parsed = ScoutOutputSchema.safeParse(raw)
  if (!parsed.success) return null

  const out = new Map<string, string>()
  for (const card of parsed.data.cards) {
    if (!batchIds.has(card.id) || out.has(card.id)) continue
    out.set(card.id, card.core.slice(0, CORE_MAX_CHARS))
  }

  const minHits = Math.ceil(batchIds.size / 2)
  if (out.size < minHits) return null
  return out
}

/** Fallback-Card, wenn der Scout ein Item nicht beantwortet hat: `core` = Titel. */
export function fallbackCard(item: PoolSnapshotItem): ScoutCard {
  return { id: item.id, core: item.title }
}

/**
 * EIN Modellaufruf fuer einen Batch. `missing` sind Batch-IDs ohne Card —
 * nach CallInvalidError alle, sonst die vom Modell ausgelassenen. Andere
 * Fehler wirft die Funktion weiter (s. Modul-Kommentar oben).
 */
export async function scoutBatch(
  callTool: CallToolFn,
  items: PoolSnapshotItem[],
): Promise<{ cards: ScoutCard[]; missing: string[]; costUsd: number }> {
  const ids = new Set(items.map((item) => item.id))

  try {
    const { result, costUsd } = await callTool({
      useCase: 'curation_scout',
      system: SCOUT_SYSTEM,
      user: buildScoutUser(items),
      tool: SCOUT_TOOL,
      maxTokens: 4096,
      thinking: false,
      validate: (raw) => parseScoutOutput(raw, ids),
    })

    const cards = [...result.entries()].map(([id, core]) => ({ id, core }))
    const missing = items.map((item) => item.id).filter((id) => !result.has(id))
    return { cards, missing, costUsd }
  } catch (err) {
    if (err instanceof CallInvalidError) {
      return { cards: [], missing: [...ids], costUsd: 0 }
    }
    throw err
  }
}

/** curation_cards je Modell, nur die ids, fuer die bereits eine Card existiert. Seiten à IN_CHUNK (Vertrag 0). */
export async function loadCachedCards(supabase: SupabaseAdmin, ids: string[], model: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase
      .from('curation_cards')
      .select('item_id, core')
      .in('item_id', chunk)
      .eq('model', model)
    if (error) throw new Error(`curation_cards select: ${error.message}`)
    for (const row of (data ?? []) as Array<{ item_id: string; core: string }>) out.set(row.item_id, row.core)
  }
  return out
}

/** Schreibt frische Cards in den Cache, einen Upsert je Modell (onConflict item_id,model). */
export async function saveCards(supabase: SupabaseAdmin, cards: ScoutCard[], model: string): Promise<void> {
  if (cards.length === 0) return
  const rows = cards.map((card) => ({ item_id: card.id, model, core: card.core }))
  const { error } = await supabase.from('curation_cards').upsert(rows, { onConflict: 'item_id,model' })
  if (error) throw new Error(`curation_cards upsert: ${error.message}`)
}

/** Teilt `items` in Scheiben à `size` (letzte Scheibe ggf. kleiner). */
export function batchesOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
