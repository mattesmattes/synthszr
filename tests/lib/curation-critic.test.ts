/**
 * Kritiker (Task 9, lib/curation/critic.ts). Reines Modul, keine
 * Supabase-Mocks: checkHardRules/checkSoftRules bekommen Plan, Snapshot und
 * Cluster fertig uebergeben; critiqueWithModel bekommt einen Mock-CallToolFn.
 * item()/snap() wie in tests/lib/curation-cluster.test.ts (Task 5).
 *
 * Fixtures (Controller-Ruling R2, bindend): Items r0..r25 im Snapshot
 * (source_identifier zyklisch 'q0'..'q3', total_score absteigend), dazu h1
 * und h2 als Hand-Items. Das Cluster fuehrt jede r-ID und h1 unter sich
 * selbst, h2 haengt unter dem Story-Key von h1 — h1 und h2 bilden also
 * zusammen GENAU EINE Hand-Story ('h1': ['h1', 'h2']), wie es
 * handStoriesOf(snapshot, cluster) auch im echten Lauf liefern wuerde.
 */
import { describe, expect, it, vi } from 'vitest'
import { checkHardRules, checkSoftRules, critiqueWithModel, revisionHints, CRITIC_TOOL } from '@/lib/curation/critic'
import type { ClusterResult, ComposePlan, ComposeUnit, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

function item(id: string, p: Partial<PoolSnapshotItem> = {}): PoolSnapshotItem {
  return {
    id, title: id, source_identifier: 's', source_display_name: null, total_score: 1, bundle_type: null,
    metadata: null, content_length: 1000, daily_repo_id: null, queued_at: '2026-10-14T20:00:00.000Z',
    source_pub_rate: 0, excerpt: '', hand: false, techmeme_story: null, techmeme_story_index: null, ...p,
  }
}

function snap(items: PoolSnapshotItem[]): PoolSnapshot {
  const tm = new Map<string, string[]>()
  for (const i of items) if (i.techmeme_story) tm.set(i.techmeme_story, [...(tm.get(i.techmeme_story) ?? []), i.id])
  return {
    asOf: '2026-10-15T04:25:00.000Z', windowFrom: '', items, truncated: false,
    excluded: { used_earlier: 0, expired: 0, skipped: 0, junk: 0, short: 0 },
    handIds: items.filter((i) => i.hand).map((i) => i.id),
    techmemeStories: [...tm].map(([story, member_ids], i) => ({ story, index: i, member_ids })),
  }
}

// r0..r25: source_identifier zyklisch ueber 4 Quellen, total_score absteigend (Ruling R2).
const rItems = Array.from({ length: 26 }, (_, i) => item(`r${i}`, { source_identifier: `q${i % 4}`, total_score: 26 - i }))
const handItems = [item('h1', { hand: true, total_score: 0 }), item('h2', { hand: true, total_score: 0 })]
const snapshot = snap([...rItems, ...handItems])
const cluster: ClusterResult = {
  storyKeyOf: Object.fromEntries([...rItems, ...handItems].map((i) => [i.id, i.id === 'h2' ? 'h1' : i.id])),
  clusters: {
    ...Object.fromEntries(rItems.map((i) => [i.id, [i.id]])),
    h1: ['h1', 'h2'],
  },
  related: [],
}

function unit(p: Partial<ComposeUnit> & { member_ids: string[]; tier: ComposeUnit['tier']; rank: number }): ComposeUnit {
  return {
    unit_key: `${p.role ?? 'single'}::${p.member_ids[0]}`, story_key: p.member_ids[0], role: null,
    reason: '', alternative: null, precedent_ids: [], is_hand: false, ...p,
  }
}
const plan = (units: ComposeUnit[]): ComposePlan => ({ thesis: '', units, techmeme_decisions: [], hand_story_decisions: [], fixes: [], source: 'model' })
const nine = (tier: ComposeUnit['tier'] = 'recommended', from = 0) =>
  Array.from({ length: 9 }, (_, i) => unit({ member_ids: [`r${from + i}`], tier, rank: i + 1 }))

describe('checkHardRules', () => {
  it('Setzliste 9–11, Gesamt <= 20, eine cover_story, <= 5 Quellen, <= 30 % je Quelle', () => {
    const tooFew = plan(nine().slice(0, 8))
    expect(checkHardRules(tooFew, snapshot, cluster, new Map())).toContain('setzliste_size:8')

    const covers = plan([...nine().map((u, i) => (i < 2 ? { ...u, role: 'cover_story' as const } : u))])
    expect(checkHardRules(covers, snapshot, cluster, new Map()).some((c) => c.startsWith('cover_count:2'))).toBe(true)

    const tooMany = plan([...nine(), ...nine('bench'), ...nine('bench', 9)])
    expect(checkHardRules(tooMany, snapshot, cluster, new Map()).some((c) => c.startsWith('total_size:'))).toBe(true)

    // <= 5 Quellen je Einheit: eine Einheit mit 6 Membern verletzt die Regel, benannt nach ihrem unit_key.
    const tooManySources = plan([unit({ member_ids: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'], tier: 'recommended', rank: 1 })])
    expect(checkHardRules(tooManySources, snapshot, cluster, new Map())).toContain('sources_max:single::r0')

    // <= 30 % der Setzliste je Quelle, erst ab 4 Einheiten: r0, r4, r8 sind alle q0 (3 von 4 = 75 %).
    const dominated = plan([
      unit({ member_ids: ['r0'], tier: 'recommended', rank: 1 }),
      unit({ member_ids: ['r4'], tier: 'recommended', rank: 2 }),
      unit({ member_ids: ['r8'], tier: 'recommended', rank: 3 }),
      unit({ member_ids: ['r1'], tier: 'recommended', rank: 4 }),
    ])
    expect(checkHardRules(dominated, snapshot, cluster, new Map())).toContain('source_share:q0:0.75')
  })

  it('unknown_id bei IDs ausserhalb des Snapshots', () => {
    const withGhost = plan([...nine().slice(0, 8), unit({ member_ids: ['ghost'], tier: 'recommended', rank: 9 })])
    expect(checkHardRules(withGhost, snapshot, cluster, new Map())).toContain('unknown_id:ghost')
  })

  it('Hand-Invariante: fehlende Hand-Story, gesplittete Hand-Story, held ohne Hand', () => {
    const noHand = plan(nine())
    expect(checkHardRules(noHand, snapshot, cluster, new Map())).toContain('hand_missing:h1')

    const split = plan([...nine(), unit({ member_ids: ['h1'], tier: 'bench', rank: 1, is_hand: true }), unit({ member_ids: ['h2'], tier: 'bench', rank: 2, is_hand: true })])
    expect(checkHardRules(split, snapshot, cluster, new Map())).toContain('hand_split:h1')

    const heldWrong = plan([...nine(), unit({ member_ids: ['h1', 'h2'], tier: 'held', rank: 1, is_hand: true }), unit({ member_ids: ['r20'], tier: 'held', rank: 2 })])
    expect(checkHardRules(heldWrong, snapshot, cluster, new Map())).toContain('held_not_hand:single::r20')
  })

  it('story_duplicate bei gleichem Key oder Cosine >= 0,8 der Anfuehrer', () => {
    const dup = plan([...nine(), unit({ member_ids: ['h1', 'h2'], tier: 'bench', rank: 1, is_hand: true }), unit({ member_ids: ['r20'], tier: 'bench', rank: 2 }), unit({ member_ids: ['r21'], tier: 'bench', rank: 3 })])
    const emb = new Map([['r20', [1, 0]], ['r21', [0.95, 0.3]]]) // cosine ≈ 0,954 >= 0,8
    expect(checkHardRules(dup, snapshot, cluster, emb).some((c) => c.startsWith('story_duplicate:'))).toBe(true)
  })

  it('story_duplicate ignoriert Embeddings unterschiedlicher Laenge (cosineSimilarity wirft sonst)', () => {
    const pair = plan([unit({ member_ids: ['r20'], tier: 'recommended', rank: 1 }), unit({ member_ids: ['r21'], tier: 'recommended', rank: 2 })])
    const emb = new Map([['r20', [1, 0]], ['r21', [1, 0, 0]]])
    expect(() => checkHardRules(pair, snapshot, cluster, emb)).not.toThrow()
    expect(checkHardRules(pair, snapshot, cluster, emb).some((c) => c.startsWith('story_duplicate:'))).toBe(false)
  })
})

describe('checkSoftRules', () => {
  it('held > 5 und mehr als zwei Techmeme-Stories als topic/cover', () => {
    const many = plan([...nine(), ...Array.from({ length: 6 }, (_, i) => unit({ member_ids: [`h${i}`], tier: 'held', rank: i + 1, is_hand: true }))])
    expect(checkSoftRules(many, snapshot, cluster)).toContain('held_many:6')

    const techmemeHeavy = plan([
      unit({ member_ids: ['r0'], tier: 'recommended', rank: 1, role: 'topic', story_key: 'tm:s0' }),
      unit({ member_ids: ['r1'], tier: 'recommended', rank: 2, role: 'cover_story', story_key: 'tm:s1' }),
      unit({ member_ids: ['r2'], tier: 'recommended', rank: 3, role: 'topic', story_key: 'tm:s2' }),
    ])
    expect(checkSoftRules(techmemeHeavy, snapshot, cluster)).toContain('techmeme_topics:3')
  })

  it('label_conflict wenn eine Hand-Story auf Einheiten mit unterschiedlicher Rolle verteilt ist', () => {
    const conflict = plan([
      ...nine(),
      unit({ member_ids: ['h1'], tier: 'bench', rank: 1, is_hand: true, role: 'recap' }),
      unit({ member_ids: ['h2'], tier: 'bench', rank: 2, is_hand: true, role: 'deep_dive' }),
    ])
    expect(checkSoftRules(conflict, snapshot, cluster)).toContain('label_conflict:h1')
  })
})

describe('critiqueWithModel', () => {
  it('ruft curation_critic mit effort low', async () => {
    const callTool = vi.fn(async (input: any) => ({ result: input.validate({ hard: ['x'], soft: [] }), model: 's', tokens: {} as any, costUsd: 0.05, retried: false, strictDropped: false }))
    const r = await critiqueWithModel(callTool as any, plan(nine()), snapshot, cluster, null)
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_critic', tool: CRITIC_TOOL, effort: 'low', maxTokens: 4096 })
    expect(r.hard).toEqual(['x'])
    expect(r.costUsd).toBe(0.05)
  })

  it('propagiert Fehler (Aufrufer degradiert)', async () => {
    const callTool = vi.fn(async () => { throw new Error('boom') })
    await expect(critiqueWithModel(callTool as any, plan(nine()), snapshot, cluster, null)).rejects.toThrow('boom')
  })
})

it('revisionHints uebersetzt Codes', () => {
  expect(revisionHints(['setzliste_size:8', 'hand_missing:h1'])).toEqual([expect.stringContaining('9'), expect.stringContaining('h1')])
})

it('revisionHints deckt alle harten Codes verstaendlich ab', () => {
  const codes = [
    'total_size:21', 'cover_count:2', 'sources_max:single::r0', 'source_share:q0:0.75',
    'story_duplicate:single::r20|single::r21', 'unknown_id:ghost', 'hand_split:h1', 'held_not_hand:single::r20',
  ]
  const hints = revisionHints(codes)
  expect(hints).toHaveLength(codes.length)
  for (const hint of hints) expect(hint.length).toBeGreaterThan(0)
})
