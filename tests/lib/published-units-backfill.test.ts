/**
 * Bausteine des published_units-Backfills (scripts/lib/published-units-backfill.ts).
 *
 * WARUM: die Zweige, die über Löschen oder Stehenlassen von Prod-Zeilen
 * entscheiden (kaputt → kein delete, NULL → delete ohne insert, Embedding-
 * Fehler → kein delete, 3 Fehler in Folge → Abbruch), erreicht kein Dry-Run —
 * ohne diese Tests liefen sie zum ersten Mal im [FREIGABE]-Lauf gegen Prod
 * (BEFUND 2026-10-06, Prüferlauf). Supabase-Mock: lokales makeChain mit
 * FIFO-Queue je Tabelle (Muster tests/lib/glossary-jobs-service.test.ts:15-28),
 * Client und Embedding-Funktion werden injiziert — kein vi.mock nötig.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createEmbedFailGuard,
  parseBuildArgs,
  parseContent,
  processPost,
  type PostOutcome,
} from '@/scripts/lib/published-units-backfill'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'order', 'range', 'delete', 'insert']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
})

const UNIT_A = '11111111-1111-4111-8111-111111111111'
const DOC = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, queueItemId: UNIT_A, bundleType: 'topic' }, content: [{ type: 'text', text: 'Thema' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Absatz.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ohne Marker' }] },
  ],
})
const post = (content: unknown) => ({ id: 'p1', content, published_at: '2026-09-01T06:00:00Z' })

describe('parseBuildArgs', () => {
  it('liest --since/--limit in beiden Schreibweisen und --dry-run', () => {
    expect(parseBuildArgs([])).toEqual({ dryRun: false, since: undefined, limit: undefined })
    expect(parseBuildArgs(['--dry-run', '--since', '2026-09-01', '--limit=5'])).toEqual({ dryRun: true, since: '2026-09-01', limit: 5 })
    expect(parseBuildArgs(['--since=2026-09-01', '--limit', '7'])).toEqual({ dryRun: false, since: '2026-09-01', limit: 7 })
  })

  it('ungültige Werte und Flag ohne Wert am Zeilenende → null (kein stiller Volllauf)', () => {
    expect(parseBuildArgs(['--dry-run', '--since'])).toBeNull()
    expect(parseBuildArgs(['--limit'])).toBeNull()
    expect(parseBuildArgs(['--limit=abc'])).toBeNull()
    expect(parseBuildArgs(['--limit=0'])).toBeNull()
    expect(parseBuildArgs(['--since=1.9.2026'])).toBeNull()
  })
})

describe('parseContent', () => {
  it('kaputtes JSON → broken; NULL und Objekte werden durchgereicht', () => {
    expect(parseContent('{kaputt')).toEqual({ broken: true })
    expect(parseContent(null)).toEqual({ broken: false, value: null })
    expect(parseContent('[]')).toEqual({ broken: false, value: [] })
  })
})

describe('processPost', () => {
  it('kaputter content: kein DB-Zugriff, kein Embedding — der alte Stand bleibt', async () => {
    const embed = vi.fn()
    expect(await processPost(client, embed, post('{kaputt'), false)).toEqual({ kind: 'broken' })
    expect(client.from).not.toHaveBeenCalled()
    expect(embed).not.toHaveBeenCalled()
  })

  it('NULL-content: delete für den Post, kein insert, kein Embedding', async () => {
    const embed = vi.fn()
    const out = await processPost(client, embed, post(null), false)
    expect(out).toEqual({ kind: 'written', units: [], embedded: 0 })
    expect(embed).not.toHaveBeenCalled()
    expect(client.from.mock.calls).toEqual([['published_units']])
    const [del] = state.chains.published_units
    expect(del.delete).toHaveBeenCalledTimes(1)
    expect(del.eq).toHaveBeenCalledWith('post_id', 'p1')
    expect(del.insert).not.toHaveBeenCalled()
  })

  it('Embedding wirft: embed_failed, KEIN delete', async () => {
    const embed = vi.fn(async () => { throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set') })
    const out = await processPost(client, embed, post(DOC), false)
    expect(out.kind).toBe('embed_failed')
    expect(out).toMatchObject({ error: 'GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('Erfolg: Embedding-Text ohne Quelle, delete VOR insert, pgvector-String, leerer Vektor → NULL', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => (i === 0 ? [0.25, -0.5] : [])))
    const out = await processPost(client, embed, post(DOC), false)

    expect(embed).toHaveBeenCalledWith(['Title: Thema\n\nContent: Absatz.', 'Title: Ohne Marker'])
    expect(out).toMatchObject({ kind: 'written', embedded: 1 })
    const [del, ins] = state.chains.published_units
    expect(del.delete).toHaveBeenCalledTimes(1)
    expect(del.eq).toHaveBeenCalledWith('post_id', 'p1')
    expect(ins.insert).toHaveBeenCalledWith([
      { post_id: 'p1', position: 0, heading: 'Thema', bundle_type: 'topic', member_ids: [UNIT_A], published_at: '2026-09-01T06:00:00Z', embedding: '[0.25,-0.5]' },
      { post_id: 'p1', position: 1, heading: 'Ohne Marker', bundle_type: null, member_ids: [], published_at: '2026-09-01T06:00:00Z', embedding: null },
    ])
  })

  it('delete-Fehler wirft und verhindert den insert', async () => {
    state.queues.published_units = [{ data: null, error: { message: 'permission denied' } }]
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1]))
    await expect(processPost(client, embed, post(DOC), false)).rejects.toThrow('published_units delete (p1): permission denied')
    expect(state.chains.published_units).toHaveLength(1)
  })

  it('Dry-Run: Einheiten ja, aber weder DB-Zugriff noch Embedding', async () => {
    const embed = vi.fn()
    const out = await processPost(client, embed, post(DOC), true)
    expect(out.kind).toBe('dry_run')
    expect(out.kind === 'dry_run' && out.units.map((u) => u.heading)).toEqual(['Thema', 'Ohne Marker'])
    expect(client.from).not.toHaveBeenCalled()
    expect(embed).not.toHaveBeenCalled()
  })
})

describe('createEmbedFailGuard', () => {
  const fail: PostOutcome = { kind: 'embed_failed', units: [], error: 'x' }
  const okEmpty: PostOutcome = { kind: 'written', units: [], embedded: 0 }
  const okWithUnits: PostOutcome = {
    kind: 'written',
    units: [{ position: 0, heading: 'H', bundleType: null, memberIds: [], firstParagraph: '' }],
    embedded: 1,
  }

  it('3 Fehler in Folge → abbrechen; kaputte Posts und Posts ohne Einheit setzen NICHT zurück', () => {
    const guard = createEmbedFailGuard()
    expect(guard.record(fail)).toBe(false)
    expect(guard.record(okEmpty)).toBe(false)
    expect(guard.record({ kind: 'broken' })).toBe(false)
    expect(guard.record(fail)).toBe(false)
    expect(guard.record(fail)).toBe(true)
    expect(guard.consecutive()).toBe(3)
  })

  it('ein echter Embedding-Erfolg setzt den Zähler zurück', () => {
    const guard = createEmbedFailGuard()
    guard.record(fail)
    guard.record(fail)
    expect(guard.record(okWithUnits)).toBe(false)
    expect(guard.consecutive()).toBe(0)
    expect(guard.record(fail)).toBe(false)
    expect(guard.record(fail)).toBe(false)
    expect(guard.record(fail)).toBe(true)
  })
})
