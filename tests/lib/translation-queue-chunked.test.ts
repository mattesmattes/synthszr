/**
 * lib/i18n/translation-queue.ts — processGeneratedPost mit ECHTEM
 * translateContent (Task 16), in einer eigenen Datei, weil hier NICHT
 * translateContent selbst gemockt wird, sondern nur die darunterliegende
 * Anthropic-SDK-Schicht (Muster aus
 * tests/lib/translation-attr-preservation.test.ts) — Vitest isoliert
 * Modul-Mocks pro Testdatei, ein gemeinsames File mit
 * tests/lib/translation-queue.test.ts (das translateContent komplett mockt)
 * würde sich gegenseitig stören.
 *
 * Zweck: lib/i18n/translation-service.ts:173 lässt translateContent bei
 * großem Content früh über translateContentChunked zurückkehren. Die
 * Glossar-Neu-Injektion (lib/glossary/translate.ts) läuft AUSSERHALB von
 * translateContent, in processGeneratedPost, NACHDEM translateContent
 * zurückgekehrt ist — dieser Test belegt, dass das auch dann gilt, wenn
 * translateContent intern tatsächlich den Chunking-Zweig genommen hat, nicht
 * nur, dass der Code keinen sichtbaren Sonderfall dafür enthält. Genau dieses
 * Risiko nennt die Aufgabe explizit ("fünfmal aufgetreten").
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

const glossaryMocks = vi.hoisted(() => ({ reinjectGlossaryMarksForTranslation: vi.fn() }))
vi.mock('@/lib/glossary/translate', () => ({
  reinjectGlossaryMarksForTranslation: glossaryMocks.reinjectGlossaryMarksForTranslation,
}))

import type { TranslationQueueItem } from '@/lib/types'

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

describe('processTranslationQueue — processGeneratedPost, gechunkter Inhalt (echtes translateContent)', () => {
  it('injiziert Glossar-Marks auch dann neu, wenn translateContent intern den Chunking-Zweig nimmt', async () => {
    // 20 Absätze à ~1600 Zeichen: JSON-Länge weit über dem 30000-Zeichen-
    // Schwellwert (lib/i18n/translation-service.ts:168), CHUNK_SIZE=15 →
    // erzwingt genau 2 Chunks (15 + 5 Blocks).
    const longParagraph = (n: number) => ({ type: 'paragraph', content: [{ type: 'text', text: `Block ${n}: ${'Ausführlicher Absatztext. '.repeat(60)}` }] })
    const bigSourceContent = { type: 'doc', content: Array.from({ length: 20 }, (_, i) => longParagraph(i)) }
    expect(JSON.stringify(bigSourceContent).length).toBeGreaterThan(30000)

    const metaResponse = { title: 'Big Article Title', slug: 'big-article-title', excerpt: 'Big excerpt' }
    const chunk1 = Array.from({ length: 15 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Translated block ${i}` }] }))
    const chunk2 = Array.from({ length: 5 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Translated block ${15 + i}` }] }))
    mocks.create
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(metaResponse) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(chunk1) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(chunk2) }] })

    const reinjectedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'linked' }] }] }
    glossaryMocks.reinjectGlossaryMarksForTranslation.mockResolvedValueOnce(reinjectedContent)

    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Großer Artikel', excerpt: 'Kurzfassung', content: JSON.stringify(bigSourceContent), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
      languages: [{ data: { llm_model: 'claude-haiku-3.5' }, error: null }],
    })

    const { processTranslationQueue } = await import('@/lib/i18n/translation-queue')
    const result = await processTranslationQueue(supabase, { maxBatches: 1, batchSize: 1 })

    expect(result.totalSuccess).toBe(1)
    // Beweis, dass der reale Chunking-Zweig lief: 3 Anthropic-Calls (Meta + 2 Chunks).
    expect(mocks.create).toHaveBeenCalledTimes(3)
    expect(glossaryMocks.reinjectGlossaryMarksForTranslation).toHaveBeenCalledTimes(1)
    const [calledSource, calledTranslated, calledLang] = glossaryMocks.reinjectGlossaryMarksForTranslation.mock.calls[0]
    expect(calledSource).toEqual(bigSourceContent)
    expect((calledTranslated as { content: unknown[] }).content).toHaveLength(20)
    expect(calledLang).toBe('en')

    const insertCall = calls.find((c) => c.table === 'content_translations' && c.method === 'insert')
    expect((insertCall!.args[0] as { content: unknown }).content).toBe(reinjectedContent)
  })
})
