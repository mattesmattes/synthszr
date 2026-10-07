// tests/lib/write-bundle-section.test.ts — deterministische Teile von Task 5
// (Quellen-Auswahl + Dispatch-Gruppierung) ohne echten Modell-Call. Der
// zusammenführende Modell-Aufruf wird im Integrationslauf geprüft.
import { describe, expect, it, vi } from 'vitest'
import {
  pickPrimaryAndSecondarySources,
  buildBundleWriteUnits,
  extractBundleTagLine,
  ensureBundleMarker,
  ensureQueueIdMarker,
  reinjectBundleMarkers,
} from '@/lib/claude/ghostwriter-pipeline'
import { extractBundleMarkers } from '@/lib/utils/markdown-to-tiptap'

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
    // Seit 2026-08-14 folgt jedem topic- und deep_dive-Buendel eine
    // Einzelfassung derselben Meldung (Betreiber-Vorgabe: der Autor soll
    // waehlen koennen). Die Nachlese bekommt keine — deshalb hier
    // bundle(topic) → single(Alternative) → bundle(recap) → single(normal).
    expect(units.map((u) => u.kind)).toEqual(['bundle', 'single', 'bundle', 'single'])
    expect(units[0]).toMatchObject({ kind: 'bundle', bundleType: 'topic' })
    expect((units[0] as any).items.map((i: any) => i.id)).toEqual(['1', '4'])
    // units[1] ist die Einzelfassung zum topic-Buendel (seit 2026-08-14).
    expect(units[1]).toMatchObject({ kind: 'single' })
    expect((units[1] as any).alternativeTo).toBeTruthy()
    expect(units[2]).toMatchObject({ kind: 'bundle', bundleType: 'recap' })
    expect((units[2] as any).items.map((i: any) => i.id)).toEqual(['3'])
    expect(units[3]).toMatchObject({ kind: 'single', heading: 'H2' })
    expect((units[3] as any).item.id).toBe('2')
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

