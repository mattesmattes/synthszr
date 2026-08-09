import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { lastCompleteWeek } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { generateWrapup } from '@/lib/wrapup/generate'
import { markdownToTiptapServer } from '@/lib/utils/markdown-to-tiptap-server'
import { buildUniqueSlug } from '@/lib/article-jobs/unique-slug'

/**
 * Erzeugt den Wochenrückblick der letzten abgeschlossenen Woche als Entwurf.
 *
 * KEIN article_jobs-Eintrag: der Job-Mechanismus existiert, weil 40 Sektionen à
 * 45-90s das 300s-Limit sprengen. Hier ist es EIN Aufruf über bis zu sechs
 * vorhandene Texte (~60-90s) — die Job-Infrastruktur wäre Aufwand ohne
 * Gegenwert. maxDuration deckt den Fall mit Reserve; sollte sich das in der
 * Praxis als knapp erweisen, ist der Umstieg auf einen Job ein kleiner Schritt.
 */
export const maxDuration = 300

/** Slug aus dem Titel. Eigene kleine Fassung statt eines Imports: die
 *  Wrapup-Slugs enthalten nur Ziffern, Bindestriche und ASCII-Buchstaben, und
 *  die Umlaut-Transliteration von lib/glossary/generate.ts hier zu importieren
 *  hieße, ein Glossar-Modul in den Artikelpfad zu ziehen. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const supabase = createAdminClient()
  const week = lastCompleteWeek(new Date())

  try {
    const topics = await collectWeekTopics(supabase, week.mondayIso, week.saturdayEndIso)
    if (topics.length === 0) {
      // Klare Meldung statt eines leeren Entwurfs: der wäre in der Artikelliste
      // nicht von einem misslungenen zu unterscheiden.
      return NextResponse.json(
        { error: `Keine veröffentlichten Artikel im Zeitraum ${week.label} gefunden.` },
        { status: 400 },
      )
    }

    const model = (body.model as string) || (await getModelForUseCase('ghostwriter'))
    const { title, markdown } = await generateWrapup(topics, week.label, model)

    // Server-Variante: markdownToTiptap ruft TipTaps generateJSON und braucht
    // ein DOM — in einer Route wirft das ("there is no window object").
    const tiptap = await markdownToTiptapServer(markdown)
    const slug = await buildUniqueSlug(
      slugify(`ai-week-wrap-up-${week.mondayDate}`),
      async (s) => {
        const { data } = await supabase
          .from('generated_posts').select('id').eq('slug', s).maybeSingle()
        return !!data
      },
    )

    const { data: post, error } = await supabase
      .from('generated_posts')
      .insert({
        title,
        slug,
        excerpt: `Der Rückblick auf die Woche vom ${week.label}.`,
        category: 'AI & Tech',
        content: JSON.stringify(tiptap),
        word_count: markdown.split(/\s+/).length,
        status: 'draft',
        ai_model: model,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Entwurf nicht speicherbar: ${error.message}`)

    return NextResponse.json({
      postId: (post as { id: string }).id,
      slug,
      title,
      topicCount: topics.length,
      weekLabel: week.label,
      // Für die Rückmeldung im Panel: welche Tage tatsächlich beitragen. Ein
      // fehlender Tag ist kein Fehler, soll aber sichtbar sein.
      weekdays: topics.map((t) => t.weekday),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[WeekWrapup]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
