import { createAdminClient } from '@/lib/supabase/admin'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

/** Spaltenliste für Listen-Queries. Ohne body/embedding — wide JSONB-Selects
 *  in Listen-Queries waren die Ursache des 109-GB-Egress-Overage. `id` wird
 *  intern für die Übersetzungs-Zuordnung gebraucht und vor der Rückgabe
 *  wieder verworfen. */
const LIST_COLUMNS = 'id, slug, canonical_name, summary'

/** Ohne summary — für das Register in der Seitenspalte und für die Sitemap, die
 *  beide nur Slug und Name brauchen. Bei 500 Begriffen sind das rund 20 KB statt
 *  120 KB je Seitenaufbau, und die Funktion läuft in JEDER Begriffsseite. */
const NAV_COLUMNS = 'id, slug, canonical_name'

/** Seitengröße der Pagination. PostgREST kappt eine Abfrage ohne range() still
 *  bei 1000 Zeilen — bei den Company-Mentions hat genau das 34% der Zeilen
 *  verschluckt, ohne Fehler und ohne Log. */
const PAGE_SIZE = 1000

/**
 * TTL-Cache für die drei Voll-Katalog-Scans dieser Datei (Begriffsliste,
 * Matcher-Liste, Chart-Produktnamen).
 *
 * Befund 2026-08-19: `getMatcherTerms` und `getPublishedTermList` laufen
 * ungecacht bei JEDEM Rendern/ISR-Revalidate einer Begriffsseite — bei 2171
 * veröffentlichten Begriffen ~220 Byte/Zeile sind das ~480 KB je Aufruf, für
 * jede der (wachsenden Zahl an) Begriffsseiten, mehrfach pro Tag. Der Katalog
 * existierte beim letzten Egress-Audit (2026-08-01) noch gar nicht — das
 * Fachbegriff-Lexikon ging erst am 2026-08-04 live und ist seither ungeprüft
 * mitgewachsen. 60 Minuten TTL (angehoben von ursprünglich 10 Min, 2026-08-19,
 * zusammen mit dem auf 6h angehobenen `revalidate` der Begriffsseite): die
 * einzige Nebenwirkung ist, dass ein neu veröffentlichter Begriff bis zu einer
 * Stunde lang nicht rückwirkend in älteren Begriffstexten verlinkt erscheint —
 * die Verlinkung selbst bleibt korrekt (kein verlorener Begriff), nur ihr
 * Erscheinen verzögert sich. Nur ERFOLGREICHE Ergebnisse werden gecacht; ein
 * Fehler (`null`) schlägt beim nächsten Aufruf sofort erneut durch, statt
 * einen transienten Ausfall für die volle Stunde festzuschreiben.
 */
const CACHE_TTL_MS = 60 * 60 * 1000

/** Alle Cache-Stores dieser Datei, nur damit resetGlossaryTermsCachesForTests
 *  sie gemeinsam leeren kann. */
const allCacheStores: Array<Map<string, { value: unknown; expiresAt: number }>> = []

function withTtlCache<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyOf: (...args: A) => string,
  isCacheable: (value: R) => boolean = (v) => v !== null,
): (...args: A) => Promise<R> {
  const store = new Map<string, { value: R; expiresAt: number }>()
  allCacheStores.push(store as Map<string, { value: unknown; expiresAt: number }>)
  return async (...args: A): Promise<R> => {
    const key = keyOf(...args)
    const hit = store.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value
    const value = await fn(...args)
    if (isCacheable(value)) store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  }
}

/** Nur für Tests: ohne dieses Leeren würde ein Testfall vom (gemockten)
 *  Erfolg eines früheren profitieren, weil der Cache modulweit lebt. */
export function resetGlossaryTermsCachesForTests(): void {
  for (const store of allCacheStores) store.clear()
}

