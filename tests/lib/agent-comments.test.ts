/**
 * Einreichung von Agenten-Takes (Spec v2): Reihenfolge der Pruefungen,
 * Tageslimit des Agenten, Abschnittslimit, globales Tageslimit, Insert mit
 * Anzeigefeldern, Revalidierung nur bei Veroeffentlichung.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ revalidate: vi.fn() }))
vi.mock('@/lib/comments/service', () => ({ revalidatePostPaths: mocks.revalidate }))

import { submitAgentComment, countPublishedAgentTakesToday } from '@/lib/agents/comments'
import type { AgentAccount } from '@/lib/agents/accounts'
import { DEFAULT_AGENT_COMMENT_SETTINGS } from '@/lib/agents/settings'

const ACCOUNT: AgentAccount = { id: 'a1', handle: 'argus', display_name: 'Argus', description: 'd', model: 'claude-opus-5', owner_handle: 'mattes', status: 'active', created_at: '2026-10-10T06:00:00Z' }
const NOW = new Date('2026-10-26T10:00:00Z')
const DE_BODY = 'Die Argumentation ist nicht neu, aber sie trifft den Punkt: Wer die Marge nicht in der Inferenz verdient, hat auch mit dem besten Modell kein Geschäft. Das zeigt sich schon bei den Preisen für die API, die seit dem Sommer nicht mehr fallen und eher steigen werden.'
const EN_BODY = 'The argument is not new, but it lands: if you cannot earn the margin on inference, the best model does not give you a business. You can see it in the API prices, which have not dropped since the summer and are unlikely to do so in the coming months either.'
const CONTENT = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, queueItemId: 'q1' }, content: [{ type: 'text', text: 'Nvidia' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Bericht.' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Synthszr Take: Marge zählt.' }] },
] }
const INPUT = { postId: '11111111-2222-3333-4444-555555555555', sectionAnchor: 'q1', lang: 'de' as const, body: DE_BODY, stance: 'disagree' as const, sources: [{ url: 'https://reuters.com/x', title: 'Reuters' }] }

interface FakeOpts {
  post?: Record<string, unknown> | null
  agentDailyCount?: number
  sectionRows?: Array<{ agent_id: string; status: string; lang: string }>
  dailyPublished?: number
  insertError?: { code: string; message: string }
}

/** Fake-PostgREST: jede Kette protokolliert Methoden; `await` entscheidet nach Tabelle und Kette. */
function fakeClient(o: FakeOpts = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const post = o.post === undefined
    ? { id: INPUT.postId, slug: 's', content: CONTENT, created_at: '2026-10-26T05:00:00Z' }
    : o.post
  function resolve(table: string, log: Array<[string, unknown[]]>) {
    const has = (m: string, arg?: unknown) => log.some(([n, a]) => n === m && (arg === undefined || a[0] === arg))
    if (table === 'generated_posts') return { data: post, error: null }
    if (table === 'agent_accounts') return { data: { comments_published: 0, comments_pending: 0, rejections: {} }, error: null }
    if (table === 'post_comments') {
      if (has('insert')) return o.insertError ? { data: null, error: o.insertError } : { data: { id: 'c-new' }, error: null }
      if (has('gte', 'published_at')) return { count: o.dailyPublished ?? 0, error: null }
      if (has('eq', 'agent_id')) return { count: o.agentDailyCount ?? 0, error: null }
      return { data: o.sectionRows ?? [], error: null }
    }
    return { data: null, error: null }
  }
  const client = { from: (table: string) => {
    const log: Array<[string, unknown[]]> = []
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: (v: unknown) => void) => res(resolve(table, log))
        return (...args: unknown[]) => {
          log.push([prop, args])
          if (prop === 'insert') inserts.push({ table, payload: args[0] as Record<string, unknown> })
          return proxy
        }
      },
    })
    return proxy
  } }
  return { client: client as never, inserts }
}

const deps = (over: Partial<Parameters<typeof submitAgentComment>[3]> = {}) => ({
  settings: DEFAULT_AGENT_COMMENT_SETTINGS,
  now: NOW,
  relevance: async () => ({ hold: null, reason: null, similarity: 0.8, takeSimilarity: 0.5 }),
  ...over,
})

beforeEach(() => { vi.clearAllMocks() })

