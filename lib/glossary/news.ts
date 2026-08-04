/**
 * News-Block des Fachbegriff-Lexikons (Task 14, Design-Spec §F): findet pro
 * veröffentlichtem Begriff aktuelle daily_repo-Artikel per pgvector-RPC
 * (match_glossary_news) und schreibt sie nach glossary_term_news. Die Seite
 * (lib/glossary/detail.ts, Task 6) liest ausschließlich diese Tabelle — kein
 * Vektor-Zugriff im Renderpfad.
 *
 * `refreshGlossaryNews` bekommt den Supabase-Client als Parameter (Muster aus
 * lib/glossary/confirm.ts), damit Tests einen handgebauten Fake-Client
 * übergeben können, ohne createAdminClient() zu mocken.
 *
 * Resumable ohne eigene Job-Queue: Begriffe werden nach `news_refreshed_at`
 * sortiert abgearbeitet (am längsten nicht aktualisiert zuerst, NULL zuerst),
 * begrenzt durch ein Zeitbudget pro Lauf (budgetMs). Wächst die Begriffsliste
 * über das, was in 300s passt, holt der nächste wöchentliche Lauf einfach die
 * ältesten Reste nach — kein separates Fortschritts-Tracking nötig.
 *
 * Fehlt die RPC (Migration noch nicht angewendet), bricht der Lauf ab, OHNE
 * `news_refreshed_at` zu setzen: der nächste Lauf versucht es für alle
 * Begriffe erneut, statt sie fälschlich als "erledigt" zu markieren.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embeddings/generator'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

/**
 * Zeitfenster für die Artikelsuche.
 *
 * Die Design-Spec §F nannte 90 Tage — sinnvoll, solange die Quelle FREMDE News
 * waren (bei denen täglich neue nachkommen). Seit der Umstellung auf eigene
 * Artikel (2026-08-04) ist die Grundmenge viel kleiner: 219 veröffentlichte
 * Posts insgesamt. Gegen Prod gemessen lagen die passenden Artikel für
 * `token`, `mixture-of-experts`, `cuda` und `halluzination` bei 95-180 Tagen
 * Alter, mit guter Ähnlichkeit (0.58-0.65) — 9 von 15 Begriffen hatten dadurch
 * einen leeren Block, obwohl es inhaltlich passende Artikel gibt.
 *
 * Ein halbes Jahr alter, thematisch treffender eigener Artikel ist besser als
 * kein Verweis. Die Anzeige sortiert ohnehin nach published_at absteigend, die
 * frischesten stehen also weiter oben.
 */
const NEWS_WINDOW_DAYS = 365
/** Maximal 5 News pro Begriff (Design-Spec §F). Wird der RPC als Parameter
 *  mitgegeben UND hier defensiv nochmal durchgesetzt — falls die Migration
 *  nur teilweise angewendet wurde und eine ältere Fassung der Funktion ohne
 *  Limit greift. */
const MATCH_LIMIT = 5

/**
 * Mindest-Ähnlichkeit für einen eigenen Artikel. Höher als die Suchschwelle
 * (0.35): im News-Block soll ein Artikel nur erscheinen, wenn er erkennbar vom
 * Thema des Begriffs handelt — sonst liest er sich wie eine erzwungene
 * Verlinkung. Dieselbe Begründung wie DEFAULT_THRESHOLD in
 * lib/posts/historical-retrieval.ts, dort 0.45 für Artikel-Rückverweise.
 * Gegen Prod gemessen: das Embedding von "Inferenz" trifft passende Artikel
 * zwischen 0.62 und 0.66.
 */
const POST_MATCH_THRESHOLD = 0.5

/** Sprachsegment im gespeicherten Pfad; die Komponente tauscht es beim Rendern. */
const DEFAULT_LOCALE = 'de'
/** Obergrenze pro Cron-Lauf für die Begriffsliste selbst — verhindert nur eine
 *  unbegrenzte PostgREST-Antwort, falls das Glossar stark wächst. Das
 *  eigentliche Limit ist das Zeitbudget unten. */
