/**
 * Rückwärts-Crawl über veröffentlichte Artikel: findet Fachbegriffe, die noch
 * kein Lexikoneintrag sind, und legt sie an.
 *
 * ZWEI GETRENNTE PHASEN — das ist der Kern und nicht Kosmetik:
 *
 *   extractCandidates()  liest 10 Artikel, ruft identifyCandidates (ein
 *                        LLM-Call je Artikel, wenige Sekunden) und merkt sich
 *                        die gefundenen NAMEN samt Fundstellenzahl.
 *   generateCandidates() erzeugt daraus tatsächliche Begriffe — pro Begriff zwei
 *                        Opus-Calls, ggf. Bildgenerierung, 45-90s.
 *
 * Beides in einem Durchlauf zu erledigen wäre exakt der Fehler, der die
 * lexicon-Job-Phase gesprengt hat (Befund B, 2026-08-04): 10 Artikel ergeben
 * leicht 20 neue Begriffe, das sind 20-30 Minuten Arbeit in einer Function mit
 * 300s-Limit. Vercel killt sie, und weil nichts persistiert war, begann jeder
 * Versuch von vorn. Deshalb: Extraktion ist billig und darf viele Artikel
 * abarbeiten, Generierung ist teuer und läuft strikt gedeckelt.
 *
 * KEIN eigenes Schema: Fortschritt und Kandidatenliste liegen als JSONB in
 * `settings` (key/value, existiert). Bei ein paar hundert Kandidaten sind das
 * wenige Kilobyte — eine eigene Tabelle wäre eine Migration für Daten, die
 * nach dem Crawl wieder verschwinden.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { identifyCandidates, slugify } from '@/lib/glossary/generate'
import { generateAndInsertDraft } from '@/lib/glossary/draft-writer'
import { assignProducts } from '@/lib/glossary/products'
import { extractVisibleText } from '@/lib/posts/product-mentions'
import { safeParseJSON } from '@/lib/utils/safe-json'

type AdminClient = ReturnType<typeof createAdminClient>

const STATE_KEY = 'glossary_crawl_state'

/** Artikel pro Extraktionslauf. 10 LLM-Calls à wenige Sekunden bleiben klar
 *  unter dem 300s-Limit, auch wenn einzelne Calls langsam sind. */
export const POSTS_PER_EXTRACTION = 10

/**
 * Begriffe pro Generierungslauf. Gemessen kostet ein Begriff 45-90s
 * (Content-Call, ggf. Nachforderung wegen Regel 4, Bildgenerierung,
 * Produkt-Zuordnung). Drei liegen mit ~270s im schlechten Fall noch unter dem
 * Limit; bei vier wäre der Lauf jenseits davon. Dieselbe Grenze und dieselbe
 * Begründung wie MAX_GENERATE_PER_SAVE in ensure-terms.ts.
 */
export const TERMS_PER_GENERATION = 3

export interface CrawlState {
  /** created_at des zuletzt verarbeiteten Artikels; Cursor für den nächsten Lauf. */
  cursor: string | null
  /** Wie viele Artikel insgesamt schon gelesen wurden. */
  postsProcessed: number
  /** Gefundene Begriffe: Name → Zahl der Artikel, in denen er vorkam. */
  candidates: Record<string, number>
  /** Bereits erzeugte Slugs — verhindert einen zweiten Versuch nach Fehlschlag. */
  generated: string[]
  /**
   * Abgewählte Kandidaten-Namen. Alle gefundenen Begriffe sind standardmäßig
   * AUSGEWÄHLT; hier stehen nur die, die der Operator ausdrücklich nicht will.
   *
   * Die Ausnahmen zu speichern statt der Auswahl ist wesentlich: die
   * Kandidatenliste wächst bei jeder Extraktion weiter, und ein neu gefundener
   * Begriff soll automatisch dabei sein. Würde man die Auswahl speichern, wäre
   * jeder neue Kandidat implizit abgewählt und müsste erst zugeschaltet werden.
   */
  excluded: string[]
  updatedAt: string | null
}

const EMPTY_STATE: CrawlState = {
  cursor: null, postsProcessed: 0, candidates: {}, generated: [], excluded: [], updatedAt: null,
}

export async function readCrawlState(supabase: AdminClient): Promise<CrawlState> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', STATE_KEY)
    .maybeSingle()
  if (error) {
    console.error('[GlossaryCrawl] State nicht ladbar:', error.message)
    return { ...EMPTY_STATE }
  }
  const raw = (data as { value?: unknown } | null)?.value
  // settings.value ist JSONB; je nach Schreibpfad kommt es als Objekt oder String.
  const parsed = typeof raw === 'string' ? safeParseJSON(raw) : raw
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STATE }
  const s = parsed as Partial<CrawlState>
  return {
    cursor: typeof s.cursor === 'string' ? s.cursor : null,
    postsProcessed: typeof s.postsProcessed === 'number' ? s.postsProcessed : 0,
    candidates: s.candidates && typeof s.candidates === 'object' ? s.candidates : {},
    generated: Array.isArray(s.generated) ? s.generated : [],
    excluded: Array.isArray(s.excluded) ? s.excluded : [],
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
  }
}

