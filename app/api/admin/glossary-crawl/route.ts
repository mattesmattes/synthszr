import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  readCrawlState,
  extractCandidates,
  generateCandidates,
  resetCrawlState,
  POSTS_PER_EXTRACTION,
  TERMS_PER_GENERATION,
} from '@/lib/glossary/crawl'
import { getMatcherTerms } from '@/lib/glossary/terms'

// Beide Aktionen machen LLM-Calls: Extraktion 10 kurze, Generierung bis zu 3
// teure. Ohne Deklaration liefe die Route auf dem Plattform-Default — dieselbe
// Lücke, die der Task-18-Review für app/api/admin/glossary gemeldet hat.
export const maxDuration = 300

/** GET → Fortschritt und Top-Kandidaten für die Anzeige. */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const state = await readCrawlState(supabase)

  const { count: totalPosts } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')

  // Die häufigsten offenen Kandidaten — genau die Reihenfolge, in der
  // generateCandidates sie abarbeitet, damit die Anzeige nicht lügt.
  const top = Object.entries(state.candidates)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([name, mentions]) => ({ name, mentions }))

  return NextResponse.json({
    postsProcessed: state.postsProcessed,
    postsTotal: totalPosts ?? 0,
    candidateCount: Object.keys(state.candidates).length,
    generatedCount: state.generated.length,
    updatedAt: state.updatedAt,
    topCandidates: top,
    postsPerExtraction: POSTS_PER_EXTRACTION,
    termsPerGeneration: TERMS_PER_GENERATION,
  })
}

const ACTIONS = ['extract', 'generate', 'reset'] as const
type Action = (typeof ACTIONS)[number]

/**
 * POST ?action=extract   → nächste 10 Artikel lesen, Kandidaten sammeln
 * POST ?action=generate  → die häufigsten Kandidaten erzeugen und veröffentlichen
 * POST ?action=reset     → Cursor und Kandidatenliste leeren (keine Begriffe löschen)
 *
 * Getrennte Aktionen statt eines "Alles machen"-Knopfes: Extraktion ist billig
 * und schnell, Generierung teuer und langsam. Zusammengelegt würde ein Klick
 * unvorhersehbar lange laufen und das 300s-Limit reißen — genau der Defekt, den
 * die entkoppelte lexicon-Phase behoben hat.
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const action = request.nextUrl.searchParams.get('action') as Action | null
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action muss eine von ${ACTIONS.join(', ')} sein` },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  try {
    if (action === 'reset') {
      await resetCrawlState(supabase)
      return NextResponse.json({ ok: true })
    }

    if (action === 'extract') {
      // Bereits bekannte Begriffe ausschließen — identifyCandidates filtert sie
      // im Code, nicht per Prompt. getMatcherTerms liefert null bei einem
      // Lesefehler: dann abbrechen statt mit leerer Liste zu crawlen, sonst
      // schlägt jeder vorhandene Begriff erneut als "neu" an.
      const terms = await getMatcherTerms('de')
      if (terms === null) {
        return NextResponse.json(
          { error: 'Begriffsliste nicht ladbar — Crawl abgebrochen, damit keine Duplikate entstehen' },
          { status: 503 },
        )
      }
      const result = await extractCandidates(supabase, terms.map((t) => t.slug))
      return NextResponse.json(result)
    }

    const result = await generateCandidates(supabase)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Crawl fehlgeschlagen' },
      { status: 500 },
    )
  }
}
