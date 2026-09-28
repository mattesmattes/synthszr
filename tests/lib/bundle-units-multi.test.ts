/**
 * Ein Label, ein Abschnitt.
 *
 * BETREIBER-VORGABE 2026-09-28: Die vergebenen Labels wiegen stärker als die
 * Bündel. Alle Items mit demselben Label (Cover Story, Thema des Tages, Deep
 * Dive, Nachlese) ergeben EINEN Abschnitt — auch über Techmeme-Stories hinweg.
 *
 * Löst die Vorgabe vom 2026-08-13 ab, nach der jede Techmeme-Story einen
 * eigenen Abschnitt bekam. Anlass: Eine von Hand als „Thema des Tages"
 * markierte Meldung (Benedict Evans zum DNS-Vorfall bei OpenAI) lief als
 * zweiter Themen-Abschnitt neben dem Techmeme-Bündel zur selben Sache.
 */
import { describe, expect, it } from 'vitest'
import { computeBundleUnits, enforceBundleOrdering, computeBundleGroups } from '@/lib/claude/ghostwriter-pipeline'
import type { PipelineItem } from '@/lib/claude/ghostwriter-pipeline'
import { toPipelineItem } from '@/lib/claude/queue-article'

function item(id: string, bundle_type: PipelineItem['bundle_type']): PipelineItem {
  return {
    id,
    title: `Titel ${id}`,
    content: 'Inhalt',
    source_display_name: 'Quelle',
    source_url: `https://example.com/${id}`,
    source_identifier: 'example.com',
    bundle_type: bundle_type ?? null,
  }
}

describe('computeBundleUnits', () => {
  it('fasst alle Items eines Labels zu EINEM Abschnitt zusammen', () => {
    const items = [item('a', 'topic'), item('b', 'topic'), item('c', 'topic'), item('d', 'topic'), item('e', 'topic')]
    const units = computeBundleUnits(items)
    expect(units).toHaveLength(1)
    expect(units[0].bundleType).toBe('topic')
    expect(units[0].indices).toEqual([1, 2, 3, 4, 5])
  })

  it('bildet je Label einen Abschnitt, Cover Story zuerst, Nachlese zuletzt', () => {
    const items = [item('r', 'recap'), item('t1', 'topic'), item('c', 'cover_story'), item('d', 'deep_dive'), item('t2', 'topic')]
    const units = computeBundleUnits(items)
    expect(units.map((u) => u.bundleType)).toEqual(['cover_story', 'topic', 'deep_dive', 'recap'])
    expect(units.find((u) => u.bundleType === 'topic')?.indices).toEqual([2, 5])
  })

  it('fasst Queue-Zeilen verschiedener Techmeme-Stories und von Hand gelabelte unter EINEM Label zusammen', () => {
    // Der Prod-Fall vom 2026-09-28: fuenf Techmeme-Quellen zur OpenAI-Story,
    // eine zu China/Nvidia, dazu Benedict Evans ohne Story — alle "Thema des Tages".
    const row = (id: string, story?: string) => ({
      id, title: `Titel ${id}`, content: 'Inhalt', source_display_name: 'Quelle',
      source_url: `https://example.com/${id}`, source_identifier: 'example.com',
      bundle_type: 'topic' as const, metadata: story ? { techmeme_story: story } : null,
    })
    const items = [row('ap', 'openai-agents'), row('decoder', 'openai-agents'), row('info', 'china-nvidia'), row('evans')]
    const units = computeBundleUnits(items.map(toPipelineItem))
    expect(units).toHaveLength(1)
    expect(units[0].indices).toEqual([1, 2, 3, 4])
  })

  it('ignoriert Items ohne Buendel-Typ', () => {
    expect(computeBundleUnits([item('a', null), item('b', null)])).toHaveLength(0)
  })

  it('macht aus einem EINZELNEN Item kein Buendel', () => {
    // Ein Buendel fasst mehrere Quellen zusammen. Bei einer einzigen waere der
    // Buendel-Prompt („fuehre ALLE Quellen redundanzfrei zusammen") sinnlos —
    // aber der Abschnitt soll die Aufschrift trotzdem tragen, deshalb bleibt
    // die Einheit bestehen und wird nur mit einem Item beschrieben.
    const units = computeBundleUnits([item('a', 'topic')])
    expect(units).toHaveLength(1)
    expect(units[0].indices).toEqual([1])
  })
})

describe('enforceBundleOrdering', () => {
  it('stellt alle Items eines Labels zusammenhaengend vor die Einzelmeldungen', () => {
    const items = [item('normal-1', null), item('a', 'topic'), item('b', 'topic'), item('normal-2', null), item('c', 'topic')]
    const ordering = enforceBundleOrdering([1, 2, 3, 4, 5], computeBundleUnits(items))
    expect(ordering).toEqual([2, 3, 5, 1, 4])
  })

  it('stellt Themen vor Deep Dives und diese vor die Nachlese', () => {
    const items = [item('r', 'recap'), item('d', 'deep_dive'), item('t', 'topic')]
    const ordering = enforceBundleOrdering([1, 2, 3], computeBundleUnits(items))
    expect(ordering).toEqual([3, 2, 1])
  })

  it('laesst eine Reihenfolge ohne Buendel unangetastet', () => {
    const ordering = enforceBundleOrdering([3, 1, 2], computeBundleUnits([item('a', null), item('b', null), item('c', null)]))
    expect(ordering).toEqual([3, 1, 2])
  })
})

describe('computeBundleGroups bleibt fuer den Plan erhalten', () => {
  it('fasst weiterhin je Typ zusammen — der Plan kennt nur die zwei Listen', () => {
    const items = [item('a', 'topic'), item('b', 'topic'), item('c', 'recap')]
    const groups = computeBundleGroups(items)
    expect(groups.topic).toEqual([1, 2])
    expect(groups.recap).toEqual([3])
  })
})
