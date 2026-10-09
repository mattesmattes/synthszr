/**
 * extractPublishedUnits — Einheiten-Ground-Truth (Spec „Präzedenzfälle",
 * Vertrag 2.6).
 *
 * WARUM unter tests/lib und nicht neben den übrigen taste-ground-truth-Tests
 * in tests/scripts/: die CI führt nur `vitest run tests/lib/` aus
 * (.github/workflows/security.yml:192). Review-Fokus 1 (Altposts ohne
 * Queue-Marker → memberIds []) muss regressionsgesichert sein, weil
 * published_units die Ground Truth für Präzedenzfälle (Task 11) und Baseline
 * (Task 15) ist.
 *
 * BEFUND 2026-10-06 (Karte A, Fallstrick 3): extractQueueItemIds läuft
 * rekursiv und kennt weder Level noch Heading-Text noch bundleType — für
 * published_units braucht es Top-Level-Iteration mit Ordinalzählung und
 * den Level-Check, sonst zählen H1/H3 als Einheiten.
 */
import { describe, it, expect } from 'vitest'
import { extractPublishedUnits } from '@/scripts/lib/taste-ground-truth'

const UNIT_A = '11111111-1111-4111-8111-111111111111'
const UNIT_B = '22222222-2222-4222-8222-222222222222'
const UNIT_C = '33333333-3333-4333-8333-333333333333'

