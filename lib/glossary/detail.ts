import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatcherTermsShared } from '@/lib/glossary/terms'
import { findGlossaryMentions } from '@/lib/glossary/mentions'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import { injectStockLinks } from '@/lib/glossary/inject-stock-links'
import { extractVisibleText } from '@/lib/posts/product-mentions'
import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'
import type { GlossaryStatus, GlossaryTerm, GlossaryAnimationParams } from '@/lib/glossary/types'

/** Obergrenze für die beiden verbleibenden arrondierenden Blöcke (Produkte,
 *  News) — die Begriffsverlinkung selbst nutzt GLOSSARY_MAX_PER_ARTICLE, weil
 *  sie mit den im Text injizierten Marks konsistent bleiben muss. */
const MAX_PRODUCTS = 10
const MAX_NEWS_ITEMS = 10

export interface GlossaryRelatedTerm {
  slug: string
  canonicalName: string
}

export interface GlossaryTermProduct {
  slug: string
  canonicalName: string
  relevance: number
}

export interface GlossaryTermNews {
  title: string
  sourceName: string | null
  sourceUrl: string
  publishedAt: string | null
  contextSentence: string | null
}

export type GlossaryTermDetail = GlossaryTerm & {
  /** Letzte Änderung, für dateModified in den strukturierten Daten. Kommt aus
   *  der Basiszeile, NICHT aus der Übersetzung: gemeint ist die Aktualität des
   *  Begriffs, nicht die des Übersetzungslaufs. */
  updatedAt: string | null
  relatedTerms: GlossaryRelatedTerm[]
  products: GlossaryTermProduct[]
  news: GlossaryTermNews[]
}

/** cache() verhindert, dass generateMetadata und die Page dieselbe Query
 *  zweimal absetzen — das verdoppelt sonst den Egress pro Seitenaufruf (vgl.
 *  app/[lang]/rankings/[slug]/page.tsx, das genau das noch nicht tut).
 *
 *  Die Memoisierung ist nicht unit-testbar, und das ist keine Lücke: cache()
 *  memoisiert nur innerhalb eines aktiven RSC-Renders. Außerhalb — also in
 *  jedem Vitest-Lauf mit environment: 'node' — ist der Dispatcher ein No-Op,
 *  jeder Aufruf führt frisch aus (empirisch geprüft, React 19.2.0). Ein Test
 *  "zweiter Aufruf trifft die DB nicht erneut" würde deshalb am korrekten Code
 *  vorbei fehlschlagen. Diese Zeile ist trotzdem kein unnötiger Wrapper — sie
 *  wirkt beim echten Request, nur eben nicht in diesem Testaufbau. */
export const getGlossaryTerm = cache(
  async (slug: string, lang: string): Promise<GlossaryTermDetail | null> => {
    const supabase = createAdminClient()

    const { data: row, error } = await supabase
      .from('glossary_terms')
      .select('id, slug, canonical_name, aliases, status, summary, body, illustration_url, illustration_alt, animation_params, updated_at')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle()
    // Ein Datenbankfehler ist NICHT "der Begriff existiert nicht". Gaeben wir
    // hier null zurueck, ruft die Seite notFound() — und Next.js friert diesen
    // 404 fuer revalidate=21600 (6 Stunden) im Cache ein. Am 28.08.2026 legte
    // ein Supabase-Ausfall von wenigen Minuten so 24 von 40 geprueften
    // Glossar-Links lahm, obwohl jeder Begriff published war: Ein Crawler lief
    // waehrend des Ausfalls ueber die Seiten und schrieb die 404er in den Cache.
    // Ein geworfener Fehler ergibt einen 500. Der wird nicht gecacht und heilt
    // von selbst, sobald die DB wieder antwortet — genauso haelt es
    // lib/rankings/product-detail.ts, dessen Seiten den Ausfall unbeschadet
    // ueberstanden haben.
    if (error) {
      console.error('[Glossary] getGlossaryTerm:', error.message)
      throw new Error(`glossary term "${slug}": ${error.message}`)
    }
    if (!row) return null

    let term: GlossaryTerm = {
      id: row.id as string,
      slug: row.slug as string,
      canonicalName: row.canonical_name as string,
      aliases: (row.aliases ?? []) as string[],
      status: row.status as GlossaryStatus,
      summary: row.summary as string,
      body: row.body,
      illustrationUrl: row.illustration_url as string | null,
      illustrationAlt: row.illustration_alt as string | null,
      animationParams: row.animation_params as GlossaryAnimationParams | null,
    }

    if (lang !== 'de') {
      term = await applyTermTranslation(supabase, term, lang)
    }

    const [{ body, relatedTerms }, products, news] = await Promise.all([
      linkRelatedTerms(term, lang),
      getTermProducts(term.id),
      getTermNews(term.id),
    ])

    return { ...term, body, updatedAt: (row.updated_at as string | null) ?? null, relatedTerms, products, news }
  },
)

