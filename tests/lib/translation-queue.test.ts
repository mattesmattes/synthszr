/**
 * lib/i18n/translation-queue.ts — processTranslationQueue/processGeneratedPost
 * (Task 16): übersetzte generated_posts müssen Glossar-Marks neu injiziert
 * bekommen (reinjectGlossaryMarksForTranslation, lib/glossary/translate.ts),
 * mit der Begriffsliste der Zielsprache statt der aus der Quelle kopierten
 * Marks. processStaticPage bleibt bewusst unverändert (Files-Tabelle:
 * statische Seiten sind nicht Teil des Lexikonsystems).
 *
 * "Kurzer Inhalt": translateContent ist hier gemockt (einfache Antwort ohne
 * Chunking). Der gechunkte Pfad (translateContent kehrt bei einem
 * Chunking-Schwellwert früh über translateContentChunked zurück, siehe
 * lib/i18n/translation-service.ts:173) wird in
 * tests/lib/translation-queue-chunked.test.ts separat mit dem ECHTEN
 * translateContent abgedeckt — in einer eigenen Datei, weil dafür die
 * Anthropic-SDK-Schicht statt translateContent selbst gemockt werden muss
 * (Vitest isoliert Modul-Mocks pro Testdatei).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TranslationQueueItem } from '@/lib/types'

const glossaryMocks = vi.hoisted(() => ({
  reinjectGlossaryMarksForTranslation: vi.fn(async (_source: unknown, translated: unknown) => translated),
}))
vi.mock('@/lib/glossary/translate', () => ({
  reinjectGlossaryMarksForTranslation: glossaryMocks.reinjectGlossaryMarksForTranslation,
}))

const translationServiceMocks = vi.hoisted(() => ({ translateContent: vi.fn() }))
vi.mock('@/lib/i18n/translation-service', () => ({
  translateContent: translationServiceMocks.translateContent,
}))

function makeItem(overrides: Partial<TranslationQueueItem> = {}): TranslationQueueItem {
  return {
    id: 'queue-1',
    content_type: 'generated_post',
    content_id: 'post-1',
    ui_key: null,
    target_language: 'en',
    priority: 0,
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    last_error: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    ...overrides,
  }
}

/** Tabellen-bewusster PostgREST-Stub mit FIFO-Antwortqueue pro Tabelle
 *  (Muster aus tests/api/admin-glossary.test.ts) — chain.then() bedient ein
 *  direktes `await chain`, chain.single()/maybeSingle() den Einzelzeilen-Read. */
function makeFakeSupabase(queues: Record<string, unknown[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  function makeChain(table: string) {
    const chain: Record<string, unknown> = { table }
    for (const m of ['select', 'eq', 'lt', 'order', 'limit', 'update', 'insert']) {
      chain[m] = vi.fn((...args: unknown[]) => { calls.push({ table, method: m, args }); return chain })
    }
    const resolve = () => {
      const q = queues[table]
      return q && q.length ? q.shift() : { data: null, error: null }
    }
    chain.single = vi.fn(async () => resolve())
    chain.maybeSingle = vi.fn(async () => resolve())
    chain.then = (res: (v: unknown) => void) => res(resolve())
    return chain
  }
  return { supabase: { from: (table: string) => makeChain(table) } as never, calls }
}

const SHORT_SOURCE_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein kurzer Artikeltext.' }] }],
}

beforeEach(() => {
  translationServiceMocks.translateContent.mockReset()
  glossaryMocks.reinjectGlossaryMarksForTranslation.mockReset()
  glossaryMocks.reinjectGlossaryMarksForTranslation.mockImplementation(async (_source, translated) => translated)
})

describe('processTranslationQueue — processGeneratedPost, kurzer Inhalt', () => {
  it('injiziert Glossar-Marks neu und schreibt das Ergebnis, nicht das rohe translateContent-Resultat', async () => {
    const translatedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A short article.' }] }] }
    translationServiceMocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', excerpt: 'Excerpt', content: translatedContent,
    })
    const reinjectedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A short article.', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }] }] }
    glossaryMocks.reinjectGlossaryMarksForTranslation.mockResolvedValueOnce(reinjectedContent)

    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Titel', excerpt: 'Kurzfassung', content: JSON.stringify(SHORT_SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
      languages: [{ data: { llm_model: 'gemini-2.5-flash' }, error: null }],
    })

    const { processTranslationQueue } = await import('@/lib/i18n/translation-queue')
    const result = await processTranslationQueue(supabase, { maxBatches: 1, batchSize: 1 })

    expect(result.totalSuccess).toBe(1)
    expect(glossaryMocks.reinjectGlossaryMarksForTranslation).toHaveBeenCalledWith(
      SHORT_SOURCE_CONTENT, translatedContent, 'en',
    )
    const insertCall = calls.find((c) => c.table === 'content_translations' && c.method === 'insert')
    expect(insertCall).toBeDefined()
    expect((insertCall!.args[0] as { content: unknown }).content).toBe(reinjectedContent)
  })

  it('schreibt nichts und markiert das Item als fehlgeschlagen, wenn die Injektion wirft (kein linkfreier Write)', async () => {
    translationServiceMocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', excerpt: 'Excerpt', content: { type: 'doc', content: [] },
    })
    glossaryMocks.reinjectGlossaryMarksForTranslation.mockRejectedValueOnce(new Error('Begriffsliste leer'))

    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }],
      content_translations: [{ data: null, error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Titel', excerpt: 'Kurzfassung', content: JSON.stringify(SHORT_SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
      languages: [{ data: { llm_model: 'gemini-2.5-flash' }, error: null }],
    })

    const { processTranslationQueue } = await import('@/lib/i18n/translation-queue')
    const result = await processTranslationQueue(supabase, { maxBatches: 1, batchSize: 1 })

    expect(result.totalFailed).toBe(1)
    expect(calls.some((c) => c.table === 'content_translations' && (c.method === 'insert' || c.method === 'update'))).toBe(false)
  })
})

describe('processTranslationQueue — processStaticPage bleibt unverändert (keine Glossar-Injektion)', () => {
  it('ruft reinjectGlossaryMarksForTranslation nicht auf', async () => {
    translationServiceMocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', content: { type: 'doc', content: [] },
    })
    const { supabase } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem({ content_type: 'static_page' })], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      static_pages: [{ data: { id: 'post-1', title: 'Seite', content: JSON.stringify(SHORT_SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
      languages: [{ data: { llm_model: 'gemini-2.5-flash' }, error: null }],
    })

    const { processTranslationQueue } = await import('@/lib/i18n/translation-queue')
    const result = await processTranslationQueue(supabase, { maxBatches: 1, batchSize: 1 })

    expect(result.totalSuccess).toBe(1)
    expect(glossaryMocks.reinjectGlossaryMarksForTranslation).not.toHaveBeenCalled()
  })
})
