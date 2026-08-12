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
import { identifyCandidates, slugify, normalizeSlugForDedup } from '@/lib/glossary/generate'
import { generateAndInsertDraft, lastGenerationFailureWasRetryable, lastGenerationFailureWasConfigError } from '@/lib/glossary/draft-writer'
import { assignProducts } from '@/lib/glossary/products'
import { extractVisibleText } from '@/lib/posts/product-mentions'
import { safeParseJSON } from '@/lib/utils/safe-json'
import { backfillGlossaryLinks, type BackfillResult } from '@/lib/glossary/backfill'
import { relinkTranslationsBatch, type TranslationBackfillResult } from '@/lib/glossary/backfill-translations'
import { getMatcherTerms, buildReservedNames, getChartProductNames } from '@/lib/glossary/terms'
import { isExcludedGlossaryTerm } from '@/lib/data/glossary-exclusions'

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
  /** created_at des zuletzt verarbeiteten Artikels; Cursor für den nächsten Lauf.
   *  `null` heißt „Bestand durchgearbeitet" — dann übernimmt `newestRead`. */
  cursor: string | null
  /**
   * created_at des NEUESTEN je gelesenen Artikels — die Hochwassermarke.
   *
   * BETREIBER-BEFUND 2026-08-10: Das Panel meldete „30 von 225 Artikeln gelesen",
   * obwohl alles längst durchgearbeitet war. Der Cursor lief nur ABWÄRTS; war der
   * Bestand einmal durch, blieb er am ältesten Artikel stehen, und jeder NEUE
   * Artikel war neuer als der Cursor — fiel also dauerhaft aus der Abfrage. Der
   * einzige Ausweg war „Fortschritt zurücksetzen", was alle 225 erneut las.
   *
   * Mit dieser Marke liest der Crawl nach einem vollständigen Durchlauf nur noch,
   * was seither dazukam (s. crawlPhase).
   */
  newestRead?: string | null
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
  /** Cursor der Nachverlinkung bestehender Artikel (created_at des letzten
   *  geprueften Posts). null heisst "noch nicht gestartet ODER durch" — der
   *  Aufrufer setzt ihn nach einem vollstaendigen Durchlauf zurueck, damit ein
   *  neuer Begriff einen neuen Durchlauf ueber alle Artikel bekommt. */
  relinkCursor?: string | null
  /** Cursor der Nachverlinkung ÜBERSETZTER Artikel (id der zuletzt geprüften
   *  content_translations-Zeile). Eigener Cursor statt relinkCursor: die beiden
   *  Läufe gehen über verschiedene Tabellen mit verschiedenen Sortierschlüsseln
   *  (created_at vs. id) und dürfen sich nicht gegenseitig zurücksetzen. */
  translationsCursor?: string | null
  updatedAt: string | null
}

const EMPTY_STATE: CrawlState = {
  cursor: null, newestRead: null, postsProcessed: 0, candidates: {}, generated: [], excluded: [],
  relinkCursor: null, translationsCursor: null, updatedAt: null,
}

/**
 * In welcher Phase steht der Crawl?
 *
 * - `erstlauf`   — nichts gelesen: von den neuesten Artikeln rückwärts starten.
 * - `aufholen`   — ein Cursor steht: rückwärts weiter durch den Altbestand.
 * - `nachfuehren`— Bestand durch (Cursor gelöst, Marke gesetzt): nur noch lesen,
 *                  was NEUER ist als die Marke. Ohne diese Phase blieb der Crawl
 *                  am ältesten Artikel hängen und sah neue Artikel nie wieder.
 *
 * Eine fehlende Marke gilt bewusst als Erstlauf: Zustände aus der Zeit vor
 * diesem Feld dürfen nicht in die Nachführ-Phase fallen, sonst läse der Crawl
 * gar nichts mehr.
 */