describe('ensureQueueIdMarker', () => {
  it('hängt data-queue-item-ids mit allen IDs (kommagetrennt, in Reihenfolge) an die H2-Zeile', () => {
    const section = '## Thema des Tages\n\nInhalt.'
    expect(ensureQueueIdMarker(section, ['a', 'b'])).toBe(
      '## Thema des Tages <!-- data-queue-item-ids:a,b -->\n\nInhalt.',
    )
  })

  it('ist idempotent: vorhandener Marker bleibt unverändert, auch mit anderen IDs', () => {
    const section = '## Thema des Tages <!-- data-queue-item-ids:a,b -->\n\nInhalt.'
    expect(ensureQueueIdMarker(section, ['c'])).toBe(section)
  })

  it('ist ein No-Op ohne IDs (nie ein Kommentar ohne Wert)', () => {
    const section = '## Thema des Tages\n\nInhalt.'
    expect(ensureQueueIdMarker(section, [])).toBe(section)
    expect(ensureQueueIdMarker(section, [''])).toBe(section)
  })

  it('hält den Typ-Kommentar am Zeilenende — unabhängig von der Aufrufreihenfolge der beiden Helfer', () => {
    const section = '## Thema des Tages\n\nInhalt.'
    const expected = '## Thema des Tages <!-- data-queue-item-ids:a --> <!-- data-bundle-type:topic -->\n\nInhalt.'
    expect(ensureBundleMarker(ensureQueueIdMarker(section, ['a']), 'topic')).toBe(expected)
    // Typ zuerst gesetzt (z. B. Proofread hat nur den ID-Kommentar entfernt,
    // Backstop setzt ihn nach): IDs werden VOR den Typ geschoben.
    expect(ensureQueueIdMarker(ensureBundleMarker(section, 'topic'), ['a'])).toBe(expected)
  })

  it('ersetzt einen abgeschnittenen ID-Kommentar (ohne -->) durch einen vollständigen, Typ bleibt zuletzt', () => {
    // Prüferlauf 2026-10-06: Kürzt der Proofread den Kommentar entgegen Regel 9,
    // bestünde ein reiner includes('data-queue-item-ids')-Check die Prüfung. Die
    // DATA_MARKER_RE des Extraktors (Task 7) braucht aber `-->`, der Rest bliebe
    // als Text in der Überschrift. Deshalb zählt nur ein vollständiger Kommentar.
    const expected = '## Thema <!-- data-queue-item-ids:a,b -->\n\nInhalt.'
    // Rest am Zeilenende
    expect(ensureQueueIdMarker('## Thema <!-- data-queue-item-ids:a\n\nInhalt.', ['a', 'b'])).toBe(expected)
    // Rest mit verstümmeltem Abschluss
    expect(ensureQueueIdMarker('## Thema <!-- data-queue-item-ids:a,b --\n\nInhalt.', ['a', 'b'])).toBe(expected)
    const withType = '## Thema <!-- data-queue-item-ids:a,b --> <!-- data-bundle-type:topic -->\n\nInhalt.'
    // Rest VOR dem Typ-Kommentar
    expect(
      ensureQueueIdMarker('## Thema <!-- data-queue-item-ids:a <!-- data-bundle-type:topic -->\n\nInhalt.', ['a', 'b']),
    ).toBe(withType)
    // Rest HINTER dem Typ-Kommentar
    expect(
      ensureQueueIdMarker('## Thema <!-- data-bundle-type:topic --> <!-- data-queue-item-ids:a\n\nInhalt.', ['a', 'b']),
    ).toBe(withType)
    // Gegenprobe: ein vollständiger Marker bleibt, auch wenn ein Typ-Kommentar folgt.
    expect(ensureQueueIdMarker(withType, ['c'])).toBe(withType)
  })

  it('fasst nur die erste Heading-Zeile an — weitere H2 und Kommentare im Body bleiben unverändert', () => {
    const section = '## Eins\n\nText.\n\n## Zwei\n\n<!-- frei -->'
    expect(ensureQueueIdMarker(section, ['a'])).toBe(
      '## Eins <!-- data-queue-item-ids:a -->\n\nText.\n\n## Zwei\n\n<!-- frei -->',
    )
  })

  it('bleibt für den Extraktor lesbar (Fassung zur Ausführungszeit)', () => {
    // Läuft gegen den Extraktor, der zur Ausführungszeit im Repo steht — laut
    // Vertrag §3 (Task 9 nach Task 7) die globale DATA_MARKER_RE, die jede
    // Reihenfolge liest. Die alte, am Zeilenende verankerte BUNDLE_MARKER_RE
    // (`-->\s*$`) prüft dieser Fall dann NICHT mehr; den Rückfallschutz für sie
    // (Typ als letzter Kommentar, falls dieser Task ohne Task 7 live geht) pinnt
    // allein der Fall „hält den Typ-Kommentar am Zeilenende" oben. Die Prüfung
    // ist form-neutral über die Werte formuliert, damit sie nicht an der
    // Rückgabeform (Array vor Task 7, Map danach) hängt.
    const line = ensureBundleMarker(ensureQueueIdMarker('## Thema des Tages\n\nInhalt.', ['a', 'b']), 'topic')
    const { cleaned, markers } = extractBundleMarkers(line)
    expect(cleaned).not.toContain('data-bundle-type')
    expect(JSON.stringify([...markers])).toContain('"bundleType":"topic"')
  })
})

