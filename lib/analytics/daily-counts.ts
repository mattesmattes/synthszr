import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>
type Query = { gte: Function; lt: Function; eq: Function; match: Function; not: Function; order: Function; range: Function }

const BERLIN_TZ = 'Europe/Berlin'
const PAGE = 1000

/** „YYYY-MM-DD" in Berliner Zeit — die Tagesgrenze, in der der Betreiber denkt. */
function berlinDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN_TZ }).format(new Date(iso))
}

export interface DailyCountSpec {
  table: string
  dateColumn: string
  /** ISO-Zeitpunkt, inklusive. */
  from: string
  /** ISO-Zeitpunkt, exklusive. */
  to?: string
  /** Gleichheitsfilter, z. B. { event_type: 'page_view' }. */
  eq?: Record<string, string>
  /** Regex-Filter (PostgREST `match`), z. B. { path: '/rankings(/|$)' }. */
  match?: Record<string, string>
  /** Negierte LIKE-Filter, z. B. { path: '/admin/*' }. */
  notLike?: Record<string, string>
}

/**
 * Zaehlungen je Tag — serverseitig aggregiert, mit Rueckfallebene.
 *
 * WARUM: Die Statistik-Seite holte fuer die 3-Monats-Ansicht ~100.000 Rohzeilen
 * (~15 MB, ~100 sequenzielle Requests) und zaehlte sie in JavaScript, um daraus
 * 90 Balken zu machen (Befund 2026-08-23, die Seite hing). Mit `count()` und
 * Gruppierung nach Tag liefert dieselbe Auskunft ~90 Zeilen.
 *
 * WEG: eine Datenbankfunktion (RPC, s. docs/sql/2026-08-23-analytics-daily-counts.sql).
 * Supabase verbietet Aggregate in PostgREST-Abfragen (PGRST123), und der
 * Schalter dafuer ist im Dashboard nicht mehr erreichbar — INNERHALB einer
 * Funktion greift das Verbot nicht.
 *
 * WARUM TROTZDEM EIN FALLBACK: Solange die Funktion nicht eingespielt ist, muss
 * der alte Weg greifen — sonst waere die Seite zwischen Deploy und SQL-Lauf
 * nicht langsam, sondern tot. Der Fallback laedt bewusst NUR die Datumsspalte;
 * das ist schon deutlich schmaler als die bisherigen drei Spalten.
 *
 * Immer nach TAGEN gruppiert, nie nach Woche oder Monat: Groebere Raster baut
 * der Aufrufer aus den Tageswerten zusammen. Das spart eine `date_trunc`-
 * Konstruktion, die PostgREST ohnehin nicht ausdruecken kann.
 */
export async function fetchDailyCounts(
  supabase: AdminClient,
  spec: DailyCountSpec,
): Promise<Map<string, number>> {
  const applyFilters = (q: Query): Query => {
    let out = q
    out = out.gte(spec.dateColumn, spec.from) as Query
    if (spec.to) out = out.lt(spec.dateColumn, spec.to) as Query
    for (const [col, val] of Object.entries(spec.eq ?? {})) out = out.eq(col, val) as Query
    for (const [col, val] of Object.entries(spec.match ?? {})) out = out.match?.(col, val) ?? out
    for (const [col, val] of Object.entries(spec.notLike ?? {})) out = out.not(col, 'like', val) as Query
    return out
  }

  // 1) Der schnelle Weg: die Datenbank zaehlen lassen.
  const rpc = spec.table === 'podcast_plays'
    ? { name: 'podcast_plays_daily_counts', args: { p_from: spec.from, p_to: spec.to ?? null } }
    : {
        name: 'analytics_daily_counts',
        args: {
          p_from: spec.from,
          p_to: spec.to ?? null,
          p_event_type: spec.eq?.event_type ?? null,
          p_path_match: spec.match?.path ?? null,
          p_exclude_admin: Boolean(spec.notLike?.path),
        },
      }
  try {
    const { data, error } = await (supabase as unknown as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
    }).rpc(rpc.name, rpc.args)
    if (!error && Array.isArray(data)) {
      const map = new Map<string, number>()
      for (const row of data as Array<{ bucket: string; n: number }>) {
        if (row?.bucket) map.set(String(row.bucket).slice(0, 10), Number(row.n) || 0)
      }
      return map
    }
    // PGRST202 = Funktion nicht gefunden: noch nicht eingespielt, kein Grund zur Sorge.
    if (error && error.code !== 'PGRST202') {
      console.error(`[DailyCounts] ${rpc.name} fehlgeschlagen (${error.code}): ${error.message}`)
    }
  } catch {
    /* faellt unten auf den alten Weg zurueck */
  }

  // 2) Rueckfallebene: Rohzeilen, aber nur die Datumsspalte.
  const map = new Map<string, number>()
  for (let offset = 0; ; offset += PAGE) {
    const q = supabase.from(spec.table).select(spec.dateColumn) as unknown as Query
    const { data, error } = await (applyFilters(q).range(offset, offset + PAGE - 1) as unknown as Promise<{
      data: Array<Record<string, string>> | null; error: unknown
    }>)
    if (error) { console.error(`[DailyCounts] ${spec.table}: Rueckfallebene fehlgeschlagen`); break }
    const rows = data ?? []
    for (const row of rows) {
      const raw = row[spec.dateColumn]
      if (!raw) continue
      const day = berlinDay(raw)
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    if (rows.length < PAGE) break
  }
  return map
}