/** Einzelzeile über den vollen Primary Key (term_id, language) — kein
 *  Seq-Scan-Risiko, anders als ein reiner language-Filter über viele Zeilen. */
async function applyTermTranslation(
  supabase: ReturnType<typeof createAdminClient>,
  term: GlossaryTerm,
  lang: string,
): Promise<GlossaryTerm> {
  const { data: t9n, error } = await supabase
    .from('glossary_term_translations')
    .select('canonical_name, aliases, summary, body')
    .eq('term_id', term.id)
    .eq('language', lang)
    .maybeSingle()
  if (error) {
    console.error('[Glossary] getGlossaryTerm translation:', error.message)
    return term
  }
  if (!t9n) return term
  return {
    ...term,
    canonicalName: (t9n.canonical_name as string | null) ?? term.canonicalName,
    aliases: (t9n.aliases as string[] | null) ?? term.aliases,
    summary: (t9n.summary as string | null) ?? term.summary,
    body: t9n.body ?? term.body,
  }
}

/**
 * Verlinkt Begriffe, die dieser Begriff in seinem eigenen Erklärungstext
 * erwähnt — kein eigenes Relations-Schema (es gibt keine
 * `glossary_term_related`-Tabelle, und kein Task legt eine an), sondern
 * Wiederverwendung des Matchers aus Task 2 auf `body` statt auf einen Artikel.
 *
 * Die eigentliche Anforderung ist die Verlinkung IM Text, nicht nur ein Block
 * darunter — deshalb werden die Marks hier injiziert (injectGlossaryMarks aus
 * Task 3) und der veränderte Body zurückgegeben. Das passiert bewusst im
 * Loader und nicht beim Generieren (Task 8): ein neu angelegter Begriff
 * erscheint dadurch rückwirkend in allen älteren Erklärtexten, die ihn
 * erwähnen, ohne dass deren `body` neu geschrieben werden müsste.
 *
 * `relatedTerms` wird aus derselben Kandidaten-/Treffer-Menge abgeleitet und
 * mit GLOSSARY_MAX_PER_ARTICLE gekappt — demselben Limit, das
 * injectGlossaryMarks intern anwendet. Beide Ausgaben zeigen so garantiert
 * dieselben Begriffe.
 */
/**
 * Ab dieser Cosine-Ähnlichkeit gilt ein Begriff als semantisch verwandt.
 *
 * 0.6 ist an den echten Daten gewählt, nicht geraten: über die fünf
 * veröffentlichten Begriffe lagen ALLE zehn Paare zwischen 0.4882 und 0.6723,
 * und 0.6 trennt dort das thematisch enge Paar (inferenz/mixture-of-experts,
 * 0.6723) von den übrigen. Die Spreizung ist eng, die Schwelle also vorläufig —
 * sie sollte nach der ersten größeren Freigabewelle neu gemessen werden, weil
 * eine Kalibrierung auf zehn Datenpunkte nichts über den Regelfall sagt.
 */
const RELATED_SIMILARITY_THRESHOLD = 0.6

/**
 * Semantisch verwandte Begriffe über match_glossary_related_terms.
 *
 * Die Ähnlichkeit rechnet Postgres, nicht dieser Prozess: die Embeddings aller
 * veröffentlichten Begriffe pro Seiten-Render zu laden wären bei 100 Begriffen
 * ~300 KB, und das Projekt liegt beim Egress schon in der Overage. Die RPC holt
 * das Quell-Embedding selbst über den Slug, der Vektor verlässt die DB also gar
 * nicht.
 *
 * Degradiert auf [] statt zu werfen: solange die Migration nicht angewendet ist,
 * antwortet Postgres mit "function does not exist" — die Detailseite muss dann
 * trotzdem laden, nur eben ohne die zweite Quelle.
 */
async function fetchSemanticNeighbours(slug: string): Promise<GlossaryRelatedTerm[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('match_glossary_related_terms', {
    source_slug: slug,
    match_threshold: RELATED_SIMILARITY_THRESHOLD,
    match_count: GLOSSARY_MAX_PER_ARTICLE,
  })
  if (error) {
    console.error(`[Glossary] Verwandte Begriffe für "${slug}" nicht ladbar:`, error.message)
    return []
  }
  return ((data ?? []) as Array<{ slug: string; canonical_name: string }>).map((r) => ({
    slug: r.slug,
    canonicalName: r.canonical_name,
  }))
}

