import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  readCrawlState,
  extractCandidates,
  generateCandidates,
  resetCrawlState,
  setCandidateExcluded,
  generateMissingIllustrations,
  relinkNextBatch,
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

  // Wie viele veröffentlichte Begriffe haben kein Bild? Ohne diese Zahl war im
  // Panel nicht erkennbar, dass ein Klick nur einen Teil erledigt — die Bilder
  // entstehen alphabetisch, ein Begriff weiter hinten blieb scheinbar grundlos leer.
  const { count: missingImages } = await supabase
    .from('glossary_terms')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('illustration_url', null)

  // ALLE offenen Kandidaten, in genau der Reihenfolge, in der
  // generateCandidates sie abarbeitet — damit die Anzeige nicht lügt.
  //
  // Bewusst ohne Obergrenze: der Operator soll jeden Begriff abwählen können,
  // und was er nicht sieht, kann er nicht abwählen. Eine Kappung machte die
  // Auswahl für den Rest unmöglich (bei 187 Kandidaten waren 121 unsichtbar).
  // Die Namen sind wenige Kilobyte, das trägt die Antwort problemlos.
  const excluded = new Set(state.excluded)
  const top = Object.entries(state.candidates)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, mentions]) => ({ name, mentions, selected: !excluded.has(name) }))

  return NextResponse.json({
    postsProcessed: state.postsProcessed,
    postsTotal: totalPosts ?? 0,
    candidateCount: Object.keys(state.candidates).length,
    // Nur die ausgewählten werden erzeugt — die Zahl, die der Operator braucht.
    selectedCount: Object.keys(state.candidates).filter((n) => !excluded.has(n)).length,
    generatedCount: state.generated.length,
    missingImages: missingImages ?? 0,
    updatedAt: state.updatedAt,
    topCandidates: top,
    postsPerExtraction: POSTS_PER_EXTRACTION,
    termsPerGeneration: TERMS_PER_GENERATION,
  })
}

const ACTIONS = ['extract', 'generate', 'reset', 'toggle', 'images', 'relink'] as const
type Action = (typeof ACTIONS)[number]

/**
 * POST ?action=extract   → nächste 10 Artikel lesen, Kandidaten sammeln
 * POST ?action=generate  → die häufigsten Kandidaten erzeugen und veröffentlichen
 * POST ?action=reset     → Cursor und Kandidatenliste leeren (keine Begriffe löschen)
 * POST ?action=toggle    → { name, selected } einen Kandidaten ab-/zuwählen
 * POST ?action=images    → Illustrationen für Begriffe ohne Bild nachziehen
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
    if (action === 'toggle') {
      const body = await request.json().catch(() => ({})) as { name?: string; selected?: boolean }
      if (!body.name) return NextResponse.json({ error: 'name fehlt' }, { status: 400 })
      const result = await setCandidateExcluded(supabase, body.name, body.selected === false)
      return NextResponse.json({ ok: true, excludedCount: result.excluded.length })
    }

    if (action === 'images') {
      // Läuft absichtlich hier und nicht als Skript: die Modellkonfiguration
      // zeigt auf openai/gpt-image-2, und lokal ist OPENAI_API_KEY nur der
      // redigierte Platzhalter aus `vercel env pull`. In dieser Umgebung ist er echt.
      const result = await generateMissingIllustrations(supabase)
      return NextResponse.json(result)
    }

    if (action === 'relink') {
      // Orchestrierung (Begriffe laden, reservierte Namen, Cursor) steckt jetzt
      // in relinkNextBatch — dieselbe Funktion, die der Cron aufruft.
      // `from` ist die UNTERE Grenze: "verlinke Artikel AB diesem Tag". Auf
      // 00:00 gesetzt, damit der Tag selbst vollstaendig dabei ist. Default im
      // Panel ist heute — dann laufen nur die heutigen Artikel, nicht alle 219.
      const from = request.nextUrl.searchParams.get('from')
      const since = from ? `${from}T00:00:00.000Z` : null
      try {
        const result = await relinkNextBatch(supabase, { since })
        return NextResponse.json(result)
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Nachverlinkung fehlgeschlagen' },
          { status: 503 },
        )
      }
    }

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

    // ?limit=1 fuer den Dauerlauf im Browser. Grund ist maxDuration=300: drei
    // Begriffe brauchen 135-270s plus Uebersetzung und Produktzuordnung, einer
    // mit Nachforderung nach Regel 4 reisst das Limit. Der Request stirbt dann
    // als 504 ohne JSON — fuer den Aufrufer ununterscheidbar von einem stillen
    // Abbruch. Einzeln bleibt jeder Aufruf bei 45-90s.
    const rawLimit = Number(request.nextUrl.searchParams.get('limit'))
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, TERMS_PER_GENERATION)
      : undefined
    const result = await generateCandidates(supabase, limit)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Crawl fehlgeschlagen' },
      { status: 500 },
    )
  }
}