/** Begriffe je Übersetzungs-Abfrage. `.in('term_id', ids)` landet als
 *  Query-String in der URL, nicht im Body: bei 745 Begriffen sind das rund
 *  27.500 Zeichen, und PostgREST antwortet mit `Bad Request`. An Prod gemessen
 *  (2026-08-06): 300 IDs gehen, ab 500 bricht es. 200 hält mit rund 7.400
 *  Zeichen reichlich Abstand und liefert höchstens 200 Zeilen je Abfrage,
 *  bleibt also auch unter PAGE_SIZE. Gleiche Blockgröße wie in
 *  lib/rankings/consolidate.ts. */
const TRANSLATION_CHUNK = 200

/**
 * Übersetzungszeilen zu einer Begriffsliste, blockweise geholt.
 *
 * DER FILTER MUSS GESTÜCKELT WERDEN, und die Blockgröße ist kein Detail: die
 * drei Aufrufer unten filterten bis zum 2026-08-06 mit der VOLLEN ID-Liste in
 * einem `.in()`. Das lief jahrelang, weil die URL passte — bis der Bestand über
 * rund 400 Begriffe wuchs. Dann schlug die Abfrage komplett fehl, und weil zwei
 * der drei Aufrufer ihren Fehler still abfangen (`return rows`), zeigte das
 * gesamte englische Lexikon deutsche Namen, obwohl 745 von 746 Begriffen eine
 * englische Fassung hatten. Der dritte Aufrufer (getMatcherTerms) gab `null`
 * zurück und riss damit den translations-Job mit "Begriffsliste (cs) nicht
 * ladbar" zehnmal in Folge ab.
 *
 * Nach `term_id` UND `language` zu filtern statt nur nach `language` bleibt
 * richtig — der Primary Key ist (term_id, language), ein language-only-Filter
 * nutzt dessen Präfix nicht. Es muss nur in Blöcken passieren.
 *
 * Ein Fehler in EINEM Block macht den ganzen Aufruf ungültig (`error` gesetzt,
 * keine Zeilen): eine halbe Übersetzungsmenge ist schlimmer als keine, weil sie
 * pro Begriff still auf den deutschen Namen zurückfällt und damit wie ein
 * gepflegter Zustand aussieht.
 */
async function fetchTranslationsChunked(
  supabase: ReturnType<typeof createAdminClient>,
  columns: string,
  termIds: string[],
  lang: string,
): Promise<{ rows: Array<Record<string, unknown>>; error: string | null }> {
  const rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < termIds.length; i += TRANSLATION_CHUNK) {
    const { data, error } = await supabase
      .from('glossary_term_translations')
      .select(columns)
      .in('term_id', termIds.slice(i, i + TRANSLATION_CHUNK))
      .eq('language', lang)
    if (error) return { rows: [], error: error.message }
    rows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>))
  }
  return { rows, error: null }
}

async function getPublishedTermListUncached(
  lang: string,
  options: { includeSummary?: boolean } = {},
): Promise<Array<{ slug: string; canonicalName: string; summary: string }>> {
  const includeSummary = options.includeSummary ?? true
  const supabase = createAdminClient()

  const rows: Array<{ id: string; slug: string; canonicalName: string; summary: string }> = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('glossary_terms')
      // Cast nötig: supabase-js parst den Select-String zur COMPILE-Zeit als
      // Literal, um den Rückgabetyp abzuleiten. Ein Ternär ergibt dort eine
      // Union, die der Parser nicht auflöst (ParserError). Der Cast auf das
      // breitere Literal ist ungefährlich, weil summary unten defensiv gelesen
      // wird — genau für den Fall, dass die Spalte nicht dabei ist.
      .select((includeSummary ? LIST_COLUMNS : NAV_COLUMNS) as typeof LIST_COLUMNS)
      .eq('status', 'published')
      .order('canonical_name')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      console.error('[Glossary] getPublishedTermList:', error.message)
      return []
    }
    if (!data?.length) break
    rows.push(...data.map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      canonicalName: r.canonical_name as string,
      // Leerstring statt undefined, wenn die Spalte nicht geladen wurde: der
      // Rückgabetyp bleibt so derselbe, und kein Aufrufer bekommt versehentlich
      // "undefined" in die Ausgabe.
      summary: (r.summary as string | undefined) ?? '',
    })))
    if (data.length < PAGE_SIZE) break
  }
  const translated = lang === 'de' ? rows : await applyTranslations(rows, lang)
  return translated.map(({ id: _id, ...rest }) => rest)
}

