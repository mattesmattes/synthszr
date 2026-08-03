/**
 * app/api/admin/translations/process-queue/route.ts — POST/processGeneratedPost
 * (Task 16): zweite, eigenständige Implementierung derselben Operation wie
 * lib/i18n/translation-queue.ts (siehe Modul-Kommentar dort) — genau die
 * Struktur, an der Task 4 hing (zwei byte-identische Switch-Blöcke, nur einer
 * erweitert). Dieser Test beweist, dass AUCH diese Kopie die Glossar-Marks
 * neu injiziert, nicht nur die im Cron-Scheduler verwendete
 * lib/i18n/translation-queue.ts.
 *
 * Der echte Chunking-Zweig von translateContent ist bereits in
 * tests/lib/translation-queue-chunked.test.ts end-to-end bewiesen (dieselbe
 * translateContent-Funktion, kein zweiter Beweis nötig) — hier genügt ein
 * gemocktes translateContent mit einem größeren/mehrteiligen Ergebnis, um zu
 * zeigen, dass DIESE Datei keinen Sonderfall für Content-Größe hat.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { TranslationQueueItem } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ email: 'admin@test' }) as { email: string } | null),
  translateContent: vi.fn(),
  reinjectGlossaryMarksForTranslation: vi.fn(async (_source: unknown, translated: unknown) => translated),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/i18n/translation-service', () => ({ translateContent: mocks.translateContent }))
vi.mock('@/lib/glossary/translate', () => ({
  reinjectGlossaryMarksForTranslation: mocks.reinjectGlossaryMarksForTranslation,
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

/** Tabellen-bewusster PostgREST-Stub, gleiches Muster wie
 *  tests/lib/translation-queue.test.ts. */
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
  return { supabase: { from: (table: string) => makeChain(table) }, calls }
}

const SOURCE_CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein Artikeltext.' }] }],
}

function postReq() {
  return new Request('http://localhost/api/admin/translations/process-queue', { method: 'POST' })
}

beforeEach(() => {
  mocks.getSession.mockReset()
  mocks.getSession.mockResolvedValue({ email: 'admin@test' })
  mocks.translateContent.mockReset()
  mocks.reinjectGlossaryMarksForTranslation.mockReset()
  mocks.reinjectGlossaryMarksForTranslation.mockImplementation(async (_source, translated) => translated)
})

describe('POST process-queue — processGeneratedPost, kurzer Inhalt', () => {
  it('injiziert Glossar-Marks neu und schreibt das Ergebnis, nicht das rohe translateContent-Resultat', async () => {
    const translatedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An article.' }] }] }
    mocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', excerpt: 'Excerpt', content: translatedContent,
    })
    const reinjectedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An article.', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] }] }] }
    mocks.reinjectGlossaryMarksForTranslation.mockResolvedValueOnce(reinjectedContent)

    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Titel', excerpt: 'Kurzfassung', content: JSON.stringify(SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabase }))

    const { POST } = await import('@/app/api/admin/translations/process-queue/route')
    const res = await POST(postReq() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(1)

    expect(mocks.reinjectGlossaryMarksForTranslation).toHaveBeenCalledWith(SOURCE_CONTENT, translatedContent, 'en')
    const insertCall = calls.find((c) => c.table === 'content_translations' && c.method === 'insert')
    expect(insertCall).toBeDefined()
    expect((insertCall!.args[0] as { content: unknown }).content).toBe(reinjectedContent)
  })

  it('markiert das Item als fehlgeschlagen und schreibt nichts, wenn die Injektion wirft', async () => {
    mocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', excerpt: 'Excerpt', content: { type: 'doc', content: [] },
    })
    mocks.reinjectGlossaryMarksForTranslation.mockRejectedValueOnce(new Error('Begriffsliste leer'))

    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }],
      content_translations: [{ data: null, error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Titel', excerpt: 'Kurzfassung', content: JSON.stringify(SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabase }))

    const { POST } = await import('@/app/api/admin/translations/process-queue/route')
    const res = await POST(postReq() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBe(1)
    expect(calls.some((c) => c.table === 'content_translations' && (c.method === 'insert' || c.method === 'update'))).toBe(false)
  })
})

describe('POST process-queue — großer/mehrteiliger translateContent-Rückgabewert (kein Sonderfall für Content-Größe)', () => {
  it('injiziert auch bei einem großen, mehrteiligen Übersetzungsergebnis neu', async () => {
    const bigTranslatedContent = {
      type: 'doc',
      content: Array.from({ length: 20 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Translated block ${i}` }] })),
    }
    mocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Big Title', slug: 'big-title', excerpt: 'Big excerpt', content: bigTranslatedContent,
    })
    const reinjectedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'linked' }] }] }
    mocks.reinjectGlossaryMarksForTranslation.mockResolvedValueOnce(reinjectedContent)

    const bigSourceContent = { type: 'doc', content: Array.from({ length: 20 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Block ${i}` }] })) }
    const { supabase, calls } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem()], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      generated_posts: [{ data: { id: 'post-1', title: 'Großer Artikel', excerpt: 'Kurzfassung', content: JSON.stringify(bigSourceContent), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabase }))

    const { POST } = await import('@/app/api/admin/translations/process-queue/route')
    const res = await POST(postReq() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(1)

    expect(mocks.reinjectGlossaryMarksForTranslation).toHaveBeenCalledWith(bigSourceContent, bigTranslatedContent, 'en')
    const insertCall = calls.find((c) => c.table === 'content_translations' && c.method === 'insert')
    expect((insertCall!.args[0] as { content: unknown }).content).toBe(reinjectedContent)
  })
})

describe('POST process-queue — processStaticPage bleibt unverändert (keine Glossar-Injektion)', () => {
  it('ruft reinjectGlossaryMarksForTranslation nicht auf', async () => {
    mocks.translateContent.mockResolvedValueOnce({
      success: true, title: 'Title', slug: 'title', content: { type: 'doc', content: [] },
    })
    const { supabase } = makeFakeSupabase({
      translation_queue: [{ data: [], error: null }, { data: [makeItem({ content_type: 'static_page' })], error: null }, { error: null }, { error: null }],
      content_translations: [{ data: null, error: null }, { error: null }],
      static_pages: [{ data: { id: 'post-1', title: 'Seite', content: JSON.stringify(SOURCE_CONTENT), updated_at: '2026-01-01T00:00:00Z' }, error: null }],
    })
    vi.resetModules()
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabase }))

    const { POST } = await import('@/app/api/admin/translations/process-queue/route')
    const res = await POST(postReq() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(1)
    expect(mocks.reinjectGlossaryMarksForTranslation).not.toHaveBeenCalled()
  })
})
