/**
 * Job-Service der servergetriebenen Lexikonlaeufe (Task 1 des Umbaus vom
 * 2026-08-05, s. Migration glossary_jobs). Legt Laeufe an und liest ihren
 * Status; das Vorruecken selbst (Tick, Lease, Protokoll) folgt in Task 2.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { openCandidateCount, readCrawlState } from '@/lib/glossary/crawl'
import { findMissingFromGlossary } from '@/lib/glossary/ensure-terms'
import type { GlossaryCandidate } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

export type GlossaryJobKind = 'generate' | 'images' | 'relink' | 'pending'
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
 * Legt einen Lauf an — oder liefert den bereits offenen derselben Art (bei
 * 'pending' zusaetzlich: desselben Artikels).
 *
 * Idempotent, weil der partielle Unique-Index glossary_jobs_one_open_per_kind
 * nur einen offenen Job je (Art, Artikel) zulaesst — 'pending' ist
 * artikelbezogen (params.postId), die uebrigen Arten global (postId immer
 * leer). Ein doppelter Klick im Panel soll nicht in einen Fehler laufen,
 * sondern auf den laufenden Lauf zeigen.
 */
export async function createOrGetJob(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  params: Record<string, unknown> = {},
): Promise<GlossaryJob> {
  const total = await estimateTotal(supabase, kind, params)

  const { data, error } = await supabase
    .from('glossary_jobs')
    .insert({ kind, params, total })
    .select('*')
    .single()

  if (!error && data) return data as GlossaryJob

  if (error && error.code === UNIQUE_VIOLATION) {
    // params durchreichen: der Unique-Index schluesselt 'pending' nach
    // (kind, postId) — ohne den Filter in getOpenJob wuerde der Konflikt den
    // offenen Job eines FREMDEN Artikels liefern (Review-Fund, 2026-08-05).
    const existing = await getOpenJob(supabase, kind, params)
    if (existing) return existing
  }
  throw new Error(`Job (${kind}) nicht anlegbar: ${error?.message ?? 'unbekannt'}`)
}

/**
 * Gesamtzahl fuer die Fortschrittsanzeige. Bei relink absichtlich null: die
 * Zahl der noch zu pruefenden Artikel haengt am Cursor und steht nicht vorab
 * fest — die Anzeige muss null als "Anzahl offen" lesen, nicht als Null.
 */
async function estimateTotal(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  params: Record<string, unknown>,
): Promise<number | null> {
  if (kind === 'relink') return null
  if (kind === 'generate') {
    const state = await readCrawlState(supabase)
    return openCandidateCount(state.candidates, state.excluded, state.generated)
  }
  if (kind === 'pending') {
    // Nicht bestimmbar ohne postId/confirmedSlugs (sollte die Admin-Route
    // schon abgefangen haben) — null heisst hier wie bei relink "Anzahl offen".
    const postId = params.postId as string | undefined
    const confirmedSlugs = (params.confirmedSlugs as string[] | undefined) ?? []
    if (!postId || confirmedSlugs.length === 0) return null
    const { data } = await supabase
      .from('generated_posts')
      .select('pending_glossary_terms')
      .eq('id', postId)
      .maybeSingle()
    const raw = (data as { pending_glossary_terms?: unknown } | null)?.pending_glossary_terms
    if (!Array.isArray(raw)) return null
    const confirmed = new Set(confirmedSlugs)
    const toGenerate = (raw as GlossaryCandidate[])
      .filter((c) => confirmed.has(c.slug) && c.needsGeneration)
    if (toGenerate.length === 0) return 0
    // FRISCH gegen glossary_terms prüfen statt dem needsGeneration-Flag allein
    // zu vertrauen: er wird beim Vormerken EINMAL gesetzt und nie
    // aktualisiert, wenn der Begriff seither über einen ANDEREN Artikel
    // entstanden ist. Ohne diese Prüfung zeigte total() z.B. 37 (alle jemals
    // vorgemerkten, seit überholten Kandidaten), während tatsächlich nur ein
    // einziger offen war (Betreiber-Befund 2026-08-06) — ein normal laufender
    // Job sah dadurch aus wie ein Hänger. Dieselbe Funktion wie
    // generateMissingTerms (ensure-terms.ts), damit Anzeige und tatsächliche
    // Abarbeitung nie eine andere Definition von "offen" verwenden.
    const missing = await findMissingFromGlossary(supabase, toGenerate)
    return missing === null ? null : missing.length
  }
  const { count } = await supabase
    .from('glossary_terms')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('illustration_url', null)
  return count ?? null
}