/** Gecacht (s. CACHE_TTL_MS oben) — läuft ungecacht bei jedem Rendern einer
 *  Begriffsseite (Sidebar-Register) sowie der Sitemap und dem Lexikon-Index.
 *  Von Hand statt über withTtlCache: der optionale zweite Parameter mit
 *  Default (`options: {...} = {}`) geht über generische Tupel-Inferenz sonst
 *  als PFLICHT-Argument verloren — jeder Aufrufer ohne zweites Argument bräche. */
const publishedTermListCache = new Map<string, { value: Array<{ slug: string; canonicalName: string; summary: string }>; expiresAt: number }>()
allCacheStores.push(publishedTermListCache as unknown as Map<string, { value: unknown; expiresAt: number }>)

export async function getPublishedTermList(
  lang: string,
  options: { includeSummary?: boolean } = {},
): Promise<Array<{ slug: string; canonicalName: string; summary: string }>> {
  const key = `${lang}:${options.includeSummary ?? true}`
  const hit = publishedTermListCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const value = await getPublishedTermListUncached(lang, options)
  if (value.length > 0) publishedTermListCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

/**
 * Rückgabe `null`, wenn eine der beiden Datenbankabfragen fehlschlägt — die
 * Begriffsliste selbst (`error` unten) genauso wie die Übersetzungsabfrage
 * (`trError` unten). Zu unterscheiden von einem legitimen "für dieses
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
 * zurückzugeben.
 *
 * Abschluss-Review, Befund B: die Begriffslisten-Abfrage selbst gab bei
 * einem Fehler bis hierhin weiterhin `[]` zurück — derselbe Fehlerpfad in
 * derselben Funktion mit einem anderen Signal als der Übersetzungs-Zweig
 * oben, und der WAHRSCHEINLICHERE der beiden: sie ist unbegrenzt (kein
 * `.limit()`) und läuft vor jeder gefilterten Geschwister-Query. Zwei
 * Schreibpfade (confirm.ts, article-jobs/service.ts) hatten sich mit einem
 * `?? []`-Kommentar wörtlich darauf verlassen, dass `getMatcherTerms('de')`
 * "nie null liefert" — richtig für den Übersetzungs-Zweig (der läuft für
 * `de` gar nicht), blind für diesen. Jetzt liefern beide Fehlerpfade `null`.
 * Reine Lesepfade, denen der Unterschied egal ist (detail.ts), degradieren
 * weiterhin mit `?? []`; die beiden Schreibpfade brechen bei `null` ab,
 * statt eine leere Begriffsliste wie ein Ergebnis zu behandeln.
 */
async function getMatcherTermsUncached(lang: string): Promise<GlossaryMatcherTerm[] | null> {
  const supabase = createAdminClient()
  // SEITENWEISE laden. PostgREST kappt eine Abfrage ohne `range()` still bei 1000
  // Zeilen — kein Fehler, kein Log.
  //
  // PROD-BEFUND 2026-08-11: Bei 2504 veröffentlichten Begriffen fehlten dem
  // Matcher 1504, darunter ALLE 60 zuletzt erzeugten. Ein neuer Begriff konnte
  // damit grundsätzlich nicht verlinkt werden: „Voight-Kampff-Test" (10.08.)
  // fehlte im Artikel vom 26.07., obwohl der Nachverlink-Lauf desselben Morgens
  // 218 Artikel angefasst hatte und der Matcher den Namen im Text zweifelsfrei
  // findet. Diese Funktion ist die EINZIGE Quelle der Begriffsliste für
  // Verlinkung und Nachverlinkung — die Kappung wirkte deshalb überall zugleich.
  const PAGE = 1000
  const rows: Array<Record<string, unknown>> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('id, slug, canonical_name, aliases')
      .eq('status', 'published')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[Glossary] getMatcherTerms:', error.message)
      return null
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE) break
  }
  const base = rows.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
  }))
  if (lang === 'de') return base.map(({ id: _id, ...t }) => t)
  if (base.length === 0) return []

  // Für die Verlinkung im übersetzten Artikel zählen die Namen der Zielsprache.
  // Wie bei applyTranslations: term_ids statt nur language filtern, sonst nutzt
  // der Filter den PK (term_id, language) nicht und scannt alle Sprachen —
  // blockweise, s. fetchTranslationsChunked.
  const { rows: tr, error: trError } = await fetchTranslationsChunked(
    supabase,
    'term_id, canonical_name, aliases',
    base.map((t) => t.id),
    lang,
  )
  if (trError) {
    console.error('[Glossary] getMatcherTerms translations:', trError)
    return null
  }
  const byId = new Map(tr.map((t) => [t.term_id as string, t]))
  return base.map((t) => {
    const t9n = byId.get(t.id)
    return {
      slug: t.slug,
      canonicalName: (t9n?.canonical_name as string) ?? t.canonicalName,
      aliases: ((t9n?.aliases ?? t.aliases) ?? []) as string[],
    }
  })
}

