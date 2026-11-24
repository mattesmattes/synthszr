/**
 * Mehrere Bündel desselben Typs.
 *
 * BETREIBER-VORGABE 2026-08-13: Aus den fünf obersten Techmeme-Stories sollen
 * FÜNF „Thema des Tages"-Abschnitte entstehen, nicht einer.
 *
 * Bis dahin kannte die Pipeline genau zwei Gruppen: alle `topic`-Items in einen
 * Abschnitt, alle `recap`-Items in einen zweiten. Fünf getrennte Themen waren
 * damit unmöglich, egal wie viele Items man markierte.
 *
 * Der Schlüssel ist `bundle_key`. Fehlt er, gruppieren Items weiterhin allein
 * nach ihrem Typ — das ist der bisherige Fall (händisch markierte News) und
 * muss unverändert weiterlaufen.
 */
import { describe, expect, it } from 'vitest'
import { computeBundleUnits, enforceBundleOrdering, computeBundleGroups } from '@/lib/claude/ghostwriter-pipeline'
import type { PipelineItem } from '@/lib/claude/ghostwriter-pipeline'

function item(id: string, bundle_type: PipelineItem['bundle_type'], bundle_key?: string): PipelineItem {
  return {
    id,
    title: `Titel ${id}`,
    content: 'Inhalt',
    source_display_name: 'Quelle',
    source_url: `https://example.com/${id}`,
    source_identifier: 'example.com',
    bundle_type: bundle_type ?? null,
    bundle_key: bundle_key ?? null,
  }
}

describe('computeBundleUnits', () => {
  it('bildet je Story ein eigenes Buendel', () => {
    const items = [
      item('a', 'topic', 'story-1'),
      item('b', 'topic', 'story-1'),
      item('c', 'topic', 'story-2'),
      item('d', 'topic', 'story-2'),
      item('e', 'topic', 'story-3'),
    ]
    const units = computeBundleUnits(items)
    expect(units).toHaveLength(3)
    expect(units.map((u) => u.indices)).toEqual([[1, 2], [3, 4], [5]])
    expect(units.every((u) => u.bundleType === 'topic')).toBe(true)
  })

  it('haelt Stories in der Reihenfolge ihres ersten Vorkommens', () => {
    // Techmemes Reihenfolge ist die redaktionelle Aussage — sie muss den
    // Abschnitt-Aufbau bestimmen und darf nicht alphabetisch verrutschen.
    const items = [item('a', 'topic', 'zeta'), item('b', 'topic', 'alpha'), item('c', 'topic', 'zeta')]
    expect(computeBundleUnits(items).map((u) => u.key)).toEqual(['zeta', 'alpha'])
  })

  it('gruppiert OHNE Schluessel weiterhin nur nach Typ — der bisherige Fall', () => {
    const items = [item('a', 'topic'), item('b', 'topic'), item('c', 'recap'), item('d', 'recap')]
    const units = computeBundleUnits(items)
    expect(units).toHaveLength(2)
    expect(units[0].bundleType).toBe('topic')
    expect(units[0].indices).toEqual([1, 2])
    expect(units[1].bundleType).toBe('recap')
    expect(units[1].indices).toEqual([3, 4])
  })

  it('trennt gleiche Schluessel unterschiedlichen Typs', () => {
    const units = computeBundleUnits([item('a', 'topic', 'x'), item('b', 'recap', 'x')])
    expect(units).toHaveLength(2)
  })

  it('kennt Deep Dive als dritten Typ', () => {
    const units = computeBundleUnits([item('a', 'deep_dive', 'story-1'), item('b', 'deep_dive', 'story-1')])
    expect(units).toHaveLength(1)
    expect(units[0].bundleType).toBe('deep_dive')
  })

  it('fasst 9 long_read-Items ueber 4 verschiedene bundle_keys plus eins ohne Key zu GENAU EINER Einheit zusammen', () => {
    const items = [
      item('1', 'long_read', 'story-a'),
      item('2', 'long_read', 'story-a'),
      item('3', 'long_read', 'story-b'),
      item('4', 'long_read', 'story-b'),
      item('5', 'long_read', 'story-c'),
      item('6', 'long_read', 'story-c'),
      item('7', 'long_read', 'story-d'),
      item('8', 'long_read', 'story-d'),
      item('9', 'long_read'),
    ]
    const units = computeBundleUnits(items)
    expect(units).toHaveLength(1)
    expect(units[0]).toEqual({
      bundleType: 'long_read',
      key: 'long_read',
      indices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    })
  })

  it('fasst auch cover_story, deep_dive und recap ueber verschiedene bundle_keys je Label zu einer Einheit zusammen', () => {
    const items = [
      item('c1', 'cover_story', 'story-a'),
      item('c2', 'cover_story', 'story-b'),
      item('d1', 'deep_dive', 'story-a'),
      item('d2', 'deep_dive', 'story-b'),
      item('r1', 'recap', 'story-a'),
      item('r2', 'recap', 'story-b'),
    ]
    const units = computeBundleUnits(items)
    expect(units).toHaveLength(3)
    expect(units.map((u) => [u.bundleType, u.indices])).toEqual([
      ['cover_story', [1, 2]],
      ['deep_dive', [3, 4]],
      ['recap', [5, 6]],
    ])
  })

  it('ignoriert Items ohne Buendel-Typ', () => {
    expect(computeBundleUnits([item('a', null), item('b', null)])).toHaveLength(0)
  })

  it('macht aus einem EINZELNEN Item kein Buendel', () => {
    // Ein Buendel fasst mehrere Quellen zusammen. Bei einer einzigen waere der
    // Buendel-Prompt („fuehre ALLE Quellen redundanzfrei zusammen") sinnlos —
    // aber der Abschnitt soll die Aufschrift trotzdem tragen, deshalb bleibt
    // die Einheit bestehen und wird nur mit einem Item beschrieben.
    const units = computeBundleUnits([item('a', 'topic', 'einzeln')])
    expect(units).toHaveLength(1)
    expect(units[0].indices).toEqual([1])
  })
})

