/**
 * DB-Helfer der Morgenkonferenz-Engine, Phase 1 „Shadow" (Task 3): Läufe
 * (curation_runs), Einheiten (curation_units) und Betreiber-Einstellungen.
 * Pattern wie lib/glossary/jobs/service.ts (claimJob/appendLog/finishJob/
 * releaseLease) — Client als erster Parameter (Vertrag 0), Lease gegen
 * ueberlappende Cron-Ticks, Scheiben à 200 fuer .in()-Filter und Inserts.
 * Reine Engine-Logik (Pool, Scout, Cluster, Archiv, Compose, Kritik) folgt in
 * spaeteren Tasks — diese Datei kennt nur die Zeilen, nicht deren Inhalt.
 */
import type { SupabaseAdmin } from '@/lib/news-queue/events'
import {
  DEFAULT_CURATION_SETTINGS,
  MATCH_WINDOW_MS,
  RUN_SUMMARY_COLUMNS,
  type BriefMode,
  type CurationSettings,
  type RunLogEntry,
  type RunMetrics,
  type RunMode,
  type RunRow,
  type RunSummary,
  type UnitInsert,
  type UnitRow,
} from '@/lib/curation/types'

/**
 * Wie lange ein Lease gilt. MUSS ueber der maxDuration der Cron-Route liegen
 * (800 s, Anhang A §0) — sonst uebernaehme der naechste Minutentick denselben
 * Run, waehrend der vorige Tick noch arbeitet (gleiche Begruendung wie
 * glossary_jobs LEASE_STALE_MS, lib/glossary/jobs/service.ts). 15 Minuten
 * liegen ueber allem, was ein Tick ueberleben kann; ein abgestuerzter Tick
 * blockiert damit hoechstens so lange.
 */
export const LEASE_STALE_MS = 900_000

/** Erfolglose Ticks in Folge, ab denen ein Run aufgibt (Muster glossary/jobs/advance.ts). */
export const MAX_ATTEMPTS = 10

/** Scheibengroesse fuer .in()-Filter und Inserts (Vertrag 0). */
const IN_CHUNK = 200

/** Offene Status eines Laufs — ein Run in 'done'/'error'/'cancelled' zaehlt nicht mehr als belegt. */
const OPEN_STATUSES = ['pending', 'processing'] as const

/** Postgres-Code fuer unique_violation (hier: curation_runs_one_open_per_day). */
const UNIQUE_VIOLATION = '23505'

/** 'HH:MM', 00–23 : 00–59 — alles andere ist ein ungueltiger Kickoff. */
const KICKOFF_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Zeitstempel fuer Protokollzeilen, 'DD.MM. HH:MM:SS' in Berliner Zeit —
 * identischer Rumpf wie stamp() in lib/glossary/jobs/advance.ts. Ohne die
 * explizite Zeitzone laese die Funktion die Serverzeit (auf Vercel UTC), und
 * appendRunLog-Zeilen verschoeben sich um zwei Stunden gegen das, was der
 * Betreiber im Panel sieht.
 */
export function stamp(): string {
  return new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin',
  })
}

/** Einheitliche Fehlermeldung ueber alle Funktionen dieser Datei (Vertrag: 'tabelle: nachricht'). */
function fail(table: string, error: { message: string } | null | undefined): never {
  throw new Error(`${table}: ${error?.message ?? 'unbekannt'}`)
}

/**
 * Legt einen Run an — oder liefert den bereits offenen Run desselben Tages
 * und Modus, falls einer existiert.
 *
 * Idempotent, weil der partielle Unique-Index curation_runs_one_open_per_day
 * (Anhang A §1) nur EINEN offenen Run je (day, mode) zulaesst: ein doppelter
 * Cron-Tick oder ein zweiter Klick im Panel soll nicht mit einem Fehler
 * enden, sondern auf den laufenden Run zeigen (Muster createOrGetJob,
 * lib/glossary/jobs/service.ts).
 */