/** Gecacht (s. CACHE_TTL_MS oben) — die EINZIGE Quelle der Begriffsliste für
 *  Verlinkung/Nachverlinkung, ungecacht bei jedem Rendern einer Begriffsseite
 *  neu geholt (Befund 2026-08-19, Egress-Explosion). */
export const getMatcherTerms = withTtlCache(
  getMatcherTermsUncached,
  (lang) => lang,
)

/** Chart-Produktnamen für die Kollisions-Reservierung bei der Mark-Injektion
 *  (Task 11) — Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff.
 *  Nur `canonical_name`, keine weiteren Spalten (Egress). Paginiert wie in
 *  lib/rankings/categorize.ts: PostgREST kappt sonst still bei 1000 Zeilen. */
async function getChartProductNamesUncached(): Promise<string[]> {
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

/** Gecacht (s. CACHE_TTL_MS oben) — wird pro Begriff in mehreren Schreibpfaden
 *  (confirm/crawl/backfill/translate) erneut geholt. */
export const getChartProductNames = withTtlCache(
  getChartProductNamesUncached,
  () => 'all',
)

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

export interface GlossarySearchHit {
  slug: string
  canonicalName: string
  excerpt: string
}

/** Spalten für die Suche (app/api/search/route.ts): canonical_name, aliases
 *  und summary sind die drei Felder, über die laut Anforderung gesucht wird —
 *  bewusst NICHT body. body ist ein großes JSONB-Feld, und eine history-JSONB-
 *  Spalte hat in diesem Projekt schon einmal einen 359-GB-Egress-Overage
 *  verursacht. */
const SEARCH_COLUMNS = 'id, slug, canonical_name, aliases, summary'

/** PostgREST kappt eine Abfrage ohne range()/limit() still bei 1000 Zeilen
 *  (siehe getChartProductNames oben). Bei aktuell gut 300 veröffentlichten
 *  Begriffen unkritisch für eine Suche mit limit() — wächst die Begriffszahl
 *  über 1000, braucht diese Funktion Pagination wie getChartProductNames. */
const SEARCH_FETCH_LIMIT = 1000

/** Kurzer Auszug für den Lexikon-Suchblock — reine Zeichen-Kürzung, keine
 *  Wortgrenzen-Suche wie buildSnippet in app/api/search/route.ts: der Treffer
 *  ist eine Vorschau, kein Zitat mit Fundstelle. */
function truncateSummary(summary: string, maxLen: number): string {
  if (summary.length <= maxLen) return summary
  return summary.slice(0, maxLen).trim() + ' …'
}

interface SearchableRow {
  id: string
  slug: string
  canonicalName: string
  aliases: string[]
  summary: string
}

/**
 * Sucht veröffentlichte Begriffe über canonical_name, aliases und summary
 * (Substring, case-insensitive) — für den Lexikon-Block in der Suche.
 *
 * Lädt zunächst ALLE veröffentlichten Begriffe (schmale Spalten, kein body)
 * und filtert danach in Node, weil aliases eine text[]-Spalte ist: ein
 * `.ilike()` von PostgREST greift nicht auf einzelne Array-Elemente. Bei
 * einigen hundert Begriffen ist das unkritisch (gleiches Muster wie die
 * Substring-Suche über Firmennamen weiter unten in der Route).
 */
export async function searchPublishedTerms(
  query: string,
  lang: string,
  limit: number,
): Promise<GlossarySearchHit[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_terms')
    .select(SEARCH_COLUMNS)
    .eq('status', 'published')
    .limit(SEARCH_FETCH_LIMIT)
  if (error) {
    console.error('[Glossary] searchPublishedTerms:', error.message)
    return []
  }
  const base: SearchableRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
    summary: (r.summary as string | null) ?? '',
  }))
  if (base.length === 0) return []

  const resolved = lang === 'de' ? base : await applySearchTranslations(supabase, base, lang)

  const lowerQuery = query.toLowerCase()
  const matches = resolved.filter(
    (t) =>
      t.canonicalName.toLowerCase().includes(lowerQuery) ||
      t.aliases.some((a) => a.toLowerCase().includes(lowerQuery)) ||
      t.summary.toLowerCase().includes(lowerQuery),
  )

  // Exakte Präfix-Treffer im Namen zuerst — gleiche Regel wie bei Companies/
  // Produkten in app/api/search/route.ts.
  matches.sort((a, b) => {
    const aPrefix = a.canonicalName.toLowerCase().startsWith(lowerQuery) ? 0 : 1
    const bPrefix = b.canonicalName.toLowerCase().startsWith(lowerQuery) ? 0 : 1
    if (aPrefix !== bPrefix) return aPrefix - bPrefix
    return a.canonicalName.localeCompare(b.canonicalName)
  })

  return matches.slice(0, limit).map((t) => ({
    slug: t.slug,
    canonicalName: t.canonicalName,
    excerpt: truncateSummary(t.summary, 160),
  }))
}