async function getOpenJob(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  params: Record<string, unknown> = {},
): Promise<GlossaryJob | null> {
  let query = supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
    .in('status', OPEN as unknown as string[])
  const postId = params.postId as string | undefined
  if (postId) {
    // Der Unique-Index schluesselt 'pending' zusaetzlich nach postId (s.
    // Migration) — ohne diesen Filter liefert ein Konflikt den offenen Job
    // eines FREMDEN Artikels. Fuer generate/images/relink bleibt postId immer
    // leer, dieser Zweig greift dort also nie.
    query = query.eq('params->>postId', postId)
  }
  const { data } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}

/**
 * Lesepfad fuer das Polling im Panel: der offene Job dieser Art, sonst der
 * juengste abgeschlossene. Ohne den zweiten Teil wuerde das Panel in dem
 * Moment leer, in dem der Lauf fertig ist.
 *
 * `postId` ist bei kind='pending' PFLICHT: seit dem artikelweisen Unique-
 * Index (Review-Fund) koennen mehrere 'pending'-Jobs gleichzeitig offen sein
 * (einer je Artikel) — ohne postId waere "der" pending-Job nicht mehr
 * eindeutig, und die Fallback-Abfrage unten koennte den zuletzt
 * abgeschlossenen Job eines FREMDEN Artikels liefern. Deshalb hier ein
 * fruehes `null` statt einer mehrdeutigen Abfrage — genau der Fund, der
 * diesen Umbau ausgeloest hat (fremdes "Fertig" im eigenen Panel).
 */
export async function getJobStatus(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  postId?: string,
): Promise<GlossaryJob | null> {
  if (kind === 'pending' && !postId) return null

  const open = await getOpenJob(supabase, kind, postId ? { postId } : {})
  if (open) return open

  let query = supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
  if (postId) query = query.eq('params->>postId', postId)
  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}

/**
 * Der aelteste offene Job, dessen Lease abgelaufen ist.
 *
 * Genau EIN Lexikonlauf gleichzeitig, quer ueber ALLE Arten (Befund N1 des
 * Abschluss-Reviews): generate und relink schreiben beide Read-Modify-Write
 * auf demselben JSONB (settings.glossary_crawl_state, s. readCrawlState /
 * writeRelinkCursor). Ein Filter, der nur das Lease DES JOBS prueft, den er
 * gerade holt, verhindert nicht, dass ZWEI VERSCHIEDENE Arten gleichzeitig
 * laufen: Tick 1 greift den generate-Job und haelt das Read-Modify-Write-
 * Fenster 45-270s offen; Tick 2 sieht dessen frisch gestempeltes Lease,
 * ueberspringt NUR diesen Job und nimmt stattdessen den relink-Job. relink
 * schreibt dann alle paar Sekunden den vollen Crawl-Zustand zurueck,
 * darunter den relinkCursor auf dem Stand VOR dem laufenden generate-Aufruf
 * — meldet dabei "unchanged" statt eines Fehlers und eskaliert nie: ein
 * Livelock ueber die gesamte Laufzeit des Begriffslaufs.
 *
 * Deshalb vor der Auswahl pruefen, ob IRGENDEIN offener Job (gleich welcher
 * Art) gerade ein frisches Lease haelt, und in dem Fall diesen Tick aussetzen.
 *
 * Gleiche Bauart wie article-jobs/service.ts:201. `now` ist Parameter, nicht
 * Date.now() im Rumpf, damit der Lease-Filter testbar bleibt.
 */