/**
 * Wählt einen Kandidaten ab oder wieder zu. Idempotent, damit ein doppelter
 * Klick (oder ein wiederholter Request) den Zustand nicht kippt.
 */
export async function setCandidateExcluded(
  supabase: AdminClient,
  name: string,
  excluded: boolean,
): Promise<{ excluded: string[] }> {
  const state = await readCrawlState(supabase)
  const set = new Set(state.excluded)
  if (excluded) set.add(name)
  else set.delete(name)
  const next = [...set]
  await writeCrawlState(supabase, { ...state, excluded: next })
  return { excluded: next }
}

async function writeCrawlState(supabase: AdminClient, state: CrawlState): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: STATE_KEY, value: { ...state, updatedAt: new Date().toISOString() } }, { onConflict: 'key' })
  if (error) throw new Error(`State nicht speicherbar: ${error.message}`)
}

/** Setzt den Crawl zurück (Cursor und Kandidaten), ohne Begriffe zu löschen. */
export async function resetCrawlState(supabase: AdminClient): Promise<void> {
  await writeCrawlState(supabase, { ...EMPTY_STATE })
}

export interface ExtractionResult {
  postsRead: number
  newCandidates: number
  totalCandidates: number
  postsProcessed: number
  postsRemaining: number
  done: boolean
}

/**
 * Liest die nächsten Artikel und sammelt Begriffs-Kandidaten. Erzeugt NICHTS.
 *
 * Reihenfolge: neueste Artikel zuerst (created_at desc). Aktuelle Themen sind
 * die, zu denen Leser heute einen Begriff suchen; ein Abbruch nach der Hälfte
 * hat damit die nützlichere Hälfte erledigt.
 */
