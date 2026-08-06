/**
 * Nachverlinkung übersetzter Artikel — die Entsprechung zu
 * backfillGlossaryLinks (lib/glossary/backfill.ts) für `content_translations`.
 *
 * BEFUND, der das nötig macht (2026-08-06, an Prod gemessen): von 743
 * Übersetzungszeilen (en/cs/nds/fr) trägt KEINE eine glossaryLink-Mark, während
 * die deutschen Artikel durchgehend verlinkt sind. Das ist kein Fehler in der
 * Übersetzungspipeline, sondern eine Reihenfolge:
 * `reinjectGlossaryMarksForTranslation` nimmt die Slugs aus dem QUELLTEXT, und
 * jede bisherige Übersetzung lief, bevor ihr deutscher Artikel verlinkt war —
 * die älteren vor dem großen relink-Lauf am 05.08., die neueren für Artikel,
 * deren Begriffe noch nicht freigegeben waren. Zum Übersetzungszeitpunkt gab es
 * schlicht nichts zu injizieren, und nachgeholt wird es nie: `backfillGlossaryLinks`
 * fasst ausschließlich `generated_posts` an.
 *
 * Folge ohne diesen Lauf: alle nicht-deutschen Leser sehen keine Lexikon-Links,
 * bei einem Feature, das auf SEO/GEO zielt.
 *
 * Keine eigene Mark-Schreib-Logik: die Injektion läuft über
 * `reinjectGlossaryMarksForTranslation`, dieselbe Funktion, die die
 * Übersetzungs-Queue nach jeder Übersetzung aufruft.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { reinjectGlossaryMarksForTranslation } from '@/lib/glossary/translate'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import { safeParseJSON } from '@/lib/utils/safe-json'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'
import type { LanguageCode } from '@/lib/types'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Zeilen je Batch. Kleiner als POSTS_PER_BACKFILL (25), weil hier pro Zeile
 * ZWEI Dokumente im Speicher liegen (Übersetzung + Quelltext) und der Quelltext
 * bei vier Sprachen je Artikel mehrfach gebraucht wird.
 */
export const TRANSLATIONS_PER_BATCH = 20

export interface TranslationBackfillResult {
  /** IDs der Übersetzungszeilen, die neu verlinkt und geschrieben wurden. */
  linked: string[]
  /** Zeilen ohne Änderung (Quelltext ohne Marks, oder Ergebnis identisch). */
  unchanged: number
  /** Letzte verarbeitete Zeilen-ID, oder null wenn der Bestand durch ist. */
  cursor: string | null
  /** Noch offene Zeilen NACH diesem Batch. */
  remaining: number
}

interface TranslationRow {
  id: string
  generated_post_id: string
  language_code: string
  content: unknown
}

/** Ein Dokument aus einer Spalte, die mal Text und mal jsonb liefert. */
function asDoc(value: unknown): unknown {
  return typeof value === 'string' ? safeParseJSON(value) : value
}

/**
 * Verarbeitet einen Batch Übersetzungen ab `cursor` (aufsteigend nach `id`).
 *
 * `id` als Cursor statt eines Zeitstempels: `translated_at` kann null sein, und
 * ein Lauf, der eine Zeile schreibt, würde bei `updated_at` seinen eigenen
 * Fortschritt vor sich herschieben.
 */