const TERM_BATCH_LIMIT = 500
/** Vercel-Cap ist 300s (maxDuration in der Route) — 30s Puffer für die
 *  Response selbst und den letzten laufenden Begriff. */
const DEFAULT_BUDGET_MS = 270_000

/** Fehlercodes, die bedeuten "die Funktion existiert nicht" (Migration noch
 *  nicht angewendet) — NICHT "dieser eine Aufruf ist fehlgeschlagen".
 *  `42883` ist Postgres' undefined_function, `PGRST202` PostgRESTs "could not
 *  find the function in the schema cache". Nur bei diesen beiden Codes ist
 *  ein Abbruch der GESAMTEN Schleife richtig, weil jeder folgende Begriff
 *  garantiert denselben Fehler produzieren würde. Jeder andere Code (Timeout,
 *  abgebrochene Verbindung, …) betrifft nur den aktuellen Begriff und darf
 *  die übrigen nicht blockieren (Review-Fix: ein `break` auf jeden RPC-Fehler
 *  hätte einen einzelnen dauerhaft problematischen Begriff den News-Refresh
 *  für alle anderen Begriffe unbegrenzt lahmlegen lassen — er wäre wegen des
 *  unveränderten `news_refreshed_at` bei jedem Lauf wieder ganz vorn
 *  gestanden und hätte denselben Abbruch erneut ausgelöst). */
const RPC_MISSING_CODES = new Set(['42883', 'PGRST202'])

interface GlossaryNewsTermRow {
  id: string
  canonical_name: string
  summary: string
  embedding: unknown
}

/** Rückgabeform von match_generated_posts (s. lib/posts/historical-retrieval.ts).
 *  `content` liefert die RPC ebenfalls mit, wird hier aber nicht gelesen. */
interface GlossaryPostMatch {
  id: string
  title: string
  slug: string
  excerpt: string | null
  created_at: string | null
  similarity: number
}

export interface GlossaryNewsRefreshResult {
  /** Wie viele Begriffe insgesamt zur Bearbeitung geladen wurden (Batch-Größe). */
  termsChecked: number
  /** Wie viele davon in diesem Lauf tatsächlich abgeschlossen wurden. */
  termsRefreshed: number
  /** Summe geschriebener glossary_term_news-Zeilen über alle Begriffe. */
  newsRowsWritten: number
  /** true, wenn die RPC (noch) nicht existiert — der Lauf endet dann früh. */
  rpcMissing: boolean
}

/**
 * Sieht dieser daily_repo-Titel wie eine Schlagzeile aus?
 *
 * An der ersten vollständigen Prod-Seite aufgefallen: /de/glossary/inferenz
 * führte unter "Aktuelle News" die Titel "cut inference costs",
 * "@steph_palazzolo", "SpaceX S-1" und "only 15-20%". Das sind Fragmente aus der
 * Link-Extraktion von Newsletter-Quellen (beehiiv, substack), die in daily_repo
 * als source_type='article' liegen — der source_type-Filter der RPC greift dort
 * also nicht, und die Embedding-Ähnlichkeit war mit 0.67-0.69 sogar hoch, weil
 * die Fragmente thematisch durchaus passen.
 *
 * Bewusst grob und konservativ: die drei Kriterien (Länge, Wortzahl, kein
 * Handle/Hashtag am Anfang) verwerfen im Zweifel. Ein leerer News-Block ist auf
 * einer öffentlichen Lexikonseite besser als ein Twitter-Handle als Überschrift.
 * Der wöchentliche Cron löscht und schreibt die Zeilen pro Begriff neu, der
 * Bestand heilt sich also beim nächsten Lauf von selbst.
 */