export function crawlPhase(
  state: { cursor: string | null; newestRead?: string | null },
): 'erstlauf' | 'aufholen' | 'nachfuehren' {
  if (state.cursor) return 'aufholen'
  return state.newestRead ? 'nachfuehren' : 'erstlauf'
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
    newestRead: typeof s.newestRead === 'string' ? s.newestRead : null,
    relinkCursor: typeof s.relinkCursor === 'string' ? s.relinkCursor : null,
    translationsCursor: typeof s.translationsCursor === 'string' ? s.translationsCursor : null,
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

/**
 * Baut den zu schreibenden Zustand aus einem VERALTETEN Snapshot, der aktuellen
 * Auswahl und den Aenderungen dieses Laufs.
 *
 * PROD-BEFUND 2026-08-08: Waehrend ein Erzeugen-Job lief, wurden 78 Kandidaten
 * abgewaehlt — beim naechsten Tick waren sie wieder da. Fortschritt und Auswahl
 * liegen in DERSELBEN JSONB-Spalte. Der Job liest den ganzen Zustand zu Beginn
 * seines Ticks, arbeitet 45-90 Sekunden an einem Begriff und schrieb am Ende
 * `{ ...state, candidates, generated }` zurueck. Das `...state` trug das ALTE
 * `excluded` mit, jede Abwahl in diesem Zeitfenster war verloren — ohne Fehler
 * und ohne Meldung.
 *
 * Das trifft nicht nur Skripte: der Operator waehlt im Panel waehrend eines
 * laufenden Laufs ab, und seine Entscheidung verschwindet. Das Panel sperrt
 * extract/generate/reset waehrend `termsRunning`, die Abwahl-Checkboxen aber
 * nicht — und soll es auch nicht, denn Abwaehlen ist genau das, was man tut,
 * waehrend man den Lauf beobachtet.
 *
 * Die Regel dahinter: wer FORTSCHRITT schreibt, darf die AUSWAHL nicht
 * mitschreiben. Sie ist die Entscheidung eines Menschen und immer juenger als
 * der Snapshot.
 */
export function mergeProgressState(
  staleState: CrawlState,
  currentExcluded: string[],
  changes: Partial<CrawlState>,
): CrawlState {
  return { ...staleState, ...changes, excluded: currentExcluded }
}

/**
 * Schreibt den Fortschritt eines Laufs und uebernimmt dabei die AKTUELLE
 * Auswahl aus der Datenbank statt der aus dem uebergebenen Snapshot.
 *
 * Kein Ersatz fuer eine echte Transaktion — zwischen Lesen und Schreiben bleibt
 * ein Fenster von Millisekunden. Das entscheidende Fenster war aber ein anderes:
 * die 45-90 Sekunden, die ein Tick an einem Begriff arbeitet. Genau die schliesst
 * diese Funktion.
 */
async function writeCrawlProgress(
  supabase: AdminClient,
  staleState: CrawlState,
  changes: Partial<CrawlState>,
): Promise<void> {
  const current = await readCrawlState(supabase)
  await writeCrawlState(supabase, mergeProgressState(staleState, current.excluded, changes))
}

/** Schreibt nur den Nachverlinkungs-Cursor, ohne den restlichen Crawl-Zustand
 *  anzufassen — die beiden Läufe sind unabhängig und dürfen sich nicht
 *  gegenseitig zurücksetzen. */
export async function writeRelinkCursor(
  supabase: AdminClient,
  relinkCursor: string | null,
): Promise<void> {
  const state = await readCrawlState(supabase)
  await writeCrawlState(supabase, { ...state, relinkCursor })
}

/** Schreibt nur den Cursor der Übersetzungs-Nachverlinkung. Gleiche Bauart wie
 *  writeRelinkCursor: der jeweils andere Lauf darf nicht zurückgesetzt werden. */
export async function writeTranslationsCursor(
  supabase: AdminClient,
  translationsCursor: string | null,
): Promise<void> {
  const state = await readCrawlState(supabase)
  await writeCrawlState(supabase, { ...state, translationsCursor })
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

  const phase = crawlPhase(state)

  let query = supabase
    .from('generated_posts')
    .select('id, title, content, created_at')
    .eq('status', 'published')
    .limit(POSTS_PER_EXTRACTION)
  if (phase === 'nachfuehren') {
    // Bestand ist durch — nur noch, was seit der Hochwassermarke dazukam,
    // aufsteigend (aelteste zuerst), damit die Marke lueckenlos weiterwandert.
    query = query.order('created_at', { ascending: true }).gt('created_at', state.newestRead!)
  } else {
    // Erstlauf/Aufholen: von den neuesten rueckwaerts, Cursor strikt aelter als
    // der zuletzt verarbeitete Artikel.
    query = query.order('created_at', { ascending: false })
    if (state.cursor) query = query.lt('created_at', state.cursor)
  }

  const { data: posts, error } = await query
  if (error) throw new Error(`Artikel nicht ladbar: ${error.message}`)

  const { count: totalPosts } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')

  const rows = (posts ?? []) as Array<{ id: string; content: unknown; created_at: string }>
  if (rows.length === 0) {
    // DURCHLAUF BEENDET. Cursor lösen und die Hochwassermarke auf den neuesten
    // Artikel setzen: bis hierher ist alles gelesen. Erst dadurch wechselt der
    // nächste Lauf in die Nachführ-Phase und liest nur noch Neues — vorher blieb
    // der Cursor am ältesten Artikel stehen und neue Artikel kamen nie dran.
    //
    // Die Marke kommt aus dem Bestand statt aus den gelesenen Zeilen: beim
    // Aufholen wandert der Cursor abwärts, das Maximum der ZULETZT gelesenen
    // Zeilen wäre also viel zu niedrig und würde den halben Bestand erneut in
    // die Nachführ-Phase holen. Deckt zugleich Altzustände ohne Marke ab.
    if (phase !== 'nachfuehren') {
      const { data: neuester } = await supabase
        .from('generated_posts')
        .select('created_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const marke = (neuester as { created_at: string } | null)?.created_at ?? state.newestRead ?? null
      await writeCrawlProgress(supabase, state, { cursor: null, newestRead: marke })
    }
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

  // Hochwassermarke mitziehen: das Neueste, was je gelesen wurde.
  const marke = rows.reduce(
    (max, r) => (r.created_at > max ? r.created_at : max),
    state.newestRead ?? '',
  )

  // In der Nachführ-Phase BLEIBT der Cursor gelöst — wir laufen vorwärts durch
  // die neuen Artikel und dürfen nicht zurück in den Altbestand fallen.
  const nachfuehren = phase === 'nachfuehren'

  // Offene Artikel: beim Aufholen der Rest des Bestands, beim Nachführen nur,
  // was neuer ist als die Marke (im Regelfall der Artikel von heute).
  let remaining: number
  let postsProcessed: number
  if (nachfuehren) {
    const { count: offen } = await supabase
      .from('generated_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gt('created_at', marke)
    remaining = offen ?? 0
    // „X von N gelesen" bleibt so aussagekräftig: gelesen ist alles bis auf die
    // offenen. Der kumulative Zähler liefe sonst über die Bestandsgröße hinaus.
    postsProcessed = Math.max(0, (totalPosts ?? 0) - remaining)
  } else {
    postsProcessed = state.postsProcessed + rows.length
    remaining = Math.max(0, (totalPosts ?? 0) - postsProcessed)
  }

  await writeCrawlProgress(supabase, state, {
    cursor: nachfuehren ? null : rows[rows.length - 1].created_at,
    newestRead: marke || null,
    postsProcessed,
    candidates,
  })
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
  /** Namen, die VORÜBERGEHEND gescheitert sind (529/429/Netz) und in der
   *  Warteschlange geblieben sind. Der Aufrufer muss sie von `failed`
   *  unterscheiden: sie sind kein Grund weiterzulaufen, sondern einer, es später
   *  erneut zu versuchen — sonst dreht die Schleife bei anhaltender Überlast
   *  endlos und verbrennt Geld. */
  retryable: string[]
  /** Namen, die an der REQUEST-/Modellkonfiguration gescheitert sind (HTTP 400)
   *  und deshalb ebenfalls in der Warteschlange bleiben. Getrennt von
   *  `retryable`, weil ein sofortiger zweiter Versuch hier nichts bringt: erst
   *  muss die Konfiguration korrigiert werden. Die UI benennt beides
   *  unterschiedlich, damit „Modell überlastet“ nicht für einen Parameterfehler
   *  steht. */
  configFailed: string[]
  /** Kandidaten, die es als Begriff schon gab — kein Fehler, nur nichts zu tun.
   *  Getrennt von `failed`, weil die UI beides unterschiedlich benennen muss:
   *  "existiert bereits" ist ein Aufräumvorgang, "übersprungen" ein Problem. */
  alreadyExisting: string[]
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
 * Trennt die Warteschlange in "muss erzeugt werden" und "gibt es schon".
 *
 * PROD-BEFUND 2026-08-05: der Insert scheiterte mit
 * `duplicate key ... glossary_terms_slug_key` fuer "Advanced Encryption
 * Standard" — der Begriff lag laengst veroeffentlicht in der Tabelle. Der
 * Kandidatenfilter prueft nur die crawl-eigene `generated`-Liste; Begriffe, die
 * NACH der Extraktion auf anderem Weg entstanden sind (Freigabe beim
 * Artikel-Speichern), bleiben in der Warteschlange stehen.
 *
 * Teuer war daran nicht der Fehler, sondern seine Reihenfolge: der Text wurde
 * voll erzeugt (zwei Opus-Aufrufe, rund 60s) und ERST DANACH scheiterte der
 * Insert. Deshalb hier vorher aussortieren.
 *
 * Faengt zusaetzlich Kandidaten ab, die untereinander auf denselben Slug fallen
 * ("AES-Standard" und "AES Standard") — der zweite wuerde am selben Constraint
 * scheitern.
 */
/**
 * Vergleicht ueber den NORMALISIERTEN Slug (normalizeSlugForDedup), nicht nur
 * ueber den exakten. Ein exakter Treffer ist ein Sonderfall eines
 * normalisierten Treffers (ein Slug normalisiert immer zu sich selbst gleich),
 * die bisherige Faehigkeit bleibt also erhalten - zusaetzlich faengt es jetzt
 * Schreibvarianten wie "Eval"/"Evals" oder "Pretraining"/"Pre-Training" ab, die
 * exakte Gleichheit nicht sieht (Befund 2026-08-06: vier solche Paare in Prod,
 * jedes einmal generiert UND bezahlt, weil sie zwei verschiedene Slugs ergeben).
 */
/**
 * Alle vorhandenen Begriffs-Slugs — die Grundlage jedes „gibt es schon?"-Abgleichs.
 *
 * Nur die schmale Spalte und PAGINIERT: PostgREST kappt ohne `range()` still bei
 * 1000 Zeilen, bei 2217 Begriffen gälte der Rest als nicht vorhanden.
 *
 * Kein Status-Filter: ein Insert scheitert am Unique-Constraint unabhängig davon,
 * ob die bestehende Zeile published/draft/hidden ist.
 *
 * Ausgelagert, damit ANZEIGE und ABARBEITUNG dieselbe Antwort bekommen. Genau
 * daran hing der Betreiber-Befund 2026-08-10: das Panel meldete „260 offen, 0
 * bereits erzeugt", weil es nur die crawl-eigene `generated`-Liste kannte (nach
 * einem Zurücksetzen leer) — während die Erzeugung längst korrekt gegen die
 * Datenbank abglich und 44 davon übersprungen hätte.
 */
export async function loadExistingSlugs(supabase: AdminClient): Promise<Set<string>> {
  const slugs = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('slug')
      .range(offset, offset + 999)
    if (error) {
      console.error('[GlossaryCrawl] Bestand nicht ladbar:', error.message)
      break
    }
    if (!data?.length) break
    for (const r of data) slugs.add(r.slug as string)
    if (data.length < 1000) break
  }
  return slugs
}

export function partitionByExisting(
  queue: Array<[string, number]>,
  existingSlugs: Set<string>,
): { toGenerate: Array<[string, number]>; alreadyExisting: string[] } {
  const seen = new Set([...existingSlugs].map(normalizeSlugForDedup))
  const toGenerate: Array<[string, number]> = []
  const alreadyExisting: string[] = []
  for (const entry of queue) {
    const slug = slugify(entry[0])
    const key = normalizeSlugForDedup(slug)
    if (seen.has(key)) { alreadyExisting.push(entry[0]); continue }
    seen.add(key)
    toGenerate.push(entry)
  }
  return { toGenerate, alreadyExisting }
}

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

  const allOpen = Object.entries(state.candidates)
    // Abgewählte werden übersprungen, bleiben aber in der Liste: der Operator
    // soll seine Entscheidung sehen und zurücknehmen können, statt dass der
    // Begriff verschwindet und beim nächsten Crawl wieder auftaucht.
    // Gesperrte Allgemeinwörter fliegen auch dann raus, wenn sie schon als
    // Kandidat im Zustand stehen — die Liste kam nach ihrer Aufnahme
    // (Betreiber 2026-08-12), ein reiner Filter beim Einsammeln würde sie nie
    // mehr erwischen.
    .filter(([name]) => !excluded.has(name) && !isExcludedGlossaryTerm(name) && !alreadyGenerated.has(slugify(name)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  // Grosszuegiger schneiden als `limit`: aussortierte (weil schon vorhandene)
  // Kandidaten sollen nicht den ganzen Aufruf verbrauchen. Sonst brauchte ein
  // Lauf ueber 40 laengst existierende Begriffe 40 Requests, die alle nichts tun.
  const rawQueue = allOpen.slice(0, Math.max(1, limit) * 20)

  // Bestand aus der DATENBANK, nicht nur aus dem Crawl-State: Begriffe, die nach
  // der Extraktion auf anderem Weg entstanden sind, stehen sonst weiter in der
  // Warteschlange und kosten je einen vollen Generierungslauf, bevor der Insert
  // an ihrem Unique-Constraint scheitert (Prod-Befund 2026-08-05).
  //
  // GANZER Bestand, nicht nur die exakten Slugs der aktuellen Warteschlange
  // (frueher: .in('slug', rawQueue...)): partitionByExisting vergleicht seit
  // Befund 2026-08-06 normalisiert (ohne Bindestriche, ohne End-"s"), und eine
  // normalisierte Kollision kann gegen JEDEN vorhandenen Slug auftreten, nicht
  // nur gegen einen exakt gleich geschriebenen. "Eval" haette gegen die enge
  // Abfrage nie "evals" gesehen, weil "eval" != "evals" als Suchstring. Kein
  // Status-Filter: ein Insert scheitert am Unique-Constraint unabhaengig davon,
  // ob die bestehende Zeile published/draft/hidden ist. Nur die schmale Spalte
  // (kein body/summary), paginiert - PostgREST kappt sonst still bei 1000 Zeilen.
  const existingSlugs = await loadExistingSlugs(supabase)

  const { toGenerate, alreadyExisting } = partitionByExisting(rawQueue, existingSlugs)
  const queue = toGenerate.slice(0, Math.max(1, limit))

  const generated: GenerationResult['generated'] = []
  const failed: string[] = []
  const retryable: string[] = []
  /** An der Request-/Modellkonfiguration gescheitert — bleibt in der Warteschlange,
   *  aber ein sofortiger zweiter Versuch hilft nicht (s. unten). */
  const configFailed: string[] = []
  const candidates = { ...state.candidates }
  const generatedSlugs = [...state.generated]

  // Vorhandene sofort abhaken: sie sind erledigt, ohne dass ein Modell laeuft.
  for (const name of alreadyExisting) {
    generatedSlugs.push(slugify(name))
    delete candidates[name]
  }

  for (const [name, mentions] of queue) {
    const slug = slugify(name)
    const created = await generateAndInsertDraft(supabase, name, slug)
    if (!created) {
      failed.push(name)
      // VORÜBERGEHEND gescheitert (529 Overloaded, 429, Netzabbruch)? Dann bleibt
      // der Begriff in der Warteschlange. Prod-Befund 2026-08-05: ein 529 mit
      // x-should-retry: true kostete "Feature Engineering" und "Fehlausrichtung"
      // dauerhaft — sie wurden abgehakt und nie wieder versucht.
      if (lastGenerationFailureWasRetryable()) {
        console.warn(`[GlossaryCrawl] "${name}" vorübergehend gescheitert — bleibt in der Warteschlange`)
        retryable.push(name)
        continue
      }
      // HTTP 400: der REQUEST war falsch, nicht der Begriff. Prod-Befund
      // 2026-08-07: claude-fable-5 lehnte thinking.type.disabled ab, und weil ein
      // 400 `x-should-retry: false` trägt, galt jeder Fehlschlag als endgültig —
      // 100 einwandfreie Kandidaten wurden abgehakt und mussten von Hand
      // zurückgesetzt werden.
      //
      // Wie bei `retryable` bleibt der Begriff in der Warteschlange. Dass der
      // Lauf dadurch nicht ewig kreist, sichert die bestehende Eskalation: nach
      // zehn Durchgängen ohne Fortschritt gibt der Job auf — sichtbar im
      // Protokoll, statt still Kandidaten zu verbrauchen.
      if (lastGenerationFailureWasConfigError()) {
        console.warn(`[GlossaryCrawl] "${name}" an der Request-/Modellkonfiguration gescheitert — bleibt in der Warteschlange`)
        configFailed.push(name)
        continue
      }
      // Aus der Liste nehmen UND als erledigt markieren: ein Name, der aus
      // INHALTLICHEN Gründen scheitert (zu kurz nach Regel 4, Slug-Kollision),
      // würde sonst bei jedem Lauf erneut die teuren Calls verbrauchen und die
      // Warteschlange blockieren.
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

  await writeCrawlProgress(supabase, state, { candidates, generated: generatedSlugs })

  // NUR offene Arbeit zählen, nicht alle Kandidaten: abgewählte bleiben in der
  // Liste stehen und hätten den Batch-Lauf endlos weiterlaufen lassen.
  return {
    generated,
    failed,
    retryable,
    configFailed,
    alreadyExisting,
    remainingCandidates: openCandidateCount(candidates, state.excluded, generatedSlugs),
  }
}

/**
 * Ein Nachverlinkungs-Durchgang ueber den Bestand.
 *
 * Buendelt, was bisher inline im Route-Zweig action=relink stand
 * (glossary-crawl/route.ts:117-141): Begriffe laden, reservierte Namen bauen,
 * Cursor lesen und zurueckschreiben. Die Verlinkung selbst steckte schon in
 * backfillGlossaryLinks — erreichbar war sie vom Cron aber nicht, und genau das
 * braucht der servergetriebene Lauf.
 *
 * @param since UNTERE Zeitgrenze ("verlinke Artikel AB diesem Tag"), wie im
 *   Panel. null heisst: der ganze Bestand.
 */
export async function relinkNextBatch(
  supabase: AdminClient,
  opts: { since?: string | null } = {},
): Promise<BackfillResult> {
  const terms = await getMatcherTerms('de')
  if (terms === null) {
    // Harter Fehler statt leerer Liste: mit null Begriffen wuerde jeder Artikel
    // als "nichts zu verlinken" abgehakt und der Cursor durch den ganzen
    // Bestand laufen, ohne etwas zu tun.
    throw new Error('Begriffsliste nicht ladbar — Nachverlinkung abgebrochen')
  }
  const reserved = buildReservedNames(await getChartProductNames())
  const state = await readCrawlState(supabase)

  const result = await backfillGlossaryLinks(
    supabase, terms, reserved, state.relinkCursor ?? null, undefined, opts.since ?? null,
  )
  // remaining === 0 setzt den Cursor zurueck, damit der naechste Lauf wieder
  // von vorn prueft statt mitten im Bestand aufzusetzen.
  await writeRelinkCursor(supabase, result.remaining === 0 ? null : result.cursor)
  return result
}

/**
 * Ein Batch der Übersetzungs-Nachverlinkung, mit Cursor-Verwaltung.
 *
 * Zwilling von relinkNextBatch für `content_translations`. Die Begriffslisten
 * lädt relinkTranslationsBatch selbst (je Sprache einmal pro Batch) — anders
 * als hier, wo relinkNextBatch sie vorab beschafft, weil backfillGlossaryLinks
 * nur eine einzige, deutsche Liste braucht.
 */
export async function relinkTranslationsNextBatch(
  supabase: AdminClient,
): Promise<TranslationBackfillResult> {
  const state = await readCrawlState(supabase)
  const result = await relinkTranslationsBatch(supabase, state.translationsCursor ?? null)
  await writeTranslationsCursor(supabase, result.remaining === 0 ? null : result.cursor)
  return result
}