export async function relinkTranslationsBatch(
  supabase: AdminClient,
  cursor: string | null,
  limit: number = TRANSLATIONS_PER_BATCH,
): Promise<TranslationBackfillResult> {
  let query = supabase
    .from('content_translations')
    .select('id, generated_post_id, language_code, content')
    .order('id', { ascending: true })
    .limit(limit)
  if (cursor) query = query.gt('id', cursor)

  const { data, error } = await query
  if (error) throw new Error(`Übersetzungen nicht ladbar: ${error.message}`)

  const rows = (data ?? []) as TranslationRow[]
  if (rows.length === 0) return { linked: [], unchanged: 0, cursor: null, remaining: 0 }

  // Quelltexte in EINEM Zug laden: bei vier Sprachen teilen sich bis zu vier
  // Zeilen denselben Artikel, einzeln geladen wäre es viermal derselbe Body.
  //
  // `filter(Boolean)` ist nicht kosmetisch: `content_translations` enthält auch
  // Übersetzungen von static_page und ui, und die haben `generated_post_id`
  // NULL (in Prod 12 von 743 Zeilen). Ein null in der `.in()`-Liste
  // serialisiert PostgREST als Literal "null" — die Abfrage stirbt dann mit
  // `invalid input syntax for type uuid: "null"` und reißt den ganzen Tick mit,
  // obwohl diese Zeilen bloß übersprungen werden sollen (sie haben keinen
  // Quelltext, also nichts zu injizieren). Prod-Befund 2026-08-06, nach 59
  // erfolgreich verlinkten Zeilen.
  const postIds = [...new Set(rows.map((r) => r.generated_post_id).filter(Boolean))]
  const { data: postRows, error: postError } = postIds.length > 0
    ? await supabase.from('generated_posts').select('id, content').in('id', postIds)
    : { data: [], error: null }
  if (postError) throw new Error(`Quellartikel nicht ladbar: ${postError.message}`)
  const sourceById = new Map(
    ((postRows ?? []) as Array<{ id: string; content: unknown }>).map((p) => [p.id, asDoc(p.content)]),
  )

  // Begriffs- und Reservierungsliste je Sprache genau einmal — beide sind
  // während des Laufs konstant.
  const preloadedByLang = new Map<string, { terms: GlossaryMatcherTerm[]; reserved: string[] }>()
  let reservedCache: string[] | null = null

  const linked: string[] = []
  let unchanged = 0
  let lastCursor: string | null = null

  for (const row of rows) {
    lastCursor = row.id
    const source = sourceById.get(row.generated_post_id)
    if (source === undefined) { unchanged++; continue }

    let preloaded = preloadedByLang.get(row.language_code)
    if (!preloaded) {
      const terms = await getMatcherTerms(row.language_code)
      if (terms === null) {
        // Transienter Ladefehler — wie in reinjectGlossaryMarksForTranslation
        // ein Wurf, nicht ein stilles Abhaken: sonst liefe der Cursor durch den
        // ganzen Bestand und hakte jede Zeile als "nichts zu tun" ab.
        throw new Error(`Begriffsliste (${row.language_code}) nicht ladbar — Lauf abgebrochen`)
      }
      if (reservedCache === null) reservedCache = buildReservedNames(await getChartProductNames())
      preloaded = { terms, reserved: reservedCache }
      preloadedByLang.set(row.language_code, preloaded)
    }

    const before = asDoc(row.content)
    const injected = await reinjectGlossaryMarksForTranslation(
      source, before, row.language_code as LanguageCode, preloaded,
    )
    if (JSON.stringify(injected) === JSON.stringify(before)) { unchanged++; continue }

    // content ist jsonb — das Objekt direkt schreiben. Ein JSON.stringify (wie
    // bei generated_posts, wo content eine text-Spalte ist) legte einen String
    // in die jsonb-Spalte: gültiges JSON, aber der Renderer bekäme einen String
    // statt eines Dokuments.
    const { error: upError } = await supabase
      .from('content_translations')
      .update({ content: injected })
      .eq('id', row.id)
    if (upError) {
      console.error(`[GlossaryTranslationBackfill] ${row.id} nicht speicherbar:`, upError.message)
      unchanged++
      continue
    }
    linked.push(row.id)
  }

  const { count } = await supabase
    .from('content_translations')
    .select('id', { count: 'exact', head: true })
    .gt('id', lastCursor ?? '')

  return { linked, unchanged, cursor: lastCursor, remaining: count ?? 0 }
}
