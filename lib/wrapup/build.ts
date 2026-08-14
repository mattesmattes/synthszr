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
import { lastCompleteWeek } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { generateWrapupParts } from '@/lib/wrapup/generate'
import { assembleWrapupDoc, formatExcerpt } from '@/lib/wrapup/assemble'
import { buildUniqueSlug } from '@/lib/article-jobs/unique-slug'

type AdminClient = ReturnType<typeof createAdminClient>

/** Slug-Stamm eines Wochenrückblicks — auch die Duplikatsprüfung hängt daran. */
export function wrapupSlugBase(mondayDate: string): string {
  return `ai-week-wrap-up-${mondayDate}`
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
}

/**
 * @param skipIfExists  Für den Cron: Gibt es den Rückblick dieser Woche schon,
 *   passiert nichts. Ohne diese Prüfung legte ein zweiter Sonntagslauf — oder
 *   ein Neustart nach Zeitüberschreitung — einen zweiten Entwurf an, weil
 *   buildUniqueSlug bei Kollision eine Zahl anhängt statt abzubrechen.
 */
export async function buildWeekWrapup(
  supabase: AdminClient,
  opts: { model?: string; skipIfExists?: boolean } = {},
): Promise<WrapupResult> {
  const week = lastCompleteWeek(new Date())
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

  const model = opts.model || (await getModelForUseCase('ghostwriter'))
  const { title, parts } = await generateWrapupParts(topics, week.label, model)
  let tiptap = assembleWrapupDoc(topics, parts) as Record<string, unknown>

  // Lexikon-Links über das FERTIGE Dokument ziehen: die übernommenen Absätze
  // tragen ihre Marks schon, die neu geschriebenen (Vorlauf, Bezug, Take) noch
  // nicht. Fehlschlag ist unkritisch — dann fehlen Lexikon-Links, der Text steht.
  try {
    const { getMatcherTerms, buildReservedNames, getChartProductNames } = await import('@/lib/glossary/terms')
    const { injectGlossaryMarks } = await import('@/lib/glossary/inject-marks')
    const [terms, chartNames] = await Promise.all([getMatcherTerms('de'), getChartProductNames()])
    if (terms && terms.length > 0) {
      tiptap = injectGlossaryMarks(
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
  }
}
