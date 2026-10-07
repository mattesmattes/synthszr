import { describe, expect, it } from 'vitest'
import { extractSections, applySectionResult, sectionMatchesKey, restorePreservedHeadingAttrs, PRESERVED_HEADING_ATTRS } from '@/lib/enrich/sections'
import type { TiptapDoc, TiptapNode } from '@/lib/email/tiptap-to-html'

function h2(text: string, attrs: Record<string, string> = {}): TiptapNode {
  return { type: 'heading', attrs: { level: 2, ...attrs }, content: [{ type: 'text', text }] }
}
function p(text: string): TiptapNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('extractSections', () => {
  it('zerlegt an H2-Grenzen und traegt queueItemId/bundleType/isTake korrekt', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        p('Intro vor der ersten Ueberschrift — gehoert zu keinem Abschnitt'),
        h2('Erste News', { queueItemId: 'q1' }),
        p('Text 1'),
        h2('Zweite News', { queueItemId: 'q2', bundleType: 'topic' }),
        p('Text 2a'),
        p('Text 2b'),
        h2('Synthszr Take'),
        p('Take-Text'),
      ],
    }
    const sections = extractSections(doc)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toMatchObject({ queueItemId: 'q1', bundleType: null, isTake: false, nullIndex: -1, startIndex: 1, endIndex: 3 })
    expect(sections[1]).toMatchObject({ queueItemId: 'q2', bundleType: 'topic', isTake: false, nullIndex: -1, startIndex: 3, endIndex: 6 })
    expect(sections[2]).toMatchObject({ queueItemId: null, isTake: true, nullIndex: -1, startIndex: 6, endIndex: 8 })
  })

  it('vergibt nullIndex fortlaufend NUR an Nicht-Take-Abschnitte ohne queueItemId', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        h2('Mit ID', { queueItemId: 'q1' }), p('x'),
        h2('Ohne ID A'), p('x'),
        h2('Synthszr Take'), p('x'), // isTake, hat nie queueItemId, zaehlt NICHT mit
        h2('Ohne ID B'), p('x'),
      ],
    }
    const sections = extractSections(doc)
    expect(sections.map((s) => s.nullIndex)).toEqual([-1, 0, -1, 1])
  })

  it('liefert leeres Array ohne H2', () => {
    expect(extractSections({ type: 'doc', content: [p('nur Text')] })).toHaveLength(0)
  })
})

describe('applySectionResult', () => {
  it('splict per queueItemId, nicht per Index — bleibt korrekt, wenn ein FRUEHERER Abschnitt bereits die Knotenzahl geaendert hat', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        h2('Erste', { queueItemId: 'q1' }), p('kurz'),
        h2('Zweite', { queueItemId: 'q2' }), p('Text 2'),
      ],
    }
    // Simuliert: Abschnitt q1 wurde bereits durch einen LAENGEREN Text ersetzt
    // (3 Absaetze statt 1) — der urspruengliche Index von q2 (2) stimmt jetzt
    // nicht mehr mit seiner tatsaechlichen Position ueberein.
    const afterFirst = applySectionResult(doc, {
      queueItemId: 'q1', isTake: false, nullIndex: -1,
      nodes: [h2('Erste ueberarbeitet', { queueItemId: 'q1' }), p('a'), p('b'), p('c')],
    })
    expect(afterFirst).not.toBeNull()
    expect(afterFirst!.content).toHaveLength(6) // 2 (neue q1-Section) -> 4 Knoten + 2 fuer q2

    // q2 jetzt anreichern — MUSS trotz verschobener Position korrekt greifen
    const afterSecond = applySectionResult(afterFirst!, {
      queueItemId: 'q2', isTake: false, nullIndex: -1,
      nodes: [h2('Zweite ueberarbeitet', { queueItemId: 'q2' }), p('neu')],
    })
    expect(afterSecond).not.toBeNull()
    const headings = afterSecond!.content!.filter((n) => n.type === 'heading').map((n) => n.content?.[0]?.text)
    expect(headings).toEqual(['Erste ueberarbeitet', 'Zweite ueberarbeitet'])
  })

  it('findet den Take-Abschnitt ueber isTake, nicht ueber queueItemId (der Take hat keinen)', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('Synthszr Take'), p('alt')] }
    const result = applySectionResult(doc, { queueItemId: null, isTake: true, nullIndex: -1, nodes: [h2('Synthszr Take'), p('neu, schärfer')] })
    expect(result!.content![1].content![0].text).toBe('neu, schärfer')
  })

  it('gibt null zurueck, wenn der Zielabschnitt nicht mehr existiert', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('Andere', { queueItemId: 'q9' })] }
    expect(applySectionResult(doc, { queueItemId: 'q-geloescht', isTake: false, nullIndex: -1, nodes: [] })).toBeNull()
  })

  it('mutiert das Original-Dokument nicht', () => {
    const doc: TiptapDoc = { type: 'doc', content: [h2('X', { queueItemId: 'q1' }), p('alt')] }
    const original = JSON.stringify(doc)
    applySectionResult(doc, { queueItemId: 'q1', isTake: false, nullIndex: -1, nodes: [h2('Y', { queueItemId: 'q1' })] })
    expect(JSON.stringify(doc)).toBe(original)
  })

  it('REGRESSION (Praxisfall 2026-09-01): zwei Abschnitte ohne queueItemId werden nicht verwechselt', () => {
    // Echter Artikel: Abschnitt 1 ("OpenClaw") und Abschnitt 7 ("Product
    // Manager") hatten BEIDE queueItemId === null. .find() ueber
    // "queueItemId === null" traf IMMER den ersten — der zweite Abschnitts-
    // Ergebnis landete faelschlich im Slot des ersten, dessen echtes Ergebnis
    // damit verloren ging, waehrend der zweite Abschnitt selbst unveraendert
    // blieb. nullIndex behebt das.
    let doc: TiptapDoc = {
      type: 'doc',
      content: [
        h2('EU DSA', { queueItemId: 'qA' }), p('Original EU DSA'),
        h2('OpenClaw'), p('Original OpenClaw'),
        h2('Product Manager'), p('Original Product Manager'),
      ],
    }
    const afterOpenClaw = applySectionResult(doc, {
      queueItemId: null, isTake: false, nullIndex: 0,
      nodes: [h2('OpenClaw ENRICHED'), p('Neu OpenClaw')],
    })
    expect(afterOpenClaw).not.toBeNull()
    doc = afterOpenClaw!

    const afterProductManager = applySectionResult(doc, {
      queueItemId: null, isTake: false, nullIndex: 1,
      nodes: [h2('Product Manager ENRICHED'), p('Neu Product Manager')],
    })
    expect(afterProductManager).not.toBeNull()

    const sections = extractSections(afterProductManager!)
    expect(sections).toHaveLength(3)
    expect(sections.map((s) => s.headingText)).toEqual(['EU DSA', 'OpenClaw ENRICHED', 'Product Manager ENRICHED'])
  })
})