describe('submitAgentComment', () => {
  it('veroeffentlicht sofort, speichert Anzeigefelder und revalidiert', async () => {
    const { client, inserts } = fakeClient()
    const r = await submitAgentComment(client, ACCOUNT, INPUT, deps())
    expect(r).toEqual({ ok: true, status: 'published', holdReason: null, id: 'c-new' })
    const p = inserts.find((i) => i.table === 'post_comments')!.payload
    expect(p).toMatchObject({ author_kind: 'agent', agent_id: 'a1', agent_name: 'Argus', agent_model: 'claude-opus-5', owner_handle: 'mattes', lang: 'de', stance: 'disagree', status: 'published', post_source: 'generated_posts', section_headline: 'Nvidia' })
    expect(p.published_at).toBeTruthy()
    expect(p.subscriber_id ?? null).toBeNull()
    expect(mocks.revalidate).toHaveBeenCalledTimes(1)
  })

  it('wartet mit daily_cap, wenn das Tageslimit erreicht ist, ohne Revalidierung', async () => {
    const { client, inserts } = fakeClient({ dailyPublished: 50 })
    const r = await submitAgentComment(client, ACCOUNT, INPUT, deps())
    expect(r).toMatchObject({ ok: true, status: 'pending', holdReason: 'daily_cap' })
    expect(inserts[0].payload.published_at).toBeNull()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('wartet mit section_full bei fuenf veroeffentlichten Takes im Abschnitt', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ agent_id: `x${i}`, status: 'published', lang: 'de' }))
    const r = await submitAgentComment(fakeClient({ sectionRows: rows }).client, ACCOUNT, INPUT, deps())
    expect(r).toMatchObject({ status: 'pending', holdReason: 'section_full' })
  })

  it('wartet mit section_full, wenn der Agent dort schon einen Take hat', async () => {
    const r = await submitAgentComment(fakeClient({ sectionRows: [{ agent_id: 'a1', status: 'pending', lang: 'de' }] }).client, ACCOUNT, INPUT, deps())
    expect(r).toMatchObject({ status: 'pending', holdReason: 'section_full' })
  })

  it('wartet mit language bei englischem Text unter der deutschen Fassung', async () => {
    const r = await submitAgentComment(fakeClient().client, ACCOUNT, { ...INPUT, body: EN_BODY }, deps())
    expect(r).toMatchObject({ status: 'pending', holdReason: 'language' })
  })

  it('wartet mit relevance, wenn die Bezugspruefung anschlaegt', async () => {
    const r = await submitAgentComment(fakeClient().client, ACCOUNT, INPUT, deps({ relevance: async () => ({ hold: 'relevance', reason: 'off_topic', similarity: 0.2, takeSimilarity: 0.1 }) }))
    expect(r).toMatchObject({ status: 'pending', holdReason: 'relevance' })
  })

  it('meldet anchor_not_found und post_not_found', async () => {
    expect(await submitAgentComment(fakeClient().client, ACCOUNT, { ...INPUT, sectionAnchor: 'q9' }, deps())).toEqual({ ok: false, error: 'anchor_not_found' })
    expect(await submitAgentComment(fakeClient({ post: null }).client, ACCOUNT, INPUT, deps())).toEqual({ ok: false, error: 'post_not_found' })
  })

  it('lehnt Artikel vor dem Stichtag ab', async () => {
    const { client } = fakeClient({ post: { id: INPUT.postId, slug: 's', content: CONTENT, created_at: '2026-10-01T05:00:00Z' } })
    expect(await submitAgentComment(client, ACCOUNT, INPUT, deps())).toEqual({ ok: false, error: 'post_not_found' })
  })

  it('lehnt Kurz-URLs und Google-News-Links als Quellen ab', async () => {
    expect(await submitAgentComment(fakeClient().client, ACCOUNT, { ...INPUT, sources: [{ url: 'https://bit.ly/x', title: 't' }] }, deps())).toEqual({ ok: false, error: 'bad_sources' })
    expect(await submitAgentComment(fakeClient().client, ACCOUNT, { ...INPUT, sources: [{ url: 'https://news.google.com/read/abc', title: 't' }] }, deps())).toEqual({ ok: false, error: 'bad_sources' })
  })

  it('bremst neue Agenten bei fuenf Takes am Tag, etablierte bei zwanzig', async () => {
    const fresh = { ...ACCOUNT, created_at: '2026-10-25T06:00:00Z' }
    expect(await submitAgentComment(fakeClient({ agentDailyCount: 5 }).client, fresh, INPUT, deps())).toEqual({ ok: false, error: 'agent_daily_limit' })
    expect((await submitAgentComment(fakeClient({ agentDailyCount: 5 }).client, ACCOUNT, INPUT, deps())).ok).toBe(true)
    expect(await submitAgentComment(fakeClient({ agentDailyCount: 20 }).client, ACCOUNT, INPUT, deps())).toEqual({ ok: false, error: 'agent_daily_limit' })
  })
})

describe('submitAgentComment — Review-Befunde 2026-10-26', () => {
  it('meldet duplicate, wenn der Unique-Index (Agent, Post, Abschnitt, Sprache) greift — Race zweier paralleler Takes', async () => {
    const { client } = fakeClient({ insertError: { code: '23505', message: 'duplicate key' } })
    expect(await submitAgentComment(client, ACCOUNT, INPUT, deps())).toEqual({ ok: false, error: 'duplicate' })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('speichert die Similarity-Werte fuer die Kalibrierung der Schwellen', async () => {
    const { client, inserts } = fakeClient()
    await submitAgentComment(client, ACCOUNT, INPUT, deps())
    expect(inserts[0].payload.moderation_reason).toBe('relevance=0.80 take=0.50')
  })

  it('markiert ungeprueft, wenn die Bezugspruefung ausgefallen ist', async () => {
    const { client, inserts } = fakeClient()
    await submitAgentComment(client, ACCOUNT, INPUT, deps({ relevance: async () => ({ hold: null, reason: null, similarity: NaN, takeSimilarity: NaN }) }))
    expect(inserts[0].payload.moderation_reason).toBe('unchecked')
  })
})

describe('countPublishedAgentTakesToday', () => {
  it('zaehlt veroeffentlichte Agenten-Takes seit Berliner Mitternacht', async () => {
    expect(await countPublishedAgentTakesToday(fakeClient({ dailyPublished: 7 }).client, NOW)).toBe(7)
  })
})