export async function getNextOpenJob(
  supabase: AdminClient,
  now: number = Date.now(),
): Promise<GlossaryJob | null> {
  const staleBefore = new Date(now - LEASE_STALE_MS).toISOString()

  const { data: leased, error: leaseError } = await supabase
    .from('glossary_jobs')
    .select('id')
    .in('status', OPEN as unknown as string[])
    .gte('last_advanced_at', staleBefore)
    .limit(1)
    .maybeSingle()
  if (leaseError) {
    // Befund N4: ohne dieses Log ist eine fehlende Tabelle (Migration noch
    // nicht angewendet) von "gerade nichts zu tun" nicht zu unterscheiden —
    // der Minutentakt-Cron antwortet in beiden Faellen lautlos {ok:true,
    // idle:true}, dauerhaft.
    console.error('[GlossaryJobs] getNextOpenJob (Lease-Check) fehlgeschlagen:', leaseError.message)
    return null
  }
  if (leased) return null

  const { data, error } = await supabase
    .from('glossary_jobs')
    .select('*')
    .in('status', OPEN as unknown as string[])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) console.error('[GlossaryJobs] getNextOpenJob fehlgeschlagen:', error.message)
  return (data as GlossaryJob | null) ?? null
}

/** Stempelt das Lease und setzt den Job auf 'processing'. */
export async function stampLease(supabase: AdminClient, id: string): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({ status: 'processing', last_advanced_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Gibt das Lease frei, ohne den Status zu aendern.
 *
 * NUR aufrufen, nachdem die letzte Einheit eines Ticks abgeschlossen und ihr
 * Ergebnis persistiert ist — sonst koennte ein zweiter Minutentick denselben
 * Job uebernehmen, waehrend der erste noch arbeitet.
 *
 * Ohne diese Freigabe bleibt last_advanced_at auf dem zuletzt von appendLog
 * gestempelten Wert stehen, wenn ein Tick ohne Abschluss endet (Budget
 * aufgebraucht oder Ueberlast unter dem Attempts-Limit). getNextOpenJob
 * haette den Job dann erst nach LEASE_STALE_MS (6 Minuten) wieder aufgegriffen
 * statt im naechsten Minutentick — aus "naechster Cron in einer Minute" waeren
 * ohne diese Funktion sechs Minuten geworden.
 */
export async function releaseLease(supabase: AdminClient, id: string): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({ last_advanced_at: null })
    .eq('id', id)
}

/**
 * Haengt Protokollzeilen an und erhoeht den Zaehler.
 *
 * Read-modify-write auf dem JSONB: der Job wird immer nur von EINEM Tick
 * bearbeitet (Lease), ein verlorenes Update ist damit ausgeschlossen. Das Lease
 * wird gleich mitgestempelt, weil eine Protokollzeile beweist, dass der Tick
 * lebt.
 */
export async function appendLog(
  supabase: AdminClient,
  job: GlossaryJob,
  entries: GlossaryJobLogEntry[],
  doneDelta: number,
): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({
      log: [...job.log, ...entries],
      done_count: job.done_count + doneDelta,
      last_advanced_at: new Date().toISOString(),
    })
    .eq('id', job.id)
  // Der Aufrufer arbeitet mit derselben Job-Kopie weiter.
  job.log = [...job.log, ...entries]
  job.done_count = job.done_count + doneDelta
}

/** Merkt den Abbruchwunsch an. Der naechste Tick wertet ihn aus. */
export async function requestCancel(supabase: AdminClient, kind: GlossaryJobKind): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({ cancel_requested: true })
    .eq('kind', kind)
    .in('status', OPEN as unknown as string[])
}

export async function finishJob(
  supabase: AdminClient,
  id: string,
  status: GlossaryJobStatus,
  errorMessage?: string,
): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    })
    .eq('id', id)
}

/** Zaehlt erfolglose Ticks; bei Erfolg zurueck auf 0. */
export async function setAttempts(supabase: AdminClient, id: string, attempts: number): Promise<void> {
  await supabase.from('glossary_jobs').update({ attempts }).eq('id', id)
}
