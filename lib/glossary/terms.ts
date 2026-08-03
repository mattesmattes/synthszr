import { createAdminClient } from '@/lib/supabase/admin'
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

export async function getMatcherTerms(lang: string): Promise<GlossaryMatcherTerm[]> {
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
    return base.map(({ id: _id, ...t }) => t)
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
