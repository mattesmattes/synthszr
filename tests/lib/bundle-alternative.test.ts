/**
 * Zu jedem Thema des Tages und jedem Deep Dive entsteht zusätzlich ein
 * EINZELABSCHNITT aus der stärksten Quelle.
 *
 * BETREIBER-VORGABE 2026-08-14: „für den Fall, dass sich der Autor nicht dafür
 * entscheidet, das große Tagesthema mit dem Post zu übernehmen". Der Artikel
 * enthält also beides zur Auswahl — den gebündelten Leitartikel und dieselbe
 * Meldung im gewöhnlichen Format. Der Autor löscht, was er nicht will.
 *
 * NICHT für die Nachlese: Sie ist ein Rückblick, keine Leitmeldung, für die
 * eine Einzelfassung sinnvoll wäre.
 */
import { describe, expect, it } from 'vitest'
import { buildBundleWriteUnits } from '@/lib/claude/ghostwriter-pipeline'
import type { PipelineItem, ArticlePlan } from '@/lib/claude/ghostwriter-pipeline'

const item = (id: string, bundle_type: PipelineItem['bundle_type'], key?: string, content = 'Text'): PipelineItem => ({
  id, title: `Titel ${id}`, content,
  source_display_name: 'Quelle', source_url: `https://example.com/${id}`,
  source_identifier: 'example.com', bundle_type: bundle_type ?? null, bundle_key: key ?? null,
})

const plan = (n: number): ArticlePlan => ({
  thesis: '', ordering: Array.from({ length: n }, (_, i) => i + 1),
  headings: {}, takeAngles: {}, retrievalHints: {}, excerptBullets: [],
} as unknown as ArticlePlan)

describe('Alternativ-Abschnitt zu Bündeln', () => {
  it('legt zu einem Thema des Tages einen Einzelabschnitt dazu', () => {
    const items = [item('a', 'topic', 's1', 'Langer Text'), item('b', 'topic', 's1', 'Kurz')]
    const units = buildBundleWriteUnits(items, plan(2))
    expect(units.filter((u) => u.kind === 'bundle')).toHaveLength(1)
    expect(units.filter((u) => u.kind === 'single')).toHaveLength(1)
  })

  it('nimmt dafuer die inhaltsstaerkste Quelle', () => {
    const items = [item('duenn', 'topic', 's1', 'kurz'), item('dick', 'topic', 's1', 'x'.repeat(500))]
    const single = buildBundleWriteUnits(items, plan(2)).find((u) => u.kind === 'single')
    expect(single && 'item' in single && single.item.id).toBe('dick')
  })

  it('markiert ihn als Alternative', () => {
    const units = buildBundleWriteUnits([item('a', 'topic', 's1')], plan(1))
    const single = units.find((u) => u.kind === 'single')
    expect(single && 'alternativeTo' in single && single.alternativeTo).toBe('s1')
  })

  it('gilt auch fuer Deep Dives', () => {
    const units = buildBundleWriteUnits([item('a', 'deep_dive', 'd1'), item('b', 'deep_dive', 'd1')], plan(2))
    expect(units.filter((u) => u.kind === 'single')).toHaveLength(1)
  })

  it('gilt NICHT fuer die Nachlese', () => {
    const units = buildBundleWriteUnits([item('a', 'recap', 'r1'), item('b', 'recap', 'r1')], plan(2))
    expect(units.filter((u) => u.kind === 'single')).toHaveLength(0)
  })

  it('steht direkt hinter seinem Buendel', () => {
    const items = [item('a', 'topic', 's1'), item('b', 'topic', 's2'), item('c', null)]
    const units = buildBundleWriteUnits(items, plan(3))
    expect(units.map((u) => u.kind)).toEqual(['bundle', 'single', 'bundle', 'single', 'single'])
  })

  it('laesst gewoehnliche Meldungen unberuehrt', () => {
    const units = buildBundleWriteUnits([item('a', null), item('b', null)], plan(2))
    expect(units).toHaveLength(2)
    expect(units.every((u) => u.kind === 'single')).toBe(true)
    expect(units.every((u) => !('alternativeTo' in u) || !u.alternativeTo)).toBe(true)
  })
})
