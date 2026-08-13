import { describe, expect, it } from 'vitest'
import { computeBundleGroups, enforceBundleOrdering } from '@/lib/claude/ghostwriter-pipeline'

const items = (types: (string|null)[]) => types.map((t, i) => ({ id: `${i+1}`, title: `T${i+1}`, content: 'c', source_identifier: 's', source_url: null, source_display_name: null, bundle_type: t })) as any

describe('computeBundleGroups', () => {
  it('gruppiert topic/recap nach 1-basiertem Index', () => {
    const g = computeBundleGroups(items(['topic', null, 'recap', 'topic']))
    expect(g.topic).toEqual([1, 4]); expect(g.recap).toEqual([3])
  })
})
describe('enforceBundleOrdering', () => {
  it('setzt topic-Gruppe vor recap vor normale', () => {
    // Seit 2026-08-13 nimmt die Funktion Bündel-EINHEITEN statt zweier Listen —
    // nötig, damit mehrere Themen je einen eigenen Abschnitt ergeben. Die
    // Aussage dieses Tests bleibt dieselbe: Bündel vor Einzelmeldungen, Thema
    // vor Nachlese, und die normale Reihenfolge [2,3] bleibt erhalten.
    const g = [
      { bundleType: 'topic' as const, key: 'topic', indices: [4] },
      { bundleType: 'recap' as const, key: 'recap', indices: [1] },
    ]
    expect(enforceBundleOrdering([2, 3, 1, 4], g)).toEqual([4, 1, 2, 3])
  })
})
