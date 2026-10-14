/**
 * Story-Schluessel (Task 5, lib/curation/cluster.ts). Reines Modul, keine
 * Supabase-Mocks: clusterPool bekommt den Snapshot und eine fertige
 * Embeddings-Map.
 */
import { describe, expect, it } from 'vitest'
import { clusterPool, handStoriesOf, leaderOf } from '@/lib/curation/cluster'
import type { ClusterResult, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

/**
 * Generische Invariante nach jedem clusterPool-Aufruf (Review-Fix R9): jede
 * ID steht in GENAU EINEM clusters[]-Array, und dessen Key stimmt mit
 * storyKeyOf[id] ueberein. Deckt genau den Fehler ab, den C1 hatte — ein
 * Techmeme-Anfuehrer, dessen storyKeyOf stillschweigend auf einen fremden Key
 * umgebogen wurde, waehrend sein altes Cluster ihn weiterhin listete.
 */
function assertClusterInvariant(r: ClusterResult): void {
  const clusterKeysById = new Map<string, string[]>()
  for (const [key, memberIds] of Object.entries(r.clusters)) {
    for (const id of memberIds) clusterKeysById.set(id, [...(clusterKeysById.get(id) ?? []), key])
  }
  for (const [id, keys] of clusterKeysById) {
    expect(keys).toEqual([r.storyKeyOf[id]]) // genau ein Cluster, Key == storyKeyOf
  }
  for (const [id, key] of Object.entries(r.storyKeyOf)) {
    expect(r.clusters[key]).toContain(id) // storyKeyOf verweist auf ein Cluster, das die ID auch listet
  }
}

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
    assertClusterInvariant(r)
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
    assertClusterInvariant(r)
  })

  it('R9: Techmeme-Anfuehrer wird von einem frueher gehaltenen Hand-Item eingeholt — beide Cluster mergen unter dem Techmeme-Key, kein Member verwaist', () => {
    // H (Hand) steht in `ordered` vor L (Techmeme-Anfuehrer von 'dots') und
    // wird deshalb zuerst gehalten; L ist L embedding-aehnlich genug (cos
    // ~ 0,995 >= Default-Schwelle 0,8), um von clusterByEmbedding als
    // Duplikat von H verworfen zu werden. Ohne R9 wuerde storyKeyOf.L auf 'H'
    // umgebogen und M (Techmeme-Mitglied ohne eigenes Embedding) bliebe unter
    // 'tm:dots' zurueck, dessen Anfuehrer-Slot [0] dann nicht mehr zu
    // storyKeyOf.L passt (Review C1).
    const s = snap([
      item('H', { hand: true, total_score: 2 }),
      item('L', { techmeme_story: 'dots', total_score: 8 }),
      item('M', { techmeme_story: 'dots', total_score: 5 }),
    ])
    const emb = new Map([['H', E(1, 0)], ['L', E(0.99, 0.1)]]) // M ohne Embedding
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.H).toBe('tm:dots')
    expect(r.storyKeyOf.L).toBe('tm:dots')
    expect(r.storyKeyOf.M).toBe('tm:dots')
    expect(r.clusters['tm:dots'][0]).toBe('H') // X (Hand-Item) bleibt Anfuehrer an Position 0
    expect(r.clusters.H).toBeUndefined() // der alte Hand-Key ist komplett im Techmeme-Key aufgegangen
    assertClusterInvariant(r)
  })

  it('Items ohne Embedding sind eigener Cluster; related listet Paare zwischen 0,65 und 0,8', () => {
    const s = snap([item('a', { total_score: 3 }), item('b', { total_score: 2 }), item('c', { total_score: 1 })])
    const emb = new Map([['a', E(1, 0)], ['b', E(0.72, 0.69)]]) // cos ≈ 0.72
    const r = clusterPool(s, emb)
    expect(r.storyKeyOf.c).toBe('c')
    expect(r.related).toHaveLength(1)
    expect(r.related[0][0]).toBe('a')
    expect(r.related[0][1]).toBe('b')
    assertClusterInvariant(r)
  })

  // WARUM kein End-to-End-Test fuer den Laengencheck in `related` (Review
  // I1): zwei Anfuehrer mit nicht-leeren, aber unterschiedlich dimensionierten
  // Embeddings koennen `clusterPool` ueberhaupt nicht BEIDE als `kept`
  // erreichen — `clusterByEmbedding` (Phase-0, unberuehrt) vergleicht JEDES
  // neue Item gegen ALLE bereits gehaltenen mit nicht-leerem Embedding
  // (semantic-dedup.ts:99-102) OHNE eigenen Laengencheck und wirft dort zuerst
  // (empirisch verifiziert: `cosineSimilarity(a_dim3, b_dim2)` crasht in
  // `clusterByEmbedding`, bevor cluster.ts ueberhaupt den `related`-Block
  // erreicht). Der Laengencheck in `related` bleibt trotzdem als Defense-in-
  // Depth stehen (Vertrag §0 verlangt ihn woertlich, und er schuetzt vor einer
  // kuenftigen Aenderung an `clusterByEmbedding` oder einer abweichenden
  // `embeddings`-Quelle) — nur isoliert reproduzierbar ist er ueber den
  // oeffentlichen `clusterPool`-Pfad nicht, weil die Ursache in einem
  // Phase-0-Modul liegt, das dieser Task nicht aendern darf.
})

describe('handStoriesOf', () => {
  it('liefert je Hand-Story ALLE Member, auch Nicht-Hand-Quellen', () => {
    const s = snap([item('h', { hand: true }), item('p')])
    expect(handStoriesOf(s, { storyKeyOf: { h: 'h', p: 'h' }, clusters: { h: ['h', 'p'] }, related: [] })).toEqual({ h: ['h', 'p'] })
  })
})
