/**
 * Chefredaktion (Task 8, lib/curation/compose.ts). Reines Modul, keine
 * Supabase-Mocks: compose_day-Tool, Prompt-Bau und Validierung bekommen
 * Snapshot/Cluster/Brief fertig uebergeben. item()/snap() wie in
 * tests/lib/curation-cluster.test.ts (Task 5).
 */
import { describe, expect, it, vi } from 'vitest'
import { baselinePlan, buildComposeMessages, composeDay, parseComposeOutput, unitKeyFor, validatePlan, COMPOSE_TOOL } from '@/lib/curation/compose'
import type { RawComposePlan } from '@/lib/curation/compose'
import type { ClusterResult, PoolSnapshot, PoolSnapshotItem } from '@/lib/curation/types'

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

const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item(id, { total_score: 6 - 'abcdef'.indexOf(id), hand: id === 'c' }))
const snapshot = snap(items)
const cluster: ClusterResult = { storyKeyOf: { a: 'a', b: 'b', c: 'c', d: 'a', e: 'e', f: 'f' }, clusters: { a: ['a', 'd'], b: ['b'], c: ['c'], e: ['e'], f: ['f'] }, related: [] }
const raw = (units: RawComposePlan['units']): RawComposePlan => ({ thesis: 'T', units, techmeme_decisions: [], hand_story_decisions: [] })

describe('validatePlan', () => {
  it('entfernt unbekannte IDs, dedupliziert, kappt auf 5, mappt none→null, nummeriert je Tier, setzt is_hand', () => {
    const plan = validatePlan(raw([
      { member_ids: ['a', 'zz', 'a', 'd'], role: 'topic', rank: 7, tier: 'recommended', reason: 'x'.repeat(200), alternative: '', precedent_ids: ['P1', 'P9'] },
      { member_ids: ['zz'], role: 'none', rank: 1, tier: 'recommended', reason: 'weg', alternative: '', precedent_ids: [] },
      { member_ids: ['c'], role: 'none', rank: 2, tier: 'held', reason: 'hand', alternative: 'recap', precedent_ids: [] },
      { member_ids: ['b'], role: 'none', rank: 9, tier: 'quatsch', reason: 'b', alternative: '', precedent_ids: [] },
    ]), snapshot, cluster, { P1: 'unit-1' })
    expect(plan.units.map((u) => [u.unit_key, u.tier, u.rank])).toEqual([['topic::a', 'recommended', 1], ['single::c', 'held', 1], ['single::b', 'bench', 1]])
    expect(plan.units[0].member_ids).toEqual(['a', 'd']); expect(plan.units[0].reason).toHaveLength(160); expect(plan.units[0].precedent_ids).toEqual(['unit-1'])
    expect(plan.units[1].is_hand).toBe(true); expect(plan.units[1].alternative).toBe('recap')
    expect(plan.fixes.join(' ')).toMatch(/unbekannt|leer|tier/i)
    expect(plan.source).toBe('model')
  })
  it('kappt > 5 Quellen auf die 5 mit hoechstem total_score', () => {
    const big = snap(['1', '2', '3', '4', '5', '6', '7'].map((id) => item(id, { total_score: Number(id) })))
    const cl: ClusterResult = { storyKeyOf: Object.fromEntries(big.items.map((i) => [i.id, '1'])), clusters: { '1': big.items.map((i) => i.id) }, related: [] }
    const plan = validatePlan(raw([{ member_ids: ['1', '2', '3', '4', '5', '6', '7'], role: 'topic', rank: 1, tier: 'recommended', reason: 'r', alternative: '', precedent_ids: [] }]), big, cl, {})
    expect(plan.units[0].member_ids).toEqual(['7', '6', '5', '4', '3'])
  })
})
describe('baselinePlan', () => {
  it('total_score-Top-20: 1–10 recommended, Rest bench, Hand-Story ohne Platz → held', () => {
    const ids = Array.from({ length: 22 }, (_, i) => `i${i}`)
    const s = snap([...ids.map((id, i) => item(id, { total_score: 100 - i })), item('hand', { hand: true, total_score: 1 })])
    const cl: ClusterResult = { storyKeyOf: Object.fromEntries([...ids, 'hand'].map((id) => [id, id])), clusters: Object.fromEntries([...ids, 'hand'].map((id) => [id, [id]])), related: [] }
    const plan = baselinePlan(s, cl, { total_score: { '10': ids.slice(0, 10), '20': ids.slice(0, 20) } })
    expect(plan.units.filter((u) => u.tier === 'recommended')).toHaveLength(10)
    expect(plan.units.filter((u) => u.tier === 'bench')).toHaveLength(10)
    expect(plan.units.find((u) => u.member_ids[0] === 'hand')?.tier).toBe('held')
    expect(plan.source).toBe('baseline')
  })
})
describe('buildComposeMessages', () => {
  it('Cards gemischt (seed-stabil), Hand markiert, Brief als Prefix', () => {
    const cards = items.map((i) => ({ id: i.id, core: `K ${i.id}` }))
    const brief = { systemPrefix: 'PREFIX', dayBlock: 'TAG', precedentIds: {}, meta: {} as any }
    const a = buildComposeMessages({ cards, snapshot, cluster, brief, seed: 7 }), b = buildComposeMessages({ cards, snapshot, cluster, brief, seed: 7 })
    expect(a.user).toBe(b.user); expect(a.cachedPrefix).toContain('PREFIX'); expect(a.system).toContain('TAG')
    expect(a.user).toMatch(/\[c\][^\n]*HAND/)
  })
})
describe('composeDay', () => {
  it('ruft curation_editor mit 24k, effort medium und validiert', async () => {
    const callTool = vi.fn(async (input: any) => ({ result: input.validate(raw([{ member_ids: ['a'], role: 'topic', rank: 1, tier: 'recommended', reason: 'r', alternative: '', precedent_ids: [] }])), model: 'o', tokens: {} as any, costUsd: 0.9, retried: false, strictDropped: false }))
    const r = await composeDay(callTool as any, { cards: [], snapshot, cluster, brief: null, seed: 1 }, {})
    expect(callTool.mock.calls[0][0]).toMatchObject({ useCase: 'curation_editor', tool: COMPOSE_TOOL, maxTokens: 24000, effort: 'medium' })
    expect(r.plan.units[0].unit_key).toBe('topic::a'); expect(r.costUsd).toBe(0.9)
  })
})
it('unitKeyFor / parseComposeOutput', () => {
  expect(unitKeyFor(null, 'x')).toBe('single::x'); expect(unitKeyFor('recap', 'x')).toBe('recap::x')
  expect(parseComposeOutput({ thesis: 1 })).toBeNull()
})
