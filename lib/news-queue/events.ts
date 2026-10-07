/**
 * Ereignisprotokoll der News-Queue (Tabelle queue_item_events).
 *
 * Betreiber-Vorgabe 2026-10-05 (Spec „Herkunft und Hand-Begriff"):
 * status='selected' setzen heute vier Akteure (Admin-Route, Panel, Techmeme-
 * Job, Nachtlauf), und die news_queue-Zeile kennt keinen davon — nur
 * selected_at. Deshalb schreibt ab Phase 0 jeder Status-Setzer ein Event mit
 * Pflichtfeld `actor`; daraus leitet lib/curation/origin.ts (Task 4) die
 * Herkunft je Item ab (Akteur des jüngsten Events mit to_status='selected').
 *
 * Alle Funktionen nehmen den Client als ersten Parameter, damit sie ohne
 * vi.mock testbar sind (Muster lib/glossary/jobs/service.ts).
 */
import type { createAdminClient } from '@/lib/supabase/admin'

export type SupabaseAdmin = ReturnType<typeof createAdminClient>

export type QueueEventActor = 'operator' | 'techmeme' | 'agent' | 'pipeline'

export type QueueEventName =
  | 'select' | 'use' | 'skip' | 'expire' | 'reset' | 'stuck_reset' | 'remove' | 'relabel'
  | 'panel_accept' | 'panel_reject' | 'dedup_drop' | 'techmeme_promote' | 'merged_into'

export interface QueueEvent {
  queue_item_id: string
  event: QueueEventName
  actor: QueueEventActor
  from_status?: string | null
  to_status?: string | null
  from_role?: string | null
  to_role?: string | null
  reason?: string | null
  run_id?: string | null
}

export interface QueueEventRow extends QueueEvent {
  id: number
  at: string
}

// WARUM 200: .in()-Listen ab ~400 UUIDs (GET-Query-String) lösen gegen die
// Produktions-Supabase-Instanz einen HeadersOverflowError (undici) aus —
// empirisch geprüft (BEFUND in scripts/lib/taste-ground-truth.ts:7-11 und
// lib/news-taste/features.ts:100). Inserts bekommen dieselbe Scheibe, damit
// ein Vollreset der Queue (resetSelectedToPending, Task 5) keinen
// überlangen Request erzeugt.
const IN_CHUNK = 200

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Events schreiben — best-effort: Fehler werden geloggt, nie geworfen; eine
 * leere Liste macht keinen Aufruf.
 *
 * BEFUND 2026-10-06: Die Setzer, die hier anhängen, brechen bei einem Throw
 * ihren ganzen Lauf ab — promoteExistingTopicSources (lib/techmeme/job.ts:207-210)
 * den Techmeme-Lauf, selectItemsForArticle (lib/news-queue/service.ts:649,
 * aufgerufen aus lib/claude/queue-article.ts:245/305/322) den Nachtlauf.
 * Vertrag 2.4: Hooks dürfen den Setzer nie scheitern lassen. Preis: bei
 * DB-Störung fehlen Events still — originOf fällt dann auf den
 * metadata-Fallback zurück (Task 4).
 */
export async function recordQueueEvents(supabase: SupabaseAdmin, events: QueueEvent[]): Promise<void> {
  if (events.length === 0) return
  try {
    for (let i = 0; i < events.length; i += IN_CHUNK) {
      const chunk = events.slice(i, i + IN_CHUNK)
      const { error } = await supabase.from('queue_item_events').insert(chunk)
      if (error) {
        console.error('[QueueEvents] Failed to insert events:', error.message)
      }
    }
  } catch (err) {
    console.error('[QueueEvents] Failed to insert events:', errorMessage(err))
  }
}

/**
 * status + bundle_type je ID VOR dem Update — Quelle für from_status/
 * from_role der Events.
 *
 * BEFUND 2026-10-06: Alle heutigen Setzer schreiben per `update().in()` bzw.
 * `update().eq()` blind über den Vorzustand — markItemsAsUsed
 * (lib/news-queue/service.ts:689), skipItems (:730), resetSelectedToPending
 * (:935) und die Route reset-item (app/api/admin/news-queue/route.ts:476-484).
 * Danach ist from_status nicht mehr ablesbar. Darum lesen die Hooks
 * (Task 5/6) erst den Schnappschuss, dann setzen sie. Best-effort wie
 * recordQueueEvents: ein Lesefehler darf den Setzer nicht stoppen —
 * fehlende IDs ergeben from_status=null im Event.
 */
export async function readStatusSnapshot(
  supabase: SupabaseAdmin,
  ids: string[],
): Promise<Map<string, { status: string; bundle_type: string | null }>> {
  const snapshot = new Map<string, { status: string; bundle_type: string | null }>()
  if (ids.length === 0) return snapshot
  try {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from('news_queue')
        .select('id, status, bundle_type')
        .in('id', ids.slice(i, i + IN_CHUNK))
      if (error) {
        console.error('[QueueEvents] Failed to read status snapshot:', error.message)
        continue
      }
      for (const row of (data ?? []) as Array<{ id: string; status: string; bundle_type?: string | null }>) {
        snapshot.set(row.id, { status: row.status, bundle_type: row.bundle_type ?? null })
      }
    }
  } catch (err) {
    console.error('[QueueEvents] Failed to read status snapshot:', errorMessage(err))
  }
  return snapshot
}

/**
 * Alle Events je Item, aufsteigend nach (at, id). Jede übergebene ID hat
 * einen Eintrag — ohne Events ein leeres Array —, damit originOf (Task 4)
 * und der Präzedenz-Backfill (Task 11) keinen Sonderfall brauchen.
 *
 * WARUM in TS sortiert statt per .order(): Die Reihenfolge ist Vertrag
 * („jüngstes Event mit to_status='selected'" entscheidet die Herkunft) und
 * soll nicht von der PostgREST-Antwort abhängen. `at` kommt als ISO-String
 * mit variabler Nachkommastellenzahl (timestamptz), darum Date.parse statt
 * String-Vergleich; Gleichstand auf Millisekunde entscheidet die bigserial-
 * id (= Einfügereihenfolge).
 *
 * WARUM hier geworfen wird (anders als oben): Diese Funktion läuft im
 * Script-/Backfill-Pfad (Muster scripts/lib/taste-ground-truth.ts:65). Ein
 * stilles Leerergebnis hieße für originOf „kein Event" → Fallback
 * 'operator' — ein falsches Hand-Label, das niemand bemerkt. Lieber abbrechen.
 */
export async function loadEventsForItems(
  supabase: SupabaseAdmin,
  ids: string[],
): Promise<Map<string, QueueEventRow[]>> {
  const byItem = new Map<string, QueueEventRow[]>()
  if (ids.length === 0) return byItem
  // WARUM dedupen: Dieselbe ID in zwei Scheiben (z. B. Position 0 und 250)
  // würde jede Event-Zeile doppelt liefern und doppelt in die Liste pushen —
  // isConfirmedByOperator (Task 4, „Operator-Event NACH dem Herkunfts-Event")
  // sähe dann eine Reihenfolge, die es nie gab.
  const unique = [...new Set(ids)]
  for (const id of unique) byItem.set(id, [])
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('queue_item_events')
      .select('*')
      .in('queue_item_id', unique.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`queue_item_events: ${error.message}`)
    for (const row of (data ?? []) as QueueEventRow[]) {
      const list = byItem.get(row.queue_item_id)
      if (list) list.push(row)
      else byItem.set(row.queue_item_id, [row])
    }
  }
  for (const list of byItem.values()) {
    list.sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || (a.id - b.id))
  }
  return byItem
}
