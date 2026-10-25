/**
 * Lesepfad „Eure Takes" mit Sprachfilter (Spec Agenten-Takes v2): deutsche
 * Agenten-Takes unter /de, englische unter /en; Bestand ohne lang (Leser-Takes
 * von vor 2026-10-26) erscheint ueberall.
 */
import { describe, expect, it, vi } from 'vitest'
import { listPublishedComments } from '@/lib/comments/service'

function fakeClient(rows: unknown[]) {
  const calls: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: rows, error: null })
      return (...args: unknown[]) => { calls.push([prop, args]); return chain }
    },
  })
  return { client: { from: () => chain } as never, calls }
}

const ROW = {
  id: 'c1', display_name: 'Argus', body: 'b', section_anchor: 'q1', section_headline: 'H', published_at: '2026-10-26T07:00:00Z',
  author_kind: 'agent', agent_name: 'Argus', agent_model: 'claude-opus-5', owner_handle: 'mattes', stance: 'disagree',
  sources: [{ url: 'https://r.de', title: 'R' }], lang: 'en',
}

describe('listPublishedComments mit lang', () => {
  it('filtert auf die Sprache ODER Bestand ohne lang', async () => {
    const { client, calls } = fakeClient([ROW])
    await listPublishedComments(client, 'generated_posts', 'p1', 50, undefined, 'en')
    expect(calls).toContainEqual(['or', ['lang.eq.en,lang.is.null']])
  })

  it('setzt ohne lang keinen Sprachfilter', async () => {
    const { client, calls } = fakeClient([ROW])
    await listPublishedComments(client, 'generated_posts', 'p1')
    expect(calls.some(([m]) => m === 'or')).toBe(false)
  })

  it('mappt die Agenten-Felder', async () => {
    const [c] = await listPublishedComments(fakeClient([ROW]).client, 'generated_posts', 'p1', 50, undefined, 'en')
    expect(c).toMatchObject({ authorKind: 'agent', agentName: 'Argus', agentModel: 'claude-opus-5', ownerHandle: 'mattes', stance: 'disagree', lang: 'en' })
    expect(c.sources).toEqual([{ url: 'https://r.de', title: 'R' }])
  })

  it('liefert fuer Leser-Takes authorKind reader und leere Agenten-Felder', async () => {
    const { author_kind: _a, agent_name: _n, agent_model: _m, owner_handle: _o, stance: _s, sources: _q, lang: _l, ...leser } = ROW
    const [c] = await listPublishedComments(fakeClient([leser]).client, 'generated_posts', 'p1')
    expect(c.authorKind).toBe('reader')
    expect(c.agentName).toBeNull()
    expect(c.sources).toEqual([])
    expect(c.lang).toBeNull()
  })
})
void vi
