/**
 * Story-Schluessel (Task 5, lib/curation/cluster.ts). Reines Modul, keine
 * Supabase-Mocks: clusterPool bekommt den Snapshot und eine fertige
 * Embeddings-Map.
 */
import { describe, expect, it } from 'vitest'
import { clusterPool, handStoriesOf, leaderOf } from '@/lib/curation/cluster'
import type { PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

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

const E = (x: number, y: number) => [x, y, 0]

describe('clusterPool', () => {
  it('Hand-Item fuehrt den Cluster, aehnliches Pipeline-Item haengt daran', () => {
    const s = snap([item('pipe', { total_score: 9 }), item('hand', { hand: true, total_score: 2 })])
    const emb = new Map([['pipe', E(1, 0)], ['hand', E(0.99, 0.1)]])
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.hand).toBe('hand')
    expect(r.storyKeyOf.pipe).toBe('hand')
    expect(r.clusters.hand).toEqual(['hand', 'pipe'])
  })

  it('Techmeme-Story: alle Member bekommen den Story-Key ohne Embedding, Anfuehrer zieht Pipeline-Items an', () => {
    const s = snap([
      item('t1', { techmeme_story: 'dots', total_score: 5 }),
      item('t2', { techmeme_story: 'dots', total_score: 8 }),
      item('p', { total_score: 3 }),
    ])
    const emb = new Map([['t2', E(0, 1)], ['p', E(0.05, 0.999)]]) // t1 ohne Embedding
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.t1).toBe('tm:dots')
    expect(r.storyKeyOf.t2).toBe('tm:dots')
    expect(r.storyKeyOf.p).toBe('tm:dots')
    expect(leaderOf(r, 'tm:dots')).toBe('t2')
  })

  it('Items ohne Embedding sind eigener Cluster; related listet Paare zwischen 0,65 und 0,8', () => {
    const s = snap([item('a', { total_score: 3 }), item('b', { total_score: 2 }), item('c', { total_score: 1 })])
    const emb = new Map([['a', E(1, 0)], ['b', E(0.72, 0.69)]]) // cos ≈ 0.72
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.c).toBe('c')
    expect(r.related).toHaveLength(1)
    expect(r.related[0][0]).toBe('a')
    expect(r.related[0][1]).toBe('b')
  })
})

describe('handStoriesOf', () => {
  it('liefert je Hand-Story ALLE Member, auch Nicht-Hand-Quellen', () => {
    const s = snap([item('h', { hand: true }), item('p')])
    expect(handStoriesOf(s, { storyKeyOf: { h: 'h', p: 'h' }, clusters: { h: ['h', 'p'] }, related: [] })).toEqual({ h: ['h', 'p'] })
  })
})