describe('sectionMatchesKey', () => {
  // Realistische Struktur wie im 18-Abschnitte-Praxisfall 2026-09-01, der
  // die Enrich-Fortsetzung noetig machte: Abschnitte mit queueItemId, ohne
  // (mehrfach), und der eine Take-Abschnitt.
  const [take, withId, noIdA, noIdB] = extractSections({
    type: 'doc',
    content: [
      h2('Synthszr Take'), p('x'),
      h2('Mit ID', { queueItemId: 'q1' }), p('x'),
      h2('Ohne ID A'), p('x'),
      h2('Ohne ID B'), p('x'),
    ],
  })

  it('matcht ueber queueItemId', () => {
    expect(sectionMatchesKey(withId, { queueItemId: 'q1', isTake: false, nullIndex: -1 })).toBe(true)
    expect(sectionMatchesKey(withId, { queueItemId: 'q-anders', isTake: false, nullIndex: -1 })).toBe(false)
  })

  it('matcht ueber nullIndex, wenn queueItemId null ist', () => {
    expect(sectionMatchesKey(noIdA, { queueItemId: null, isTake: false, nullIndex: 0 })).toBe(true)
    expect(sectionMatchesKey(noIdB, { queueItemId: null, isTake: false, nullIndex: 1 })).toBe(true)
    expect(sectionMatchesKey(noIdA, { queueItemId: null, isTake: false, nullIndex: 1 })).toBe(false)
  })

  it('matcht den Take-Abschnitt nur ueber isTake, unabhaengig von queueItemId/nullIndex', () => {
    expect(sectionMatchesKey(take, { queueItemId: null, isTake: true, nullIndex: -1 })).toBe(true)
    expect(sectionMatchesKey(withId, { queueItemId: 'q1', isTake: true, nullIndex: -1 })).toBe(false)
    expect(sectionMatchesKey(take, { queueItemId: null, isTake: false, nullIndex: -1 })).toBe(false)
  })

  it('REGRESSION: filtert bereits verarbeitete Abschnitte fuer die Enrich-Fortsetzung korrekt heraus', () => {
    const allSections = [take, withId, noIdA, noIdB]
    // Simuliert eine erste Runde, die wegen Zeitbudget nach dem Take und
    // "Mit ID" abbrach (needsContinuation) — die Fortsetzungsrunde bekommt
    // deren Keys als excludeKeys.
    const excludeKeys = [
      { queueItemId: take.queueItemId, isTake: take.isTake, nullIndex: take.nullIndex },
      { queueItemId: withId.queueItemId, isTake: withId.isTake, nullIndex: withId.nullIndex },
    ]
    const remaining = allSections.filter((s) => !excludeKeys.some((k) => sectionMatchesKey(s, k)))
    expect(remaining.map((s) => s.headingText)).toEqual(['Ohne ID A', 'Ohne ID B'])
  })
})