const h = (level: number, text: string, attrs: Record<string, unknown> = {}) => ({
  type: 'heading', attrs: { level, ...attrs }, content: [{ type: 'text', text }],
})
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('extractPublishedUnits', () => {
  it('liefert je Top-Level-H2 eine Einheit mit position, heading, bundleType, memberIds, firstParagraph', () => {
    const content = {
      type: 'doc',
      content: [
        h(1, 'Titel des Posts'),
        h(2, 'OpenAI kauft Chips', { queueItemId: UNIT_A, queueItemIds: `${UNIT_A},${UNIT_B}`, bundleType: 'topic' }),
        p('Erster Absatz.'),
        p('Zweiter Absatz.'),
        h(2, 'Nvidia meldet Zahlen', { queueItemId: UNIT_C }),
        p('Nvidia-Absatz.'),
      ],
    }
    expect(extractPublishedUnits(content)).toEqual([
      { position: 0, heading: 'OpenAI kauft Chips', bundleType: 'topic', memberIds: [UNIT_A, UNIT_B], firstParagraph: 'Erster Absatz.' },
      { position: 1, heading: 'Nvidia meldet Zahlen', bundleType: null, memberIds: [UNIT_C], firstParagraph: 'Nvidia-Absatz.' },
    ])
  })

  it('queueItemIds hat Vorrang vor queueItemId; ohne beides ist memberIds leer', () => {
    const content = {
      type: 'doc',
      content: [
        h(2, 'Mit beidem', { queueItemId: UNIT_A, queueItemIds: `${UNIT_B},${UNIT_C}` }),
        h(2, 'Nur Einzel-ID', { queueItemId: UNIT_A }),
        h(2, 'Ohne IDs'),
      ],
    }
    expect(extractPublishedUnits(content).map((u) => u.memberIds)).toEqual([[UNIT_B, UNIT_C], [UNIT_A], []])
  })

  it('memberIds: nur UUIDs, getrimmt, dedupliziert; der String "null" als queueItemId zählt nicht', () => {
    // BEFUND (assisted_ranking.sql:63): queueItemId kommt im Bestand als
    // String 'null' vor — darf keine Member-ID werden.
    const content = {
      type: 'doc',
      content: [
        h(2, 'Gemischt', { queueItemIds: ` ${UNIT_A} , kein-uuid,${UNIT_A},,${UNIT_B}` }),
        h(2, 'Null-String', { queueItemId: 'null' }),
        h(2, 'Nur Müll in queueItemIds, Fallback auf queueItemId', { queueItemId: UNIT_C, queueItemIds: 'x,y' }),
      ],
    }
    expect(extractPublishedUnits(content).map((u) => u.memberIds)).toEqual([[UNIT_A, UNIT_B], [], [UNIT_C]])
  })

  it('H1 und H3 sind keine Einheiten, verschachtelte H2 auch nicht (nur Top-Level)', () => {
    const content = {
      type: 'doc',
      content: [
        h(1, 'H1', { queueItemId: UNIT_A }),
        h(3, 'H3', { queueItemId: UNIT_B }),
        { type: 'blockquote', content: [h(2, 'Zitat-H2', { queueItemId: UNIT_C })] },
        h(2, 'Echte Einheit'),
      ],
    }
    const units = extractPublishedUnits(content)
    expect(units.map((u) => u.heading)).toEqual(['Echte Einheit'])
    expect(units[0].position).toBe(0)
  })

  it('Heading ohne attrs oder mit attrs null ist keine Einheit; Nicht-String-IDs → [], leerer Heading-Text → ""', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading' },
        { type: 'heading', attrs: null },
        { type: 'heading', attrs: { level: 2, queueItemIds: [UNIT_A], queueItemId: 42 }, content: [] },
      ],
    }
    expect(extractPublishedUnits(content)).toEqual([
      { position: 0, heading: '', bundleType: null, memberIds: [], firstParagraph: '' },
    ])
  })

  it('firstParagraph: erster Absatz vor dem nächsten Heading; Listen werden übersprungen; ohne Absatz ""', () => {
    const content = {
      type: 'doc',
      content: [
        h(2, 'Mit Liste davor'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('Listenpunkt')] }] },
        p('Der Absatz nach der Liste.'),
        h(2, 'Direkt gefolgt von Heading'),
        h(3, 'Unterabschnitt'),
        p('Gehört zum H3, nicht zur Einheit.'),
        h(2, 'Am Ende ohne Absatz'),
      ],
    }
    expect(extractPublishedUnits(content).map((u) => u.firstParagraph)).toEqual([
      'Der Absatz nach der Liste.',
      '',
      '',
    ])
  })

  it('heading und firstParagraph konkatenieren mehrere Textknoten (Marks) und ignorieren hardBreak', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, queueItemId: UNIT_A },
          content: [
            { type: 'text', text: 'Apple ' },
            { type: 'text', text: 'Vision', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' Pro' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Satz eins.' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Satz zwei.', marks: [{ type: 'link', attrs: { href: 'https://x' } }] },
          ],
        },
      ],
    }
    const [unit] = extractPublishedUnits(content)
    expect(unit.heading).toBe('Apple Vision Pro')
    expect(unit.firstParagraph).toBe('Satz eins.Satz zwei.')
  })

  it('akzeptiert JSON-String und Array-Wurzel genauso wie das doc-Objekt', () => {
    const nodes = [h(2, 'Als String', { queueItemId: UNIT_A }), p('Absatz.')]
    const asDocString = JSON.stringify({ type: 'doc', content: nodes })
    const asArrayString = JSON.stringify(nodes)
    const expected = [{ position: 0, heading: 'Als String', bundleType: null, memberIds: [UNIT_A], firstParagraph: 'Absatz.' }]
    expect(extractPublishedUnits(asDocString)).toEqual(expected)
    expect(extractPublishedUnits(asArrayString)).toEqual(expected)
    expect(extractPublishedUnits(nodes)).toEqual(expected)
  })

  it('kaputter oder leerer Content → []', () => {
    expect(extractPublishedUnits('{not valid json')).toEqual([])
    expect(extractPublishedUnits('null')).toEqual([])
    expect(extractPublishedUnits(null)).toEqual([])
    expect(extractPublishedUnits(undefined)).toEqual([])
    expect(extractPublishedUnits({})).toEqual([])
    expect(extractPublishedUnits({ type: 'doc', content: 'kein array' })).toEqual([])
    expect(extractPublishedUnits(42)).toEqual([])
  })

  it('bundleType: leerer String oder fehlend → null, sonst der Wert', () => {
    const content = {
      type: 'doc',
      content: [h(2, 'A', { bundleType: '' }), h(2, 'B', { bundleType: 'cover_story' }), h(2, 'C')],
    }
    expect(extractPublishedUnits(content).map((u) => u.bundleType)).toEqual([null, 'cover_story', null])
  })

  it('Review-Fokus 1: Altpost ohne jeden Queue-Marker liefert Einheiten mit memberIds [] statt Abbruch', () => {
    // Posts vor 2026-06 tragen auf den H2 weder queueItemId noch queueItemIds
    // (oder nur auf Bündeln). Die Einheiten müssen trotzdem entstehen — Task 15
    // zählt sie in der Pool-Abdeckung als „nicht attribuierbar", nicht als
    // Fehltreffer; ein leeres Ergebnis würde sie stillschweigend verschwinden lassen.
    const content = {
      type: 'doc',
      content: [
        h(2, 'Alter Abschnitt eins'),
        p('Absatz eins.'),
        h(2, 'Alter Abschnitt zwei', { bundleType: 'topic' }),
        p('Absatz zwei.'),
      ],
    }
    expect(extractPublishedUnits(content)).toEqual([
      { position: 0, heading: 'Alter Abschnitt eins', bundleType: null, memberIds: [], firstParagraph: 'Absatz eins.' },
      { position: 1, heading: 'Alter Abschnitt zwei', bundleType: 'topic', memberIds: [], firstParagraph: 'Absatz zwei.' },
    ])
  })
})
