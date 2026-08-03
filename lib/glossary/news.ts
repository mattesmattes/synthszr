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

/** Zeitfenster für die RPC (Design-Spec §F): 90 Tage. */
const NEWS_WINDOW_DAYS = 90
/** Maximal 5 News pro Begriff (Design-Spec §F). Wird der RPC als Parameter
 *  mitgegeben UND hier defensiv nochmal durchgesetzt — falls die Migration
 *  nur teilweise angewendet wurde und eine ältere Fassung der Funktion ohne
 *  Limit greift. */
const MATCH_LIMIT = 5
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

interface GlossaryNewsMatch {
  id: string
  title: string
  source_url: string
  published_at: string | null
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

      const { data: matches, error: rpcError } = await supabase.rpc('match_glossary_news', {
        query_embedding: vec as unknown as string,
        since,
        match_limit: MATCH_LIMIT,
      })

      if (rpcError) {
        if (RPC_MISSING_CODES.has(rpcError.code)) {
          // Existiert wirklich nicht (Migration nicht angewendet) — Abbruch
          // der GESAMTEN Schleife statt denselben Fehler für jeden weiteren
          // Begriff zu loggen. news_refreshed_at bleibt für ALLE Begriffe
          // unangetastet.
          console.error('[GlossaryNews] RPC match_glossary_news existiert nicht (Migration nicht angewendet?):', rpcError.message)
          rpcMissing = true
          break
        }
        // Nur DIESER Aufruf ist fehlgeschlagen (Timeout, Verbindungsabbruch, …)
        // — wie beim Embedding-Fehler oben: nur der aktuelle Begriff wird
        // übersprungen, die übrigen laufen weiter.
        console.error('[GlossaryNews] RPC match_glossary_news fehlgeschlagen für', term.id, rpcError.message)
        continue
      }

      const rows = ((matches ?? []) as GlossaryNewsMatch[]).slice(0, MATCH_LIMIT)
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
          repo_item_id: r.id,
          title: r.title,
          source_name: deriveSourceName(r.source_url),
          source_url: r.source_url,
          published_at: r.published_at,
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
