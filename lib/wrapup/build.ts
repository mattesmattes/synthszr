/**
 * Den Wochenrückblick bauen — EINE Funktion für beide Auslöser.
 *
 * Bis 2026-08-14 lag die gesamte Logik in der Admin-Route und war damit nur per
 * Knopfdruck erreichbar: Die Route verlangt eine Browser-Session, ein
 * Cron-Aufruf lief in 401. Der Sonntags-Cron ruft jetzt dieselbe Funktion —
 * bewusst nicht eine zweite Fassung, die mit der Zeit auseinanderliefe.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { lastCompleteWeek, dateRangeWindow } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { WRAPUP_SLUG_PREFIX } from '@/lib/wrapup/slug'
import { generateWrapupParts } from '@/lib/wrapup/generate'
import { researchWeekUpdates, type TopicUpdate, type UpdateLevel } from '@/lib/wrapup/research'
import { assembleWrapupDoc, formatExcerpt } from '@/lib/wrapup/assemble'
import { buildUniqueSlug } from '@/lib/article-jobs/unique-slug'

type AdminClient = ReturnType<typeof createAdminClient>

/** Slug-Stamm eines Wochenrückblicks — auch die Duplikatsprüfung hängt daran. */
export function wrapupSlugBase(mondayDate: string): string {
  return `${WRAPUP_SLUG_PREFIX}${mondayDate}`
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface WrapupResult {
  status: 'created' | 'exists' | 'no_topics'
  postId?: string
  slug?: string
  title?: string
  topicCount?: number
  weekLabel: string
  weekdays?: string[]
  /** Themen mit Synthszr Update (Stufe minor/major) — leer, wenn die Recherche
   *  nichts fand oder ausfiel. */
  updates?: Array<{ weekday: string; updateLevel: UpdateLevel; searches: number }>
}

/**
 * @param skipIfExists  Für den Cron: Gibt es den Rückblick dieser Woche schon,
 *   passiert nichts. Ohne diese Prüfung legte ein zweiter Sonntagslauf — oder
 *   ein Neustart nach Zeitüberschreitung — einen zweiten Entwurf an, weil
 *   buildUniqueSlug bei Kollision eine Zahl anhängt statt abzubrechen.
 * @param research  `false` überspringt die Update-Recherche (Trockenlauf,
 *   Rückfall ohne Web-Suche). Default `true`.
 * @param range  Vom Admin gewählter Zeitraum (beide Tage inklusiv, Berliner
 *   Datum, von der Route geprüft). Ohne Angabe: die letzte abgeschlossene Woche.
 */
export async function buildWeekWrapup(
  supabase: AdminClient,
  opts: { model?: string; skipIfExists?: boolean; research?: boolean; range?: { from: string; to: string } } = {},
): Promise<WrapupResult> {
  const week = opts.range ? dateRangeWindow(opts.range.from, opts.range.to) : lastCompleteWeek(new Date())
  const slugBase = wrapupSlugBase(week.mondayDate)

  if (opts.skipIfExists) {
    // Auf dem STAMM vergleichen, nicht auf Gleichheit: Ein früherer Lauf kann
    // "…-2" angelegt haben, und auch das ist ein vorhandener Rückblick.
    const { data } = await supabase
      .from('generated_posts')
      .select('id, slug')
      .like('slug', `${slugBase}%`)
      .limit(1)
    const vorhanden = (data ?? []) as Array<{ id: string; slug: string }>
    if (vorhanden.length > 0) {
      return { status: 'exists', postId: vorhanden[0].id, slug: vorhanden[0].slug, weekLabel: week.label }
    }
  }

  const topics = await collectWeekTopics(supabase, week.mondayIso, week.saturdayEndIso)
  if (topics.length === 0) return { status: 'no_topics', weekLabel: week.label, topicCount: 0 }

  // Recherche VOR dem Compose-Aufruf, parallel je Thema (research.ts). Ein
  // Totalausfall darf den Rückblick nicht verhindern — dann gibt es keine
  // Updates, aber den Entwurf (Spec: Grenzen).
  const updates: TopicUpdate[] = opts.research === false
    ? []
    : await researchWeekUpdates(topics).catch((err) => {
      console.error('[WeekWrapup] Recherche fehlgeschlagen:', err instanceof Error ? err.message : err)
      return []
    })

  const model = opts.model || (await getModelForUseCase('wrapup'))
  const { title, parts } = await generateWrapupParts(topics, week.label, model, updates)
  let tiptap = assembleWrapupDoc(topics, parts, updates) as Record<string, unknown>

  // Lexikon-Links über das FERTIGE Dokument ziehen: die übernommenen Absätze
  // tragen ihre Marks schon, die neu geschriebenen (Vorlauf, Bezug, Take) noch
  // nicht. Fehlschlag ist unkritisch — dann fehlen Lexikon-Links, der Text steht.
  try {
    const { getMatcherTerms, buildReservedNames, getChartProductNames } = await import('@/lib/glossary/terms')
    const { injectGlossaryMarks } = await import('@/lib/glossary/inject-marks')
    const [terms, chartNames] = await Promise.all([getMatcherTerms('de'), getChartProductNames()])
    if (terms && terms.length > 0) {
      tiptap = await injectGlossaryMarks(
        tiptap, terms.map((t) => t.slug), terms,
        { reserved: buildReservedNames(chartNames), lang: 'de' },
      ) as Record<string, unknown>
    }
  } catch (err) {
    console.error('[WeekWrapup] Lexikon-Verlinkung fehlgeschlagen:', err)
  }

  const slug = await buildUniqueSlug(slugify(slugBase), async (s) => {
    const { data } = await supabase.from('generated_posts').select('id').eq('slug', s).maybeSingle()
    return !!data
  })

  const { data: post, error } = await supabase
    .from('generated_posts')
    .insert({
      title,
      slug,
      excerpt: formatExcerpt(parts.excerptBullets),
      category: 'AI & Tech',
      content: JSON.stringify(tiptap),
      word_count: JSON.stringify(tiptap).replace(/<[^>]*>/g, ' ').split(/\s+/).length,
      status: 'draft',
      ai_model: model,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Entwurf nicht speicherbar: ${error.message}`)

  return {
    status: 'created',
    postId: (post as { id: string }).id,
    slug, title,
    topicCount: topics.length,
    weekLabel: week.label,
    weekdays: topics.map((t) => t.weekday),
    updates: updates
      .filter((u) => u.updateLevel !== 'none')
      .map(({ weekday, updateLevel, searches }) => ({ weekday, updateLevel, searches })),
  }
}