export async function createRun(
  supabase: SupabaseAdmin,
  input: {
    day: string
    mode: RunMode
    asof: string
    brief_mode: BriefMode
    budget_usd: number
    models: { scout: string; editor: string; critic: string }
  },
): Promise<RunRow> {
  const row = {
    day: input.day,
    mode: input.mode,
    asof: input.asof,
    brief_mode: input.brief_mode,
    budget_usd: input.budget_usd,
    model_scout: input.models.scout,
    model_editor: input.models.editor,
    model_critic: input.models.critic,
  }
  const { data, error } = await supabase.from('curation_runs').insert(row).select('*').single()

  if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
    const open = await supabase
      .from('curation_runs')
      .select('*')
      .eq('day', input.day)
      .eq('mode', input.mode)
      .in('status', OPEN_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (open.error || !open.data) fail('curation_runs', open.error)
    return parseRunRow(open.data as Record<string, unknown>)
  }
  if (error || !data) fail('curation_runs', error)
  return parseRunRow(data as Record<string, unknown>)
}

export async function getRun(supabase: SupabaseAdmin, id: string): Promise<RunRow | null> {
  const { data, error } = await supabase.from('curation_runs').select('*').eq('id', id).maybeSingle()
  if (error) fail('curation_runs', error)
  return data ? parseRunRow(data as Record<string, unknown>) : null
}

/**
 * Der aelteste offene Shadow-Run, dessen Lease abgelaufen ist (oder nie
 * gestempelt wurde). Nur `mode = 'shadow'`: Backtest-Laeufe (Task 10+)
 * werden synchron angestossen, nicht ueber den Minutentick.
 */
export async function getNextOpenRun(supabase: SupabaseAdmin, now: number = Date.now()): Promise<RunRow | null> {
  const staleBefore = new Date(now - LEASE_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from('curation_runs')
    .select('*')
    .eq('mode', 'shadow')
    .in('status', OPEN_STATUSES as unknown as string[])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) fail('curation_runs', error)
  const rows = (data ?? []) as Record<string, unknown>[]
  return rows.length ? parseRunRow(rows[0]) : null
}

/**
 * Nimmt einen Run fuer diesen Tick an: Lease stempeln UND den Versuch
 * zaehlen, in EINEM Update, BEVOR gearbeitet wird — gleiche Begruendung wie
 * claimJob (lib/glossary/jobs/service.ts): ein Tick, der ins
 * Function-Timeout laeuft, wird hart beendet und kann danach nichts mehr
 * schreiben. Der Zaehler muss also schon beim Start persistiert sein, sonst
 * eskaliert ein gekillter Tick nie.
 *
 * Compare-and-Set (Final-Review 2026-10-14 (R23), I2): das Update greift nur,
 * wenn der Run offen ist und kein frisches Lease traegt — dieselbe Bedingung
 * wie getNextOpenRun, aber atomar in der UPDATE-Anweisung. Lesen und
 * Schreiben getrennt liessen zwei Ticks (doppelte Cron-Zustellung, manueller
 * Lauf im Vercel-Dashboard) oder Script und Cron denselben Run parallel
 * bearbeiten: doppelte Opus-Calls, Unique-Fehler in insertUnits, verlorene
 * Log-Zeilen. `false` heisst: jemand anderes haelt den Run, keine Arbeit.
 */
export async function claimRun(
  supabase: SupabaseAdmin,
  id: string,
  attempts: number,
  now: number = Date.now(),
): Promise<boolean> {
  const staleBefore = new Date(now - LEASE_STALE_MS).toISOString()
  const { data, error } = await supabase
    .from('curation_runs')
    .update({ status: 'processing', last_advanced_at: new Date(now).toISOString(), attempts })
    .eq('id', id)
    .in('status', OPEN_STATUSES as unknown as string[])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .select('id')
  if (error) fail('curation_runs', error)
  return ((data ?? []) as unknown[]).length > 0
}

/**
 * Gibt das Lease frei, ohne den Status zu aendern. Nur aufrufen, NACHDEM die
 * letzte Einheit eines Ticks abgeschlossen und ihr Ergebnis persistiert ist
 * — sonst koennte ein zweiter Minutentick denselben Run uebernehmen, waehrend
 * der erste noch arbeitet (Muster releaseLease, lib/glossary/jobs/service.ts).
 */