export async function extractCandidates(
  supabase: AdminClient,
  knownSlugs: string[],
): Promise<ExtractionResult> {
  const state = await readCrawlState(supabase)

  let query = supabase
    .from('generated_posts')
    .select('id, title, content, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(POSTS_PER_EXTRACTION)
  // Cursor: strikt älter als der letzte verarbeitete Artikel.
  if (state.cursor) query = query.lt('created_at', state.cursor)

  const { data: posts, error } = await query
  if (error) throw new Error(`Artikel nicht ladbar: ${error.message}`)

  const { count: totalPosts } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')

  const rows = (posts ?? []) as Array<{ id: string; content: unknown; created_at: string }>
  if (rows.length === 0) {
    return {
      postsRead: 0,
      newCandidates: 0,
      totalCandidates: Object.keys(state.candidates).length,
      postsProcessed: state.postsProcessed,
      postsRemaining: 0,
      done: true,
    }
  }

  const candidates = { ...state.candidates }
  let newCandidates = 0
  for (const post of rows) {
    const content = typeof post.content === 'string' ? safeParseJSON(post.content) : post.content
    const text = content ? extractVisibleText(content as Record<string, unknown>) : ''
    if (!text) continue
    let found: string[] = []
    try {
      // knownSlugs filtert bereits im Code (nicht per Prompt), s. generate.ts.
      found = await identifyCandidates(text, knownSlugs)
    } catch (err) {
      // Ein einzelner Artikel darf den Lauf nicht kosten — der Cursor rückt
      // trotzdem vor, sonst bliebe der Crawl an diesem Artikel hängen.
      console.error('[GlossaryCrawl] identifyCandidates fehlgeschlagen für', post.id, err)
    }
    for (const name of found) {
      const key = name.trim()
      if (!key || !slugify(key)) continue
      if (!(key in candidates)) newCandidates++
      candidates[key] = (candidates[key] ?? 0) + 1
    }
  }

  const postsProcessed = state.postsProcessed + rows.length
  await writeCrawlState(supabase, {
    ...state,
    cursor: rows[rows.length - 1].created_at,
    postsProcessed,
    candidates,
  })

  const remaining = Math.max(0, (totalPosts ?? 0) - postsProcessed)
  return {
    postsRead: rows.length,
    newCandidates,
    totalCandidates: Object.keys(candidates).length,
    postsProcessed,
    postsRemaining: remaining,
    done: remaining === 0,
  }
}

/**
 * Illustrationen pro Lauf. gpt-image-2 braucht pro Bild 10-25s (plus Dithering
 * und Upload); fünf liegen mit Reserve unter dem 300s-Limit der Route.
 */
export const IMAGES_PER_RUN = 5

export interface IllustrationResult {
  done: string[]
  failed: string[]
  remaining: number
}

/**
 * Erzeugt Illustrationen für veröffentlichte Begriffe, die noch keine haben.
 *
 * MUSS IN PROD LAUFEN: die Modellkonfiguration für image_generation zeigt auf
 * openai/gpt-image-2, und `vercel env pull` liefert OPENAI_API_KEY nur als
 * redigiertes "[SENSITIVE]" — lokal gibt es dort einen 401. Deshalb als
 * Admin-Aktion und nicht als Skript: in der Serverless-Umgebung ist der Key echt.
 *
 * Für ALLE Begriffe ohne Bild, nicht nur die mit needs_illustration: dieses Feld
 * wird beim Generieren entschieden und nicht gespeichert, im Nachhinein ist die
 * damalige Entscheidung nicht rekonstruierbar. Auf einer Lexikonseite ist ein
 * Bild ohnehin der Regelfall.
 */
export async function generateMissingIllustrations(
  supabase: AdminClient,
): Promise<IllustrationResult> {
  const { generateGlossaryIllustration, uploadGlossaryIllustration } =
    await import('@/lib/gemini/image-generator')

  const { data, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, summary')
    .eq('status', 'published')
    .is('illustration_url', null)
    .order('slug')
  if (error) throw new Error(`Begriffe nicht ladbar: ${error.message}`)

  const all = (data ?? []) as Array<{ id: string; slug: string; canonical_name: string; summary: string }>
  const batch = all.slice(0, IMAGES_PER_RUN)
  const done: string[] = []
  const failed: string[] = []

  for (const term of batch) {
    try {
      const img = await generateGlossaryIllustration(term.canonical_name, term.summary)
      if (!img.success || !img.imageBase64) {
        console.error(`[GlossaryCrawl] Bild für ${term.slug} fehlgeschlagen: ${img.error}`)
        failed.push(term.slug)
        continue
      }
      const url = await uploadGlossaryIllustration(img.imageBase64, term.slug)
      const { error: upErr } = await supabase
        .from('glossary_terms')
        // NUR die URL. Hier stand vorher ein Schablonen-Alt-Text
        // ("Illustration zum Begriff X") mit der Begründung, ein beschreibender
        // Fallback sei besser als ein leeres alt-Attribut. Das war falsch in
        // zwei Richtungen:
        //   - Als alt-Text sagt die Schablone einem Screenreader nichts, was der
        //     Begriff daneben nicht schon sagt. Die Seite rendert stattdessen den
        //     Begriffsnamen als alt, wenn kein echter Text vorliegt.
        //   - Als Bildunterschrift (2026-08-04 eingeführt) stand die Schablone
        //     sichtbar auf der Seite und trug nichts bei. Weil dieser Pfad ALLE
        //     nachträglich erzeugten Bilder betrifft, war das jeder Eintrag.
        // Leer lassen heißt: keine Unterschrift. Nur ein wirklich beschreibender
        // Text aus der Generierung (generate.ts) bekommt eine.
        .update({ illustration_url: url })
        .eq('id', term.id)
      if (upErr) {
        console.error(`[GlossaryCrawl] illustration_url für ${term.slug} nicht speicherbar:`, upErr.message)
        failed.push(term.slug)
        continue
      }
      done.push(term.slug)
    } catch (err) {
      console.error(`[GlossaryCrawl] Bild für ${term.slug} abgebrochen:`, err)
      failed.push(term.slug)
    }
  }

  return { done, failed, remaining: Math.max(0, all.length - done.length) }
}

export interface GenerationResult {
  generated: Array<{ name: string; slug: string; mentions: number }>
  failed: string[]
  remainingCandidates: number
}

/**
 * Erzeugt die häufigsten noch offenen Kandidaten und veröffentlicht sie.
 *
 * Sortierung nach Fundstellenzahl: ein Begriff, der in fünf Artikeln vorkommt,
 * nützt mehr Lesern als eine Einmal-Nennung — und er verlinkt sich später
 * dichter, weil er in mehr Texten gematcht wird.
 *
 * status='published' direkt (Entscheidung des Betreibers): das Lexikon soll ohne
 * Zwischenschritt wachsen. Die Mindestqualität sichert Regel 4 in
 * generateTermContent, die bei unter 400 Wörtern nachfordert und danach
 * abbricht — ein zu dünner Eintrag entsteht also gar nicht.
 */
/**
 * Wie viele Kandidaten sind noch ECHTE Arbeit — also weder abgewählt noch schon
 * erzeugt (oder endgültig gescheitert, was ebenfalls in `generated` landet)?
 *
 * Muss von der reinen Kandidatenzahl unterschieden werden: abgewählte Namen
 * bleiben absichtlich in der Liste, damit der Operator seine Entscheidung sieht
 * und zurücknehmen kann. Sie als offene Arbeit zu melden hat den Batch-Lauf im
 * Browser nie enden lassen — der wartet darauf, dass diese Zahl 0 wird, und mit
 * einem einzigen abgewählten Kandidaten wurde sie das nie.
 */
export function openCandidateCount(
  candidates: Record<string, number>,
  excluded: string[],
  generated: string[],
): number {
  const ex = new Set(excluded)
  const gen = new Set(generated)
  return Object.keys(candidates).filter((name) => !ex.has(name) && !gen.has(slugify(name))).length
}

/**
 * @param limit Wie viele Begriffe dieser Aufruf erzeugt. Default
 *   TERMS_PER_GENERATION (3) für den kleinen Knopf; der Dauerlauf im Browser
 *   ruft mit 1 auf. Grund ist maxDuration=300: drei Begriffe brauchen 135-270s
 *   plus Übersetzung und Produktzuordnung, ein Begriff mit Nachforderung nach
 *   Regel 4 reißt das Limit. Der Request stirbt dann als 504 ohne JSON — für den
 *   Aufrufer sieht das aus wie ein stiller Abbruch mitten in der Nacht.
 */
export async function generateCandidates(
  supabase: AdminClient,
  limit: number = TERMS_PER_GENERATION,
): Promise<GenerationResult> {
  const state = await readCrawlState(supabase)
  const alreadyGenerated = new Set(state.generated)
  const excluded = new Set(state.excluded)

  const queue = Object.entries(state.candidates)
    // Abgewählte werden übersprungen, bleiben aber in der Liste: der Operator
    // soll seine Entscheidung sehen und zurücknehmen können, statt dass der
    // Begriff verschwindet und beim nächsten Crawl wieder auftaucht.
    .filter(([name]) => !excluded.has(name) && !alreadyGenerated.has(slugify(name)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit))

  const generated: GenerationResult['generated'] = []
  const failed: string[] = []
  const candidates = { ...state.candidates }
  const generatedSlugs = [...state.generated]

  for (const [name, mentions] of queue) {
    const slug = slugify(name)
    const created = await generateAndInsertDraft(supabase, name, slug)
    if (!created) {
      failed.push(name)
      // Aus der Liste nehmen UND als erledigt markieren: ein Name, der zweimal
      // scheitert (zu kurz nach Regel 4, Slug-Kollision), würde sonst bei jedem
      // Lauf erneut die teuren Calls verbrauchen und die Warteschlange blockieren.
      generatedSlugs.push(slug)
      delete candidates[name]
      continue
    }
    // Direkt veröffentlichen — bewusste Betreiber-Entscheidung.
    const { error: pubError } = await supabase
      .from('glossary_terms')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('slug', created.slug)
    if (pubError) {
      console.error('[GlossaryCrawl] Veröffentlichen fehlgeschlagen für', created.slug, pubError.message)
    }
    // Produkt-Zuordnung ist Zugabe und darf den Begriff nicht kosten.
    try {
      const { data: row } = await supabase
        .from('glossary_terms').select('id').eq('slug', created.slug).maybeSingle()
      const termId = (row as { id: string } | null)?.id
      if (termId) await assignProducts(termId, created.canonicalName, created.summary)
    } catch (err) {
      console.error('[GlossaryCrawl] Produkt-Zuordnung fehlgeschlagen für', created.slug, err)
    }

    // Gleich übersetzen: der Crawl veröffentlicht direkt, ohne Übersetzung wäre
    // jeder so entstandene Begriff auf /en/glossary/* deutsch. Menge ist durch
    // TERMS_PER_GENERATION gedeckelt, der Aufruf wirft nie.
    try {
      const { data: row } = await supabase
        .from('glossary_terms').select('id').eq('slug', created.slug).maybeSingle()
      const tid = (row as { id: string } | null)?.id
      if (tid) {
        const { translatePublishedTerms } = await import('@/lib/glossary/translate')
        await translatePublishedTerms([tid])
      }
    } catch (err) {
      console.error(`[GlossaryCrawl] Übersetzung für ${created.slug} fehlgeschlagen:`, err)
    }

    generated.push({ name, slug: created.slug, mentions })
    generatedSlugs.push(created.slug)
    delete candidates[name]
  }

  await writeCrawlState(supabase, { ...state, candidates, generated: generatedSlugs })

  // NUR offene Arbeit zählen, nicht alle Kandidaten: abgewählte bleiben in der
  // Liste stehen und hätten den Batch-Lauf endlos weiterlaufen lassen.
  return {
    generated,
    failed,
    remainingCandidates: openCandidateCount(candidates, state.excluded, generatedSlugs),
  }
}