describe('reinjectBundleMarkers (Whole-Text-Proofread-Backstop)', () => {
  // Schlanke Fixtures in der Form von MarkerUnit — BundleWriteUnit ist dazu
  // strukturell zuweisbar, die Tests brauchen aber keine PipelineItems.
  const topic = { kind: 'bundle', bundleType: 'topic', items: [{ id: 'a' }, { id: 'b' }] } as const
  const recap = { kind: 'bundle', bundleType: 'recap', items: [{ id: 'c' }] } as const
  const single = (id: string) => ({ kind: 'single', item: { id } }) as const

  it('stellt auf jedem Chunk die Marker SEINER Unit wieder her (Ordinal: Chunk i ↔ Unit i)', () => {
    // Reihenfolge wie buildBundleWriteUnits seit 2026-08-14:
    // topic-Bündel → Einzelfassung (single) → recap-Bündel → normale single.
    const fullText = [
      '## Thema des Tages\n\nInhalt eins.',
      '## Einzelfassung\n\nInhalt zwei.',
      '## Nachlese\n\nInhalt drei.',
      '## Normale Section\n\nInhalt vier.',
    ].join('\n\n')
    const out = reinjectBundleMarkers(fullText, [topic, single('a'), recap, single('d')])
    expect(out).toContain('## Thema des Tages <!-- data-queue-item-ids:a,b --> <!-- data-bundle-type:topic -->')
    expect(out).toContain('## Einzelfassung <!-- data-queue-item-ids:a -->')
    expect(out).toContain('## Nachlese <!-- data-queue-item-ids:c --> <!-- data-bundle-type:recap -->')
    expect(out).toContain('## Normale Section <!-- data-queue-item-ids:d -->')
    // BEFUND 2026-10-06: Die alte Fassung (nur Bündel-Units, auf die ersten N
    // Chunks) hätte "recap" auf die Einzelfassung gesetzt.
    expect(out).not.toContain('## Einzelfassung <!-- data-bundle-type')
    expect(out).not.toContain('## Normale Section <!-- data-bundle-type')
  })

  it('lässt bereits vorhandene Markierungen unverändert und ist ein No-Op ohne Units', () => {
    const withMarkers = '## Thema des Tages <!-- data-queue-item-ids:a,b --> <!-- data-bundle-type:topic -->\n\nInhalt.'
    expect(reinjectBundleMarkers(withMarkers, [topic])).toBe(withMarkers)
    expect(reinjectBundleMarkers(withMarkers, [])).toBe(withMarkers)
  })

  it('überspringt den Backstop bei Abweichung Headings ≠ Units (Ordinal wäre falsch) und warnt', () => {
    // Schreibt das Modell oder der Proofread eine zusätzliche `## `-Zeile,
    // verschiebt sich die Zuordnung für alle folgenden Chunks — die Queue-IDs
    // der FALSCHEN Unit würden zur Ground Truth für published_units.member_ids.
    // Lieber keine Marker als falsche.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const more = '## Eins\n\nA.\n\n## Zwei\n\nB.'
      expect(reinjectBundleMarkers(more, [single('x')])).toBe(more)
      const fewer = '## Eins\n\nA.'
      expect(reinjectBundleMarkers(fewer, [single('x'), single('y')])).toBe(fewer)
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[0][0])).toContain('2 H2-Chunks vs. 1 Units')
      expect(String(warn.mock.calls[1][0])).toContain('1 H2-Chunks vs. 2 Units')
    } finally {
      warn.mockRestore()
    }
  })

  it('überspringt einen Vorspann ohne Heading (Proofread stellt Text voran)', () => {
    const fullText = 'Vorspann.\n\n## Eins\n\nA.'
    const out = reinjectBundleMarkers(fullText, [single('x')])
    expect(out.startsWith('Vorspann.')).toBe(true)
    expect(out).toContain('## Eins <!-- data-queue-item-ids:x -->')
  })

  it('repariert einen vom Proofread abgeschnittenen ID-Kommentar (ohne -->)', () => {
    // Derselbe Reparaturpfad wie in ensureQueueIdMarker, hier über den
    // Whole-Text-Backstop: Die Anzahl der Chunks ändert sich nicht, die
    // Zuordnung bleibt, nur der Rest wird durch einen vollständigen Marker ersetzt.
    const fullText = '## Eins <!-- data-queue-item-ids:x\n\nA.\n\n## Zwei <!-- data-queue-item-ids:a,b --> <!-- data-bundle-type:topic -->\n\nB.'
    const out = reinjectBundleMarkers(fullText, [single('x'), topic])
    expect(out).toBe(
      '## Eins <!-- data-queue-item-ids:x -->\n\nA.\n\n## Zwei <!-- data-queue-item-ids:a,b --> <!-- data-bundle-type:topic -->\n\nB.',
    )
  })
})