export async function releaseLease(supabase: SupabaseAdmin, id: string): Promise<void> {
  const { error } = await supabase.from('curation_runs').update({ last_advanced_at: null }).eq('id', id)
  if (error) fail('curation_runs', error)
}

/** Schreibt einen Teil-Zustand (z. B. pool, cards, phase) und stempelt das Lease mit. */
export async function saveRunState(supabase: SupabaseAdmin, id: string, patch: Partial<RunRow>): Promise<void> {
  const { error } = await supabase
    .from('curation_runs')
    .update({ ...patch, last_advanced_at: new Date().toISOString() })
    .eq('id', id)
  if (error) fail('curation_runs', error)
}

/**
 * Haengt Protokollzeilen an und stempelt das Lease mit — eine Protokollzeile
 * beweist, dass der Tick lebt (Muster appendLog, lib/glossary/jobs/service.ts).
 * Read-modify-write auf dem JSONB ist unkritisch: der Run wird immer nur von
 * EINEM Tick bearbeitet (Lease). Der Aufrufer arbeitet mit derselben
 * Run-Kopie weiter, deshalb mutiert die Funktion `run.log`.
 */
export async function appendRunLog(supabase: SupabaseAdmin, run: RunRow, entries: RunLogEntry[]): Promise<void> {
  const log = [...run.log, ...entries]
  const { error } = await supabase
    .from('curation_runs')
    .update({ log, last_advanced_at: new Date().toISOString() })
    .eq('id', run.id)
  if (error) fail('curation_runs', error)
  run.log = log
}

/**
 * Beendet einen Run und gibt das Lease frei. Nur 'done' schaltet die Phase
 * zusaetzlich auf 'finished' — ein abgebrochener oder fehlgeschlagener Run
 * bleibt auf der Phase stehen, in der er stecken blieb, damit das Panel
 * zeigt, WO der Lauf scheiterte, statt das als erledigt zu verschleiern.
 */
export async function finishRun(
  supabase: SupabaseAdmin,
  id: string,
  status: 'done' | 'error' | 'cancelled',
  errorMessage?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    finished_at: new Date().toISOString(),
    error_message: errorMessage ?? null,
    last_advanced_at: null,
  }
  if (status === 'done') patch.phase = 'finished'
  const { error } = await supabase.from('curation_runs').update(patch).eq('id', id)
  if (error) fail('curation_runs', error)
}

/**
 * Ersetzt ALLE Einheiten eines Runs: erst delete where run_id = ?, dann
 * insert in Scheiben à 200 (Vertrag 0). Idempotent je Run — ein wiederholter
 * Tick (z. B. nach einem Timeout VOR insertUnits' Abschluss) darf dieselben
 * Einheiten nicht doppelt anlegen; ein Upsert waere hier kein Ersatz, weil
 * ein Neulauf auch WENIGER Einheiten erzeugen kann (gleiche Begruendung wie
 * replacePrecedentDay, lib/curation/precedents.ts).
 */
export async function insertUnits(supabase: SupabaseAdmin, runId: string, units: UnitInsert[]): Promise<void> {
  const del = await supabase.from('curation_units').delete().eq('run_id', runId)
  if (del.error) fail('curation_units', del.error)
  for (let i = 0; i < units.length; i += IN_CHUNK) {
    const batch = units.slice(i, i + IN_CHUNK).map((unit) => ({ ...unit, run_id: runId }))
    const { error } = await supabase.from('curation_units').insert(batch)
    if (error) fail('curation_units', error)
  }
}

/** Leichte Listenansicht fuer das Admin-Panel (Task 13): nur RUN_SUMMARY_COLUMNS, ohne die schweren JSON-Spalten. */
export async function listRuns(supabase: SupabaseAdmin, opts: { limit: number; mode?: RunMode }): Promise<RunSummary[]> {
  let query = supabase.from('curation_runs').select(RUN_SUMMARY_COLUMNS)
  if (opts.mode) query = query.eq('mode', opts.mode)
  const { data, error } = await query
    .order('day', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit)
  if (error) fail('curation_runs', error)
  return ((data ?? []) as Record<string, unknown>[]).map((row) => parseRunRow(row) as RunSummary)
}