async function linkRelatedTerms(
  term: GlossaryTerm,
  lang: string,
): Promise<{ body: unknown; relatedTerms: GlossaryRelatedTerm[] }> {
  // getMatcherTerms gibt null zurück, wenn die Übersetzungsabfrage
  // fehlgeschlagen ist (terms.ts) — Lesepfad, deshalb Fehler geloggt (bereits
  // in getMatcherTerms selbst) und auf leere Kandidatenliste degradiert,
  // statt die Detailseite abstürzen zu lassen.
  const candidates = ((await getMatcherTermsShared(lang)) ?? []).filter((t) => t.slug !== term.slug)
  const text = extractVisibleText(term.body)
  const mentions = candidates.length > 0 && text ? findGlossaryMentions(text, candidates) : []
  const slugs = mentions.map((m) => m.slug)
  // Die Mark-Injektion bekommt AUSSCHLIESSLICH die Text-Treffer. Ein semantischer
  // Nachbar kommt im Erklärtext nicht vor — ihn zu verlinken wäre eine Verlinkung
  // auf einem Wort, das der Leser nie gelesen hat. Der Block darf mehr zeigen als
  // der Text verlinkt (bei Task 5 bereits als zulässig festgehalten), aber nicht
  // umgekehrt.
  // Zwei Injektionen, in dieser Reihenfolge: erst Lexikonbegriffe, dann
  // Firmennamen auf ihre Stocks-Seite. Sie können sich nicht überschreiben —
  // injectStockLinks überspringt Text, der schon eine Mark trägt, und
  // injectGlossaryMarks hat Company-Namen ohnehin auf seiner reserved-Liste
  // (Kollisionsregel des Projekts: Company > Chart-Produkt > Lexikonbegriff).
  //
  // Serverseitig, weil diese Seite ihren Text über renderStaticArticleHtml
  // rendert: die DOM-Prozessoren, die Firmennamen in ARTIKELN verlinken, laufen
  // client-seitig und kommen hier nie zum Zug.
  // lang mitgeben: auf /en/glossary/* ist der Text englisch, dort darf die
  // deutsche Kompositum-Regel nicht greifen (s. matchNameInText).
  const withGlossary = injectGlossaryMarks(term.body, slugs, candidates, { lang })
  const body = injectStockLinks(withGlossary, lang)

  const fromText = candidates
    .filter((t) => slugs.includes(t.slug))
    .map((t) => ({ slug: t.slug, canonicalName: t.canonicalName }))

  // Text-Treffer zuerst: sie sind im Fließtext belegt und damit die stärkere
  // Aussage. Semantische Nachbarn füllen auf, was das Text-Matching nicht findet
  // — bei einem jungen Lexikon ist das der Normalfall (gemessen: 1 von 5
  // veröffentlichten Begriffen hatte überhaupt einen Text-Treffer).
  const seen = new Set<string>([term.slug, ...fromText.map((t) => t.slug)])
  const merged = [...fromText]
  for (const neighbour of await fetchSemanticNeighbours(term.slug)) {
    if (seen.has(neighbour.slug)) continue
    seen.add(neighbour.slug)
    merged.push(neighbour)
  }

  return { body, relatedTerms: merged.slice(0, GLOSSARY_MAX_PER_ARTICLE) }
}

/** Supabase typisiert einen Fremdschlüssel-Join je nach FK-Erkennung als
 *  Objekt ODER Array — gleiches Muster wie lib/rankings/product-detail.ts. */
function joinedProduct(p: unknown): { slug: string; canonical_name: string } | null {
  if (!p) return null
  return (Array.isArray(p) ? p[0] : p) as { slug: string; canonical_name: string } | undefined ?? null
}

async function getTermProducts(termId: string): Promise<GlossaryTermProduct[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_term_products')
    .select('relevance, product:products(slug, canonical_name)')
    .eq('term_id', termId)
    .eq('products.visibility_status', 'visible')
    .order('relevance', { ascending: false })
    .limit(MAX_PRODUCTS)
  if (error) {
    console.error('[Glossary] getTermProducts:', error.message)
    return []
  }
  return (data ?? [])
    .map((r) => {
      const product = joinedProduct((r as { product: unknown }).product)
      if (!product) return null
      return {
        slug: product.slug,
        canonicalName: product.canonical_name,
        relevance: (r as { relevance: number }).relevance,
      }
    })
    .filter((p): p is GlossaryTermProduct => p !== null)
}

async function getTermNews(termId: string): Promise<GlossaryTermNews[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_term_news')
    .select('title, source_name, source_url, published_at, context_sentence')
    .eq('term_id', termId)
    .order('published_at', { ascending: false })
    .limit(MAX_NEWS_ITEMS)
  if (error) {
    console.error('[Glossary] getTermNews:', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    title: r.title as string,
    sourceName: r.source_name as string | null,
    sourceUrl: r.source_url as string,
    publishedAt: r.published_at as string | null,
    contextSentence: r.context_sentence as string | null,
  }))
}