describe('enforceBundleOrdering mit mehreren Buendeln', () => {
  it('stellt alle Buendel vor die Einzelmeldungen, Story fuer Story', () => {
    const items = [
      item('normal-1', null),
      item('a', 'topic', 'story-1'),
      item('b', 'topic', 'story-2'),
      item('normal-2', null),
      item('c', 'topic', 'story-1'),
    ]
    const units = computeBundleUnits(items)
    const ordering = enforceBundleOrdering([1, 2, 3, 4, 5], units)
    // story-1 (Indizes 2 und 5) zusammen, dann story-2 (3), dann der Rest.
    expect(ordering).toEqual([2, 5, 3, 1, 4])
  })

  it('stellt Themen vor Deep Dives, Long Reads und diese vor die Nachlese', () => {
    const items = [
      item('r', 'recap', 'r1'),
      item('l', 'long_read', 'l1'),
      item('d', 'deep_dive', 'd1'),
      item('t', 'topic', 't1'),
      item('c', 'cover_story', 'c1'),
    ]
    const units = computeBundleUnits(items)
    expect(units.map((u) => u.bundleType)).toEqual(['cover_story', 'topic', 'deep_dive', 'long_read', 'recap'])
    const ordering = enforceBundleOrdering([1, 2, 3, 4, 5], units)
    expect(ordering).toEqual([5, 4, 3, 2, 1])
  })

  it('laesst eine Reihenfolge ohne Buendel unangetastet', () => {
    const ordering = enforceBundleOrdering([3, 1, 2], computeBundleUnits([item('a', null), item('b', null), item('c', null)]))
    expect(ordering).toEqual([3, 1, 2])
  })
})

describe('computeBundleGroups bleibt fuer den Plan erhalten', () => {
  it('fasst weiterhin je Typ zusammen — der Plan kennt nur die zwei Listen', () => {
    const items = [item('a', 'topic', 'story-1'), item('b', 'topic', 'story-2'), item('c', 'recap')]
    const groups = computeBundleGroups(items)
    expect(groups.topic).toEqual([1, 2])
    expect(groups.recap).toEqual([3])
  })

  it('zaehlt long_read in topic (damit hasBundles aktiv wird)', () => {
    const groups = computeBundleGroups([item('l', 'long_read')])
    expect(groups.topic).toEqual([1])
    expect(groups.recap).toEqual([])
  })
})