/** Einheiten eines Runs, in Panel-Reihenfolge: Tier (recommended/bench/held), dann Rang. */
export async function getRunUnits(supabase: SupabaseAdmin, runId: string): Promise<UnitRow[]> {
  const { data, error } = await supabase
    .from('curation_units')
    .select('*')
    .eq('run_id', runId)
    .order('tier')
    .order('rank')
  if (error) fail('curation_units', error)
  return (data ?? []) as UnitRow[]
}

/**
 * Shadow-Laeufe, die fertig sind und noch nicht mit dem tatsaechlich
 * veroeffentlichten Post abgeglichen wurden — erst, wenn ihr Abgleichfenster
 * (MATCH_WINDOW_MS = 24 h nach `asof`) geschlossen ist.
 * WARUM nicht frueher (Final-Review 2026-10-14 (R21), C1): der Betreiber
 * beginnt erst nach dem Kickoff, der Post traegt den Veroeffentlichungstag
 * 07:00 MEZ. Ein Abgleich kurz nach 'done' faende keinen Post und schriebe
 * reconciled_at mit attribution 'none' — endgueltig, denn kein Pfad holt
 * einen abgeglichenen Run nach. So rekonziliiert der Kickoff-Tick des
 * Folgetags den Vortag, bevor der neue Run vorankommt.
 */
export async function getRunsToReconcile(supabase: SupabaseAdmin, nowIso: string, limit = 1): Promise<RunRow[]> {
  const staleBefore = new Date(Date.parse(nowIso) - MATCH_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('curation_runs')
    .select('*')
    .eq('mode', 'shadow')
    .eq('status', 'done')
    .is('reconciled_at', null)
    .lte('asof', staleBefore)
    .order('asof', { ascending: true })
    .limit(limit)
  if (error) fail('curation_runs', error)
  return ((data ?? []) as Record<string, unknown>[]).map(parseRunRow)
}

/**
 * Markiert einen Run als abgeglichen: Treffer (oder null) plus Metriken,
 * Zeitstempel mitgesetzt. `metrics: null` heisst „Abgleich nach drei
 * Fehlversuchen aufgegeben" (Final-Review 2026-10-14 (R22)) — der Run faellt
 * damit aus getRunsToReconcile und aus aggregateRuns.
 */
export async function markReconciled(
  supabase: SupabaseAdmin,
  id: string,
  patch: { matched_post_id: string | null; matched_job_id: string | null; metrics: RunMetrics | null },
): Promise<void> {
  const { error } = await supabase
    .from('curation_runs')
    .update({ ...patch, reconciled_at: new Date().toISOString() })
    .eq('id', id)
  if (error) fail('curation_runs', error)
}

/**
 * Schreibt die Abgleich-Ergebnisse je Einheit zurueck: ein `update` je
 * Outcome statt eines Batch-Upserts, weil jede Zeile schon existiert (aus
 * insertUnits) und sich nur outcome/final_* aendert — ein Upsert ueber
 * unit_key haette keinen Primaerschluessel und legte bei einem abweichenden
 * Schluessel eine ZUSAETZLICHE Zeile an statt die bestehende zu
 * aktualisieren. Neu entstandene Einheiten (outcome='added', im
 * veroeffentlichten Post, aber nicht im Run) kommen per insert in Scheiben à
 * 200 hinzu wie in insertUnits.
 */
export async function updateUnitOutcomes(
  supabase: SupabaseAdmin,
  runId: string,
  outcomes: Array<Pick<UnitRow, 'unit_key' | 'outcome' | 'final_role' | 'final_rank' | 'matched_post_id' | 'matched_heading' | 'similarity'>>,
  added: UnitInsert[],
): Promise<void> {
  for (const { unit_key, ...patch } of outcomes) {
    const { error } = await supabase
      .from('curation_units')
      .update(patch)
      .eq('run_id', runId)
      .eq('unit_key', unit_key)
    if (error) fail('curation_units', error)
  }
  for (let i = 0; i < added.length; i += IN_CHUNK) {
    const batch = added.slice(i, i + IN_CHUNK).map((unit) => ({ ...unit, run_id: runId }))
    const { error } = await supabase.from('curation_units').insert(batch)
    if (error) fail('curation_units', error)
  }
}

/**
 * Summe `spend_usd` aller Shadow-Laeufe eines Tages — die Tageskappe
 * (`daily_budget_usd`). PostgREST kann `sum(...)` nicht selektieren (kein
 * SQL-Aggregat im select-String); die Spalte kommt Zeile fuer Zeile und wird
 * clientseitig summiert, dieselbe Number()-Konvertierung wie in parseRunRow
 * (numeric kommt als String).
 * `excludeRunId`: nur die FREMDEN Ausgaben — reserveBudget addiert den
 * eigenen Run selbst aus run.spend_usd, der in der DB schon den Stand vor
 * diesem Tick traegt und sonst doppelt zaehlte (Final-Review 2026-10-14 (R24)).
 */
export async function spentTodayUsd(supabase: SupabaseAdmin, day: string, excludeRunId?: string): Promise<number> {
  let query = supabase
    .from('curation_runs')
    .select('spend_usd')
    .eq('day', day)
    .eq('mode', 'shadow')
  if (excludeRunId) query = query.neq('id', excludeRunId)
  const { data, error } = await query
  if (error) fail('curation_runs', error)
  return ((data ?? []) as Array<{ spend_usd: unknown }>).reduce((sum, row) => sum + Number(row.spend_usd ?? 0), 0)
}

/**
 * Betreiber-Einstellungen, Defaults ueberschrieben durch settings.value
 * (Schluessel 'curation'). Ein Lesefehler ODER ein fehlender Schluessel
 * liefert reine Defaults statt zu werfen: die Zeile existiert laut Vertrag
 * ERST ab der Betreiber-Freigabe (Anhang A §1) — ein leerer Settings-Datensatz
 * ist vor der Freigabe der Normalfall, kein Fehlerzustand.
 */
export async function loadCurationSettings(supabase: SupabaseAdmin): Promise<CurationSettings> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'curation').maybeSingle()
  if (error || !data) return { ...DEFAULT_CURATION_SETTINGS }
  const value = (data as { value?: Partial<CurationSettings> }).value ?? {}
  return { ...DEFAULT_CURATION_SETTINGS, ...value }
}

