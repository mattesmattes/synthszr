/**
 * Job-Service der servergetriebenen Lexikonlaeufe (Task 1 des Umbaus vom
 * 2026-08-05, s. Migration glossary_jobs). Legt Laeufe an und liest ihren
 * Status; das Vorruecken selbst (Tick, Lease, Protokoll) folgt in Task 2.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { openCandidateCount, readCrawlState } from '@/lib/glossary/crawl'

type AdminClient = ReturnType<typeof createAdminClient>

export type GlossaryJobKind = 'generate' | 'images' | 'relink'
export type GlossaryJobStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled'

export interface GlossaryJobLogEntry {
  at: string
  text: string
  ok: boolean
}

export interface GlossaryJob {
  id: string
  kind: GlossaryJobKind
  status: GlossaryJobStatus
  total: number | null
  done_count: number
  log: GlossaryJobLogEntry[]
  cancel_requested: boolean
  last_advanced_at: string | null
  attempts: number
  params: Record<string, unknown>
  error_message: string | null
  created_at: string
  finished_at: string | null
}

/**
 * Wie lange ein Lease gilt. MUSS ueber maxDuration (300s) liegen: das Lease
 * wird nur ZWISCHEN Arbeitseinheiten gestempelt, eine einzelne Einheit kann
 * 270s ohne Stempel laufen. Waere das Lease kuerzer, wuerde der naechste
 * Minutentick denselben Job uebernehmen und derselbe Begriff zweimal erzeugt —
 * mit doppelten Modellkosten. Sechs Minuten liegen ueber allem, was ein Tick
 * ueberleben kann; ein abgestuerzter Tick blockiert damit hoechstens so lange.
 */
export const LEASE_STALE_MS = 360_000

const OPEN = ['pending', 'processing'] as const

/** Postgres-Code fuer unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * Legt einen Lauf an — oder liefert den bereits offenen derselben Art.
 *
 * Idempotent, weil der partielle Unique-Index glossary_jobs_one_open_per_kind
 * nur einen offenen Job je Art zulaesst. Ein doppelter Klick im Panel soll
 * nicht in einen Fehler laufen, sondern auf den laufenden Lauf zeigen.
 */
export async function createOrGetJob(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  params: Record<string, unknown> = {},
): Promise<GlossaryJob> {
  const total = await estimateTotal(supabase, kind)

  const { data, error } = await supabase
    .from('glossary_jobs')
    .insert({ kind, params, total })
    .select('*')
    .single()

  if (!error && data) return data as GlossaryJob

  if (error && error.code === UNIQUE_VIOLATION) {
    const existing = await getOpenJob(supabase, kind)
    if (existing) return existing
  }
  throw new Error(`Job (${kind}) nicht anlegbar: ${error?.message ?? 'unbekannt'}`)
}

/**
 * Gesamtzahl fuer die Fortschrittsanzeige. Bei relink absichtlich null: die
 * Zahl der noch zu pruefenden Artikel haengt am Cursor und steht nicht vorab
 * fest — die Anzeige muss null als "Anzahl offen" lesen, nicht als Null.
 */
async function estimateTotal(supabase: AdminClient, kind: GlossaryJobKind): Promise<number | null> {
  if (kind === 'relink') return null
  if (kind === 'generate') {
    const state = await readCrawlState(supabase)
    return openCandidateCount(state.candidates, state.excluded, state.generated)
  }
  const { count } = await supabase
    .from('glossary_terms')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('illustration_url', null)
  return count ?? null
}

async function getOpenJob(supabase: AdminClient, kind: GlossaryJobKind): Promise<GlossaryJob | null> {
  const { data } = await supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
    .in('status', OPEN as unknown as string[])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}

/**
 * Lesepfad fuer das Polling im Panel: der offene Job dieser Art, sonst der
 * juengste abgeschlossene. Ohne den zweiten Teil wuerde das Panel in dem
 * Moment leer, in dem der Lauf fertig ist.
 */
export async function getJobStatus(
  supabase: AdminClient,
  kind: GlossaryJobKind,
): Promise<GlossaryJob | null> {
  const open = await getOpenJob(supabase, kind)
  if (open) return open

  const { data } = await supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}
