/**
 * Dedup-Verlierer der Artikel-Erzeugung hinterlassen ein dedup_drop-Event.
 *
 * BEFUND 2026-10-06: selectAndEnrichItems setzt Verlierer von dedupeByTopic
 * still auf pending zurueck (selectItemsForArticle hatte sie auf selected
 * gesetzt). Danach sah die Zeile aus wie nie gewaehlt. Das Event traegt den
 * Gewinner: bei 'batch' die ID des behaltenen Items, bei 'recent_coverage'
 * den Titel des schon veroeffentlichten Posts mit Praefix (keine Gewinner-ID
 * vorhanden; ohne Praefix laese ein Auswerter den Titel als UUID).
 *
 * FIFO news_queue: Eintrag 1 = Update der Verlierer auf pending. Die Events
 * gehen ueber den Fallback (queue_item_events). Scheitert das Update, bleibt
 * die Zeile 'selected' — dann darf kein Event selected→pending entstehen
 * (gleiche Regel wie Techmeme-Promote, reset-item, bundle-type).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

const mocks = vi.hoisted(() => {
  const item = (id: string, score: number) => ({
    id,
    daily_repo_id: null,              // keine daily_repo-Anreicherung (queue-article.ts:333)
    title: id.toUpperCase(),
    content: `Inhalt ${id}`,
    source_display_name: null,
    source_url: null,
    source_identifier: `quelle-${id}`,
    bundle_type: null,                // Einzelmeldung → Teil der Dedup-Pruefung (splitBundled)
    metadata: null,                   // keine Handmarkierung → attachManualToStories kehrt sofort zurueck
    total_score: score,
  })
  return {
    items: [item('a', 0.9), item('b', 0.8), item('c', 0.7)],
    dedupeByTopic: vi.fn(),
  }
})

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

vi.mock('@/lib/news-queue/service', () => ({
  getSelectedItems: vi.fn(async () => mocks.items),
  getBalancedSelection: vi.fn(async () => []),
  selectItemsForArticle: vi.fn(async () => ({ items: [] })),
  deriveSourceUrl: vi.fn((_url: string | null, source: string) => `https://${source}`),
}))

vi.mock('@/lib/news-queue/semantic-dedup', () => ({
  DEFAULT_DEDUP_THRESHOLD: 0.8,
  dedupeByTopic: mocks.dedupeByTopic,
}))

/** Alle in queue_item_events eingefuegten Zeilen, Scheiben flachgeklopft. */
function insertedEvents(): Array<Record<string, unknown>> {
  return (state.chains['queue_item_events'] ?? []).flatMap((c) =>
    c.insert.mock.calls.flatMap((args: unknown[]) => {
      const arg = args[0]
      return (Array.isArray(arg) ? arg : [arg]) as Array<Record<string, unknown>>
    })
  )
}

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  mocks.dedupeByTopic.mockReset()
  // selectAndEnrichItems loggt je Item mehrere Zeilen — im Testlauf stumm.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('selectAndEnrichItems → dedup_drop', () => {
  it('setzt Verlierer auf pending und schreibt je Verlierer dedup_drop mit dem Gewinner als reason', async () => {
    const { selectAndEnrichItems } = await import('@/lib/claude/queue-article')
    mocks.dedupeByTopic.mockResolvedValue({
      kept: [{ id: 'a' }],
      dropped: [
        { id: 'b', title: 'B', similarTo: 'a', similarity: 0.9, reason: 'batch' },
        { id: 'c', title: 'C', similarTo: 'Alter Post', similarity: 0.85, reason: 'recent_coverage' },
      ],
    })
    state.queues['news_queue'] = [
      { data: null, error: null }, // Update der Verlierer auf pending
    ]

    const out = await selectAndEnrichItems({ useSelected: true, maxItems: 3, dedupeTopics: true })

    // Bestand: nur der Gewinner bleibt, Verlierer werden freigegeben.
    expect(out.pipelineItems.map((p) => p.id)).toEqual(['a'])
    expect(out.usedItemIds).toEqual(['a'])
    expect(state.chains['news_queue']).toHaveLength(1)
    const update = state.chains['news_queue'][0]
    expect(update.update).toHaveBeenCalledWith({ status: 'pending', selected_at: null })
    expect(update.in).toHaveBeenCalledWith('id', ['b', 'c'])

    // Neu: je Verlierer ein Event; reason unterscheidet batch und recent_coverage.
    const events = insertedEvents()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      queue_item_id: 'b',
      event: 'dedup_drop',
      actor: 'pipeline',
      from_status: 'selected',
      to_status: 'pending',
      reason: 'a',
    })
    expect(events[1]).toMatchObject({
      queue_item_id: 'c',
      event: 'dedup_drop',
      actor: 'pipeline',
      from_status: 'selected',
      to_status: 'pending',
      reason: 'recent_coverage:Alter Post',
    })
  })

  it('schreibt weder Reset noch Event, wenn dedupeByTopic nichts verwirft', async () => {
    const { selectAndEnrichItems } = await import('@/lib/claude/queue-article')
    mocks.dedupeByTopic.mockResolvedValue({ kept: mocks.items.map((i) => ({ id: i.id })), dropped: [] })

    const out = await selectAndEnrichItems({ useSelected: true, maxItems: 3, dedupeTopics: true })

    expect(out.pipelineItems.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(state.chains['news_queue']).toBeUndefined()
    expect(insertedEvents()).toHaveLength(0)
  })

  it('schreibt kein Event, wenn das Freigeben scheitert — loggt und laeuft weiter wie bisher', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { selectAndEnrichItems } = await import('@/lib/claude/queue-article')
    mocks.dedupeByTopic.mockResolvedValue({
      kept: [{ id: 'a' }, { id: 'c' }],
      dropped: [{ id: 'b', title: 'B', similarTo: 'a', similarity: 0.9, reason: 'batch' }],
    })
    state.queues['news_queue'] = [
      { data: null, error: { message: 'kaputt' } }, // Update der Verlierer scheitert
    ]

    const out = await selectAndEnrichItems({ useSelected: true, maxItems: 3, dedupeTopics: true })

    // Bestand: der Lauf bricht nicht ab, die behaltenen bleiben.
    expect(out.pipelineItems.map((p) => p.id)).toEqual(['a', 'c'])
    expect(state.chains['news_queue'][0].in).toHaveBeenCalledWith('id', ['b'])
    // Die Zeile bleibt 'selected' — ein dedup_drop selected→pending waere falsch.
    expect(insertedEvents()).toHaveLength(0)
    // Neu: der bisher still verworfene Fehler wird geloggt.
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('[Ghostwriter-Queue] Dedup-Verlierer nicht freigegeben'))).toBe(true)
    errorSpy.mockRestore()
  })
})
