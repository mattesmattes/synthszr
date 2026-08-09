import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { lastCompleteWeek } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { generateWrapupParts } from '@/lib/wrapup/generate'
import { assembleWrapupDoc, formatExcerpt } from '@/lib/wrapup/assemble'
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
    // Das Modell schreibt NUR Vorlauf, Takes und Bezüge — die Berichte kommen
    // als Original-Knoten aus den Tagesartikeln (s. collect.ts/assemble.ts).
    const { title, parts } = await generateWrapupParts(topics, week.label, model)
    let tiptap = assembleWrapupDoc(topics, parts) as Record<string, unknown>

    // Lexikon-Links über das FERTIGE Dokument ziehen: die übernommenen Absätze
    // tragen ihre Marks schon, die neu geschriebenen (Vorlauf, Bezug, Take)
    // noch nicht. injectGlossaryMarks strippt nur glossaryLink — die
    // Quellenlinks der Originaltexte bleiben unangetastet (s. stripMarks).
    // Fehlschlag ist unkritisch: dann fehlen Lexikon-Links, der Text steht.
    try {
      const { getMatcherTerms, buildReservedNames, getChartProductNames } =
        await import('@/lib/glossary/terms')
      const { injectGlossaryMarks } = await import('@/lib/glossary/inject-marks')
      const [terms, chartNames] = await Promise.all([
        getMatcherTerms('de'),
        getChartProductNames(),
      ])
      if (terms && terms.length > 0) {
        tiptap = injectGlossaryMarks(
          tiptap,
          terms.map((t) => t.slug),
          terms,
          { reserved: buildReservedNames(chartNames), lang: 'de' },
        ) as Record<string, unknown>
      }
    } catch (err) {
      console.error('[WeekWrapup] Lexikon-Verlinkung fehlgeschlagen:', err)
    }
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
        // SEO-Beschreibung vom Modell, im Format des Tagesartikels. Fällt sie
        // aus, bleibt die Spalte leer statt mit einem Platzhalter belegt — der
        // würde in den Suchergebnissen stehen.
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