/**
 * Der naechste Shadow-Kickoff: der `kickoffUtc`-Zeitpunkt UTC am Kalendertag
 * von `nowIso`, aber nur wenn er schon erreicht ist — der Cron soll nicht VOR
 * dem Kickoff einen Run mit `asof` in der Zukunft anlegen (ein solcher Run
 * saehe Items, die erst nach seinem eigenen Stichtag eintrafen). Ein
 * ungueltiges `kickoffUtc` (z. B. '4:25' ohne fuehrende Null) liefert null,
 * damit ein Tippfehler im Betreiber-Setting lautlos NICHTS anlegt, statt mit
 * falschem `asof` zu laufen.
 */
export function kickoffAsOf(nowIso: string, kickoffUtc: string): string | null {
  const match = KICKOFF_RE.exec(kickoffUtc)
  if (!match) return null
  const [, hour, minute] = match
  const asof = `${nowIso.slice(0, 10)}T${hour}:${minute}:00.000Z`
  return Date.parse(nowIso) >= Date.parse(asof) ? asof : null
}

/**
 * Wandelt eine rohe curation_runs-Zeile in RunRow. WARUM Number(): PostgREST
 * liefert numeric-Spalten (budget_usd, spend_usd) als Strings — ohne die
 * Konvertierung rechnete z. B. spentTodayUsd mit Strings weiter
 * ('4.0000' + '0.0000' statt 4). `log`/`degraded` bekommen einen leeren
 * Array-Fallback fuer den Fall eines NULL-Wertes (Spalten-Default ist
 * `'[]'::jsonb`, sollte also nicht vorkommen, aber eine fehlende Zeile darf
 * hier nicht mit einem Crash enden).
 */
export function parseRunRow(raw: Record<string, unknown>): RunRow {
  return {
    ...(raw as unknown as RunRow),
    budget_usd: Number(raw.budget_usd ?? 0),
    spend_usd: Number(raw.spend_usd ?? 0),
    log: (raw.log as RunLogEntry[] | undefined) ?? [],
    degraded: (raw.degraded as RunRow['degraded'] | undefined) ?? [],
  }
}