/**
 * Übersetzungs-Overlay für die Suche: canonical_name, aliases UND summary
 * zugleich. Eigenständig statt Wiederverwendung von applyTranslations
 * (unten) oder der Inline-Logik in getMatcherTerms — beide decken je nur
 * zwei der drei Felder ab, und sie zu verbreitern hieße, ihre getesteten
 * Typen für einen Aufrufer aufzuweiten, der den dritten Wert gar nicht
 * braucht.
 *
 * term_ids statt nur language filtern: der Primary Key ist
 * (term_id, language), ein language-only-Filter nutzt dessen Präfix nicht.
 */
async function applySearchTranslations(
  supabase: ReturnType<typeof createAdminClient>,
  rows: SearchableRow[],
  lang: string,
): Promise<SearchableRow[]> {
  const { rows: data, error } = await fetchTranslationsChunked(
    supabase,
    'term_id, canonical_name, aliases, summary',
    rows.map((r) => r.id),
    lang,
  )
  if (error) {
    console.error('[Glossary] searchPublishedTerms translations:', error)
    return rows
  }
  const byId = new Map((data ?? []).map((t) => [t.term_id as string, t]))
  return rows.map((r) => {
    const t9n = byId.get(r.id)
    if (!t9n) return r
    return {
      ...r,
      canonicalName: (t9n.canonical_name as string | null) ?? r.canonicalName,
      aliases: (t9n.aliases as string[] | null) ?? r.aliases,
      summary: (t9n.summary as string | null) ?? r.summary,
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
  const { rows: data, error } = await fetchTranslationsChunked(
    supabase,
    'term_id, canonical_name, summary',
    rows.map((r) => r.id),
    lang,
  )
  if (error) {
    // Fehlende Übersetzungen sind kein Grund, die Seite leer zu rendern.
    console.error('[Glossary] applyTranslations:', error)
    return rows
  }
  const byId = new Map(
    data.map((t) => [
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
