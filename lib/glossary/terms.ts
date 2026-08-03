import { createAdminClient } from '@/lib/supabase/admin'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

/** Spaltenliste für Listen-Queries. Ohne body/embedding — wide JSONB-Selects
 *  in Listen-Queries waren die Ursache des 109-GB-Egress-Overage. `id` wird
 *  intern für die Übersetzungs-Zuordnung gebraucht und vor der Rückgabe
 *  wieder verworfen. */
const LIST_COLUMNS = 'id, slug, canonical_name, summary'

export async function getPublishedTermList(
  lang: string,
): Promise<Array<{ slug: string; canonicalName: string; summary: string }>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_terms')
    .select(LIST_COLUMNS)
    .eq('status', 'published')
    .order('canonical_name')
  if (error) {
    console.error('[Glossary] getPublishedTermList:', error.message)
    return []
  }
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    summary: r.summary as string,
  }))
  const translated = lang === 'de' ? rows : await applyTranslations(rows, lang)
  return translated.map(({ id: _id, ...rest }) => rest)
}

/**
 * Rückgabe `null` NUR, wenn die Übersetzungsabfrage selbst fehlschlägt
 * (`trError` unten) — zu unterscheiden von einem legitimen "für dieses
 * Sprachenpaar existiert (noch) keine Übersetzungszeile", das PRO BEGRIFF
 * silently auf den deutschen Namen zurückfällt (unten, `t9n?.canonical_name
 * ?? t.canonicalName`) und genau das gewünschte, alltägliche Verhalten ist.
 *
 * Review-Fund Important 1 (Fix-Runde 1, Task 16): vor dieser Änderung gab
 * ein fehlgeschlagenes Laden der Übersetzungen bytegleich dieselbe deutsche
 * Fallback-Liste zurück wie der Normalfall "noch keine Übersetzung
 * vorhanden" — für den Aufrufer nicht unterscheidbar. Für
 * reinjectGlossaryMarksForTranslation (translate.ts) bedeutete das: ein
 * transienter DB-Fehler und "dieser Begriff ist einfach noch nicht ins
 * Englische übersetzt" sahen identisch aus, und beide degradierten
 * unbemerkt zu null gesetzten Marks im übersetzten Artikel. `null` macht den
 * Fehlerfall am Ursprung sichtbar, statt ihn wie ein Ergebnis
 * zurückzugeben — Aufrufer, denen der Unterschied egal ist (detail.ts,
 * confirm.ts), degradieren mit `?? []` genauso wie zuvor.
 */
export async function getMatcherTerms(lang: string): Promise<GlossaryMatcherTerm[] | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, aliases')
    .eq('status', 'published')
  if (error) {
    console.error('[Glossary] getMatcherTerms:', error.message)
    return []
  }
  const base = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
  }))
  if (lang === 'de') return base.map(({ id: _id, ...t }) => t)
  if (base.length === 0) return []

  // Für die Verlinkung im übersetzten Artikel zählen die Namen der Zielsprache.
  // Wie bei applyTranslations: term_ids statt nur language filtern, sonst nutzt
  // der Filter den PK (term_id, language) nicht und scannt alle Sprachen.
  const { data: tr, error: trError } = await supabase
    .from('glossary_term_translations')
    .select('term_id, canonical_name, aliases')
    .in('term_id', base.map((t) => t.id))
    .eq('language', lang)
  if (trError) {
    console.error('[Glossary] getMatcherTerms translations:', trError.message)
    return null
  }
  const byId = new Map((tr ?? []).map((t) => [t.term_id as string, t]))
  return base.map((t) => {
    const t9n = byId.get(t.id)
    return {
      slug: t.slug,
      canonicalName: (t9n?.canonical_name as string) ?? t.canonicalName,
      aliases: ((t9n?.aliases ?? t.aliases) ?? []) as string[],
    }
  })
}

/** Chart-Produktnamen für die Kollisions-Reservierung bei der Mark-Injektion
 *  (Task 11) — Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff.
 *  Nur `canonical_name`, keine weiteren Spalten (Egress). Paginiert wie in
 *  lib/rankings/categorize.ts: PostgREST kappt sonst still bei 1000 Zeilen. */
export async function getChartProductNames(): Promise<string[]> {
  const supabase = createAdminClient()
  const names: string[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('canonical_name')
      .eq('visibility_status', 'visible')
      .range(off, off + 999)
    if (error) {
      console.error('[Glossary] getChartProductNames:', error.message)
      break
    }
    if (!data?.length) break
    names.push(...data.map((r) => r.canonical_name as string))
    if (data.length < 1000) break
  }
  return names
}

/** Baut die reservierte Namensliste für die Glossar-Mark-Injektion
 *  (Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff) — gemeinsam
 *  genutzt von applyGlossaryConfirmation (lib/glossary/confirm.ts, Task 11)
 *  und reinjectGlossaryMarksForTranslation (lib/glossary/translate.ts,
 *  Task 16). Vorher an beiden Stellen bytegleich dupliziert (Review-Fund
 *  Important 2, Fix-Runde 1): eine Policy-Regel, die in zwei Kopien
 *  auseinanderlaufen kann, ohne dass es auffällt — der deutsche Artikel
 *  würde dann einen Begriff verlinken, den der übersetzte auslässt, oder
 *  umgekehrt, ohne Fehler und ohne Log.
 *
 *  Pur (keine eigene DB-Anfrage): `chartProductNames` kommt vom Aufrufer,
 *  der es meist ohnehin parallel zu getMatcherTerms per Promise.all lädt —
 *  eine eigene getChartProductNames()-Anfrage hier würde diesen Call
 *  verdoppeln. */
export function buildReservedNames(chartProductNames: string[]): string[] {
  return [
    ...Object.keys(KNOWN_COMPANIES),
    ...Object.keys(KNOWN_PREMARKET_COMPANIES),
    ...chartProductNames,
  ]
}

interface TranslatableRow {
  id: string
  slug: string
  canonicalName: string
  summary: string
}

/**
 * Überschreibt Name und Summary mit der Übersetzung, wo eine existiert.
 * Fehlt sie, bleibt die deutsche Fassung stehen — besser als eine Lücke.
 *
 * Die `term_id`s werden bewusst mitgegeben statt nur auf `language` zu
 * filtern: der Primary Key ist `(term_id, language)`, ein language-only-Filter
 * nutzt dessen Präfix nicht und läuft als Seq-Scan über alle Sprachen. Mit den
 * IDs greift der PK, und es werden nur die tatsächlich benötigten Zeilen
 * übertragen — in diesem Projekt hat genau dieser Reflex 109 GB Egress
 * gekostet.
 */
async function applyTranslations<T extends TranslatableRow>(
  rows: T[],
  lang: string,
): Promise<T[]> {
  if (rows.length === 0) return rows
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_term_translations')
    .select('term_id, canonical_name, summary')
    .in('term_id', rows.map((r) => r.id))
    .eq('language', lang)
  if (error) {
    // Fehlende Übersetzungen sind kein Grund, die Seite leer zu rendern.
    console.error('[Glossary] applyTranslations:', error.message)
    return rows
  }
  const byId = new Map(
    (data ?? []).map((t) => [
      t.term_id as string,
      { canonicalName: t.canonical_name as string | null, summary: t.summary as string | null },
    ]),
  )
  return rows.map((r) => {
    const t9n = byId.get(r.id)
    if (!t9n) return r
    return {
      ...r,
      canonicalName: t9n.canonicalName ?? r.canonicalName,
      summary: t9n.summary ?? r.summary,
    }
  })
}
