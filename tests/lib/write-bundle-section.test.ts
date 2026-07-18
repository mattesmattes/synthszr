// tests/lib/write-bundle-section.test.ts — deterministische Teile von Task 5
// (Quellen-Auswahl + Dispatch-Gruppierung) ohne echten Modell-Call. Der
// zusammenführende Modell-Aufruf wird im Integrationslauf geprüft.
import { describe, expect, it } from 'vitest'
import {
  pickPrimaryAndSecondarySources,
  buildBundleWriteUnits,
  extractBundleTagLine,
  ensureBundleMarker,
  reinjectBundleMarkers,
} from '@/lib/claude/ghostwriter-pipeline'

describe('pickPrimaryAndSecondarySources', () => {
  it('Haupt-Quelle = größter Inhaltsanteil, Rest Nebenquellen', () => {
    const items = [
      { id: '1', source_display_name: 'A', source_url: 'a', content: 'x'.repeat(100) },
      { id: '2', source_display_name: 'B', source_url: 'b', content: 'x'.repeat(500) },
    ] as any
    const r = pickPrimaryAndSecondarySources(items)
    expect(r.primary.source_url).toBe('b')
    expect(r.secondary.map((s: any) => s.source_url)).toEqual(['a'])
  })
})

describe('buildBundleWriteUnits', () => {
  const item = (id: string, bundle_type: string | null) =>
    ({ id, title: `T${id}`, content: 'c', source_identifier: 's', source_url: null, source_display_name: null, bundle_type }) as any

  it('kollabiert topic/recap zu je einer Bündel-Einheit vor den Einzel-Items', () => {
    // ordering nach enforceBundleOrdering: [topic..., recap..., normal...]
    const orderedItems = [item('1', 'topic'), item('4', 'topic'), item('3', 'recap'), item('2', null)]
    const plan = {
      ordering: [1, 4, 3, 2],
      headings: { '1': 'H1', '4': 'H4', '3': 'H3', '2': 'H2' },
      takeAngles: {},
      retrievalHints: {},
    } as any
    const units = buildBundleWriteUnits(orderedItems, plan)
    expect(units.map((u) => u.kind)).toEqual(['bundle', 'bundle', 'single'])
    expect(units[0]).toMatchObject({ kind: 'bundle', bundleType: 'topic' })
    expect((units[0] as any).items.map((i: any) => i.id)).toEqual(['1', '4'])
    expect(units[1]).toMatchObject({ kind: 'bundle', bundleType: 'recap' })
    expect((units[1] as any).items.map((i: any) => i.id)).toEqual(['3'])
    expect(units[2]).toMatchObject({ kind: 'single', heading: 'H2' })
    expect((units[2] as any).item.id).toBe('2')
  })

  it('ohne bundle_type: nur Einzel-Einheiten (kein Regress)', () => {
    const orderedItems = [item('1', null), item('2', null)]
    const plan = { ordering: [1, 2], headings: {}, takeAngles: {}, retrievalHints: {} } as any
    const units = buildBundleWriteUnits(orderedItems, plan)
    expect(units.map((u) => u.kind)).toEqual(['single', 'single'])
  })
})

describe('extractBundleTagLine', () => {
  it('entfernt eine tag-only-Zeile, behält Heading/Prosa/Take', () => {
    const section = '## H\n\nErster Satz. Zweiter Satz.\n\n{Google} {OpenAI}\n\nSynthszr Take: Take eins.'
    const { tags, rest } = extractBundleTagLine(section)
    expect(tags).toEqual(['{Google}', '{OpenAI}'])
    expect(rest).toContain('## H')
    expect(rest).toContain('Erster Satz. Zweiter Satz.')
    expect(rest).toContain('Synthszr Take: Take eins.')
    expect(rest).not.toContain('{Google}') // Tag-Zeile entfernt
  })

  it('verschluckt KEINEN Prosa-Absatz mit eingebettetem {Company}-Tag', () => {
    // Modell emittiert den Tag entgegen der Anweisung inline in der Prosa.
    const section = '## H\n\n{Google} kündigte an, dass das neue Modell ab sofort verfügbar ist.\n\nSynthszr Take: Take eins.'
    const { tags, rest } = extractBundleTagLine(section)
    expect(tags).toEqual([]) // kein tag-only-Absatz → nichts extrahiert
    expect(rest).toBe(section) // Prosa-Absatz bleibt vollständig erhalten
    expect(rest).toContain('kündigte an, dass das neue Modell ab sofort verfügbar ist.')
  })

  it('extrahiert die Tag-Zeile auch mit Quellen-Pfeil (Modell ignoriert Anweisung)', () => {
    const section = '## H\n\nProsa.\n\n{Google} → [The Verge](https://a.com)\n\nSynthszr Take: T.'
    const { tags, rest } = extractBundleTagLine(section)
    expect(tags).toEqual(['{Google}'])
    expect(rest).not.toContain('The Verge') // ganze Quellen-Zeile entfernt
    expect(rest).toContain('Prosa.')
  })
})

describe('ensureBundleMarker', () => {
  it('injiziert die Markierung, wenn sie fehlt (z.B. vom Proofread entfernt)', () => {
    const section = '## Thema des Tages\n\nInhalt.'
    const out = ensureBundleMarker(section, 'topic')
    expect(out).toBe('## Thema des Tages <!-- data-bundle-type:topic -->\n\nInhalt.')
  })

  it('lässt eine bereits vorhandene Markierung unverändert (idempotent)', () => {
    const section = '## Thema des Tages <!-- data-bundle-type:topic -->\n\nInhalt.'
    expect(ensureBundleMarker(section, 'topic')).toBe(section)
  })
})

describe('reinjectBundleMarkers (Whole-Text-Proofread-Backstop)', () => {
  it('setzt die Markierung auf den ersten N Headings wieder ein (Ordinal-Match, Bündel stehen immer zuerst)', () => {
    const fullText = [
      '## Thema des Tages\n\nInhalt eins.',
      '## Nachlese\n\nInhalt zwei.',
      '## Normale Section\n\nInhalt drei.',
    ].join('\n\n')
    const out = reinjectBundleMarkers(fullText, [{ bundleType: 'topic' }, { bundleType: 'recap' }])
    expect(out).toContain('## Thema des Tages <!-- data-bundle-type:topic -->')
    expect(out).toContain('## Nachlese <!-- data-bundle-type:recap -->')
    expect(out).not.toContain('## Normale Section <!-- data-bundle-type') // Einzel-Section bleibt unangetastet
  })

  it('lässt bereits vorhandene Markierungen unverändert und ist ein No-Op ohne Bündel-Units', () => {
    const withMarker = '## Thema des Tages <!-- data-bundle-type:topic -->\n\nInhalt.'
    expect(reinjectBundleMarkers(withMarker, [{ bundleType: 'topic' }])).toBe(withMarker)
    expect(reinjectBundleMarkers(withMarker, [])).toBe(withMarker)
  })
})