export function looksLikeHeadline(title: string): boolean {
  const t = (title ?? '').trim()
  if (t.length < 25) return false          // Fragmente sind kurz
  if (/^[@#]/.test(t)) return false        // Handles und Hashtag-Ketten
  if (t.split(/\s+/).length < 4) return false // "SpaceX S-1", "only 15-20%"
  return true
}

/** Postgres liefert eine vector-Spalte über PostgREST als Bracket-Notation-
 *  String ("[0.01,-0.02,...]"). Ein reines Array kommt praktisch nie vor, wird
 *  hier aber trotzdem akzeptiert (gleiches defensives Muster wie
 *  app/api/cron/extract-patterns/route.ts:parseEmbedding). */
function parseStoredEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[]
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const nums = value.replace(/[[\]]/g, '').split(',').map(Number)
  if (nums.length === 0 || nums.some((n) => Number.isNaN(n))) return null
  return nums
}

/** Quelle für die Anzeige aus source_url ableiten (gleiches Muster wie
 *  lib/news-queue/service.ts:169 und lib/analysis/processor.ts:143) — es gibt
 *  keine source_name-Spalte in daily_repo. */
export function deriveSourceName(sourceUrl: string): string | null {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const CONTEXT_TOOL = {
  name: 'write_context_sentences',
  description:
    'Für jeden News-Titel genau einen Einordnungssatz schreiben, der erklärt, warum der Artikel zum Begriff passt — ohne den Titel wörtlich zu zitieren.',
  input_schema: {
    type: 'object' as const,
    properties: {
      sentences: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ein Satz pro Eingabetitel, in derselben Reihenfolge.',
      },
    },
    required: ['sentences'],
  },
}

function buildContextPrompt(canonicalName: string, summary: string, titles: string[]): string {
  const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `Begriff: ${canonicalName}
Kurzerklärung: ${summary}

Aktuelle Artikel-Titel (nur Titel, kein Volltext verfügbar):
${list}

Schreibe für JEDEN Titel genau einen Satz (max. 20 Wörter): warum passt der Artikel zu "${canonicalName}"? Frei formulieren, den Titel nicht wörtlich wiederholen.`
}

/**
 * Einordnungssätze für die Titel eines Begriffs — ein LLM-Call pro Begriff
 * statt pro Artikel (spart Calls bei bis zu 5 Treffern). Liefert bei
 * fehlendem API-Key, ungültiger Antwort oder Fehler `null` pro Titel statt zu
 * werfen: ein fehlender Einordnungssatz darf glossary_term_news nie leer
 * lassen (Titel/Quelle/Datum/Link bleiben trotzdem erhalten, s.
 * components/glossary/term-news.tsx).
 */
async function generateContextSentences(
  canonicalName: string,
  summary: string,
  titles: string[],
): Promise<Array<string | null>> {
  if (titles.length === 0) return []
  if (!process.env.ANTHROPIC_API_KEY) return titles.map(() => null)
  try {
    const { z } = await import('zod')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('glossary_news_context')
    const resp = await client.messages.create({
      model, max_tokens: 1024, tools: [CONTEXT_TOOL],
      tool_choice: { type: 'tool', name: CONTEXT_TOOL.name },
      messages: [{ role: 'user', content: buildContextPrompt(canonicalName, summary, titles) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const schema = z.object({ sentences: z.array(z.string()) })
    const parsed = schema.safeParse(block && 'input' in block ? block.input : null)
    if (!parsed.success) return titles.map(() => null)
    return titles.map((_, i) => parsed.data.sentences[i]?.trim() || null)
  } catch (e) {
    console.error('[GlossaryNews] Einordnungssätze fehlgeschlagen:', e instanceof Error ? e.message : e)
    return titles.map(() => null)
  }
}

/** Embedding sicherstellen: existiert eins, wird es wiederverwendet (die
 *  Abfrage bettet nicht bei jedem Lauf neu ein, Design-Spec §F). Fehlt es,
 *  wird es aus canonical_name + summary erzeugt und persistiert. */
async function ensureTermEmbedding(
  supabase: SupabaseAdminClient,
  term: GlossaryNewsTermRow,
): Promise<number[] | null> {
  const existing = parseStoredEmbedding(term.embedding)
  if (existing) return existing
  try {
    const vec = await generateEmbedding(`${term.canonical_name}\n\n${term.summary}`)
    if (vec.length === 0) return null
    const { error } = await supabase
      .from('glossary_terms')
      .update({ embedding: `[${vec.join(',')}]` })
      .eq('id', term.id)
    if (error) {
      console.error('[GlossaryNews] Embedding-Update fehlgeschlagen für', term.id, error.message)
      return null
    }
    return vec
  } catch (e) {
    console.error('[GlossaryNews] Embedding-Erzeugung fehlgeschlagen für', term.id, e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Aktualisiert glossary_term_news für die am längsten nicht aktualisierten
 * veröffentlichten Begriffe, innerhalb eines Zeitbudgets. Gibt niemals einen
 * Fehler nach außen — ein einzelner Begriff, der scheitert, wird geloggt und
 * übersprungen, der Rest läuft weiter.
 */
export async function refreshGlossaryNews(
  supabase: SupabaseAdminClient,
  options: { budgetMs?: number } = {},
): Promise<GlossaryNewsRefreshResult> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const startedAt = Date.now()

  const { data: terms, error: termsError } = await supabase
    .from('glossary_terms')
    .select('id, canonical_name, summary, embedding')
    .eq('status', 'published')
    .order('news_refreshed_at', { ascending: true, nullsFirst: true })
    .limit(TERM_BATCH_LIMIT)

  if (termsError) {
    console.error('[GlossaryNews] Begriffsliste konnte nicht geladen werden:', termsError.message)
    return { termsChecked: 0, termsRefreshed: 0, newsRowsWritten: 0, rpcMissing: false }
  }
  const termRows = (terms ?? []) as GlossaryNewsTermRow[]
  if (termRows.length === 0) {
    return { termsChecked: 0, termsRefreshed: 0, newsRowsWritten: 0, rpcMissing: false }
  }

  const since = new Date(Date.now() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let termsRefreshed = 0
  let newsRowsWritten = 0
  let rpcMissing = false

  for (const term of termRows) {
    // Rest folgt im nächsten Lauf — news_refreshed_at sortiert die ältesten
    // Begriffe automatisch wieder ganz nach vorn.
    if (Date.now() - startedAt > budgetMs) break

    try {
      const vec = await ensureTermEmbedding(supabase, term)
      if (!vec) continue // Embedding-Erzeugung fehlgeschlagen — nächster Lauf versucht es erneut

      // EIGENE Artikel statt externer Quellen (2026-08-04): match_generated_posts
      // existiert schon (lib/posts/historical-retrieval.ts, app/api/search) und
      // arbeitet auf generated_posts.content_embedding — es braucht also keine
      // eigene RPC. Ein Lexikonbegriff soll in die eigene Berichterstattung
      // führen, nicht auf fremde Seiten; nebenbei erledigt das die
      // Fragment-Titel aus der Newsletter-Link-Extraktion.
      const { data: matches, error: rpcError } = await supabase.rpc('match_generated_posts', {
        query_embedding: vec as unknown as string,
        match_threshold: POST_MATCH_THRESHOLD,
        match_count: MATCH_LIMIT,
      })

      if (rpcError) {
        if (RPC_MISSING_CODES.has(rpcError.code)) {
          // Existiert wirklich nicht (Migration nicht angewendet) — Abbruch
          // der GESAMTEN Schleife statt denselben Fehler für jeden weiteren
          // Begriff zu loggen. news_refreshed_at bleibt für ALLE Begriffe
          // unangetastet.
          console.error('[GlossaryNews] RPC match_generated_posts existiert nicht:', rpcError.message)
          rpcMissing = true
          break
        }
        // Nur DIESER Aufruf ist fehlgeschlagen (Timeout, Verbindungsabbruch, …)
        // — wie beim Embedding-Fehler oben: nur der aktuelle Begriff wird
        // übersprungen, die übrigen laufen weiter.
        console.error('[GlossaryNews] RPC match_generated_posts fehlgeschlagen für', term.id, rpcError.message)
        continue
      }

      // `since` gilt weiter, aber im Code: match_generated_posts kennt keinen
      // Zeitfilter. Ein Lexikonbegriff soll auf aktuelle Berichterstattung
      // zeigen, nicht auf einen zwei Jahre alten Artikel.
      //
      // Der Titel-Filter bleibt: eigene Schlagzeilen sind zwar redaktionell,
      // aber die Auto-Posts tragen bis zur Freigabe generische Platzhalter
      // ("cron 0707") — die gehören nicht auf eine öffentliche Seite.
      const rows = ((matches ?? []) as GlossaryPostMatch[])
        .filter((r) => !since || !r.created_at || r.created_at >= since)
        .filter((r) => looksLikeHeadline(r.title))
        .slice(0, MATCH_LIMIT)
      const contextSentences = await generateContextSentences(
        term.canonical_name, term.summary, rows.map((r) => r.title),
      )

      // Löschen/Einfügen/Markieren gelten nur gemeinsam als Erfolg — schlägt
      // einer der drei Schritte fehl, wird der Begriff NICHT als aktualisiert
      // gezählt und news_refreshed_at bleibt unangetastet: der nächste Lauf
      // versucht ihn erneut, statt einen tatsächlich fehlgeschlagenen
      // Schreibvorgang als Erfolg zu melden (Review-Fix: termsRefreshed++
      // lief vorher unabhängig vom Fehler, die Statistik hat also gelogen).
      const { error: deleteError } = await supabase
        .from('glossary_term_news')
        .delete()
        .eq('term_id', term.id)
      if (deleteError) {
        console.error('[GlossaryNews] Alte News-Zeilen konnten nicht gelöscht werden für', term.id, deleteError.message)
        continue
      }

      if (rows.length > 0) {
        const insertRows = rows.map((r, i) => ({
          term_id: term.id,
          post_id: r.id,
          title: r.title,
          // source_name bleibt leer: bei eigenen Artikeln wäre "synthszr.com"
          // neben jedem Eintrag reine Redundanz. Die Komponente rendert das Feld
          // nur, wenn es gesetzt ist.
          source_name: null,
          // Interner Pfad statt externer URL. Sprachneutral gespeichert wäre
          // hier nicht möglich (middleware.ts antwortet auf /posts/<slug> mit
          // 307 je Cookie/Geo, s. Task-3-Vorabfix), deshalb der DEFAULT_LOCALE-
          // Pfad — die Komponente ersetzt das Sprachsegment beim Rendern.
          source_url: `/${DEFAULT_LOCALE}/posts/${r.slug}`,
          published_at: r.created_at,
          context_sentence: contextSentences[i] ?? null,
          similarity: r.similarity,
        }))
        const { error: insertError } = await supabase.from('glossary_term_news').insert(insertRows)
        if (insertError) {
          console.error('[GlossaryNews] Insert fehlgeschlagen für', term.id, insertError.message)
          continue
        }
        newsRowsWritten += insertRows.length
      }

      const { error: markError } = await supabase
        .from('glossary_terms')
        .update({ news_refreshed_at: new Date().toISOString() })
        .eq('id', term.id)
      if (markError) {
        console.error('[GlossaryNews] news_refreshed_at konnte nicht gesetzt werden für', term.id, markError.message)
        continue
      }
      termsRefreshed++
    } catch (e) {
      console.error('[GlossaryNews] Begriff übersprungen:', term.id, e instanceof Error ? e.message : e)
    }
  }

  return { termsChecked: termRows.length, termsRefreshed, newsRowsWritten, rpcMissing }
}