// Betreiber-Vorgabe 2026-10-05 (Spec Heading-Marker, Review Focus 4): der
// Markdown-Rundgang des Enrich verliert alle Heading-Attrs; die Route schreibt
// sie mit restorePreservedHeadingAttrs vom urspruenglichen H2 zurueck. Fehlt
// hier ein Attr, ist der Final Cut nach dem ersten Enrich unsichtbar.
describe('restorePreservedHeadingAttrs', () => {
  const fullAttrs = {
    queueItemId: 'q1',
    bundleType: 'topic',
    queueItemIds: 'q1,q2,q3',
    curationRank: '3',
    curationTier: 'bench',
  }

  it('listet genau die fuenf Heading-Attrs aus Vertrag 2.5', () => {
    expect([...PRESERVED_HEADING_ATTRS]).toEqual(['queueItemId', 'bundleType', 'queueItemIds', 'curationRank', 'curationTier'])
  })

  it('kopiert alle fuenf Attrs vom Original-H2 auf das neue Heading, level bleibt', () => {
    const original = h2('Alte Ueberschrift', fullAttrs)
    const revised = h2('Neue Ueberschrift')
    restorePreservedHeadingAttrs(original, revised)
    expect(revised.attrs).toEqual({ level: 2, ...fullAttrs })
  })

  it('Original gewinnt gegen gleichnamige Attrs des neuen Headings', () => {
    // Das Modell koennte einen Marker halluzinieren — massgeblich ist das H2
    // VOR dem Enrich.
    const original = h2('Alt', { queueItemId: 'q1', queueItemIds: 'q1,q2' })
    const revised = h2('Neu', { queueItemId: 'falsch', queueItemIds: 'falsch' })
    restorePreservedHeadingAttrs(original, revised)
    expect(revised.attrs).toEqual({ level: 2, queueItemId: 'q1', queueItemIds: 'q1,q2' })
  })

  it('entfernt Attrs, die nur das neue Heading traegt (halluzinierter Marker)', () => {
    // Das Original hat weder curationTier noch queueItemId. Schreibt das
    // Modell einen Marker in die Antwort, setzt der Konverter das Attr — es
    // darf den Restore nicht ueberleben, sonst entscheidet das Modell ueber
    // Tier und Queue-Zuordnung.
    const original = h2('Alt')
    const revised = h2('Neu', { curationTier: 'held', queueItemId: 'halluziniert' })
    restorePreservedHeadingAttrs(original, revised)
    expect(revised.attrs).toEqual({ level: 2 })
  })

  it('uebernimmt keine leeren, fehlenden oder Nicht-String-Werte', () => {
    // TiptapNode.attrs erlaubt string | number; die fuenf Attrs sind laut
    // Vertrag 2.5 Strings — eine Zahl ist ein Fehler im Quell-JSON und wird
    // nicht weitergetragen.
    const original: TiptapNode = { type: 'heading', attrs: { level: 2, queueItemId: '', curationRank: 3, curationTier: 'held' } }
    const revised = h2('Neu')
    restorePreservedHeadingAttrs(original, revised)
    expect(revised.attrs).toEqual({ level: 2, curationTier: 'held' })
  })

  it('ohne Original bleibt vom neuen Heading nur level', () => {
    // Keine Quelle → keines der fuenf Attrs, auch kein vom Modell gesetztes.
    const revised = h2('Neu', { bundleType: 'recap' })
    restorePreservedHeadingAttrs(undefined, revised)
    expect(revised.attrs).toEqual({ level: 2 })
  })

  it('findet das Original-H2 ueber startIndex wie die Route (sectionNodes[0])', () => {
    // Spiegelt app/api/enrich/route.ts: sectionNodes = content.slice(startIndex,
    // endIndex), Quelle = sectionNodes[0]. Mit Intro-Absatz vor der ersten H2,
    // damit ein Off-by-one (Absatz statt H2) auffiele.
    const doc: TiptapDoc = {
      type: 'doc',
      content: [p('Intro'), h2('Buendel', fullAttrs), p('Text'), h2('Einzeln', { queueItemId: 'q9' }), p('Text 2')],
    }
    const [bundle, single] = extractSections(doc)
    const revisedBundle = h2('Buendel neu')
    const revisedSingle = h2('Einzeln neu')
    restorePreservedHeadingAttrs(doc.content!.slice(bundle.startIndex, bundle.endIndex)[0], revisedBundle)
    restorePreservedHeadingAttrs(doc.content!.slice(single.startIndex, single.endIndex)[0], revisedSingle)
    expect(revisedBundle.attrs).toEqual({ level: 2, ...fullAttrs })
    expect(revisedSingle.attrs).toEqual({ level: 2, queueItemId: 'q9' })
  })
})
