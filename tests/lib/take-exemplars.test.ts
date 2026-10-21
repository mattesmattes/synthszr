/**
 * Stufe 3 der Take-Reform (2026-10-19): veröffentlichte eigene Takes als
 * Vorbilder im Prompt. Bisher sah das Modell frühere Posts nur als Titel und
 * Teaser; Stimme und Dichte des Betreibers blieben außen vor. Die Auswahl
 * nutzt die Leser-Votes aus take_feedback (Anker = queueItemId der H2, sonst
 * idx:N wie im Take-Barometer) und bevorzugt Takes in der neuen Form.
 */
import { describe, expect, it } from 'vitest'
import { extractTakes, pickExemplars, formatExemplarTakesForPrompt, type ExemplarCandidate } from '@/lib/posts/take-exemplars'

const h = (text: string, queueItemId: string | null = null) => ({ type: 'heading', attrs: { level: 2, queueItemId }, content: [{ type: 'text', text }] })
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('extractTakes', () => {
  it('liefert je H2 den Take mit Anker aus queueItemId, sonst idx:N in Take-Reihenfolge', () => {
    const doc = { type: 'doc', content: [
      h('Erste News', 'id-1'), p('Bericht.'), p('Synthszr Take: Take eins.'),
      h('Ohne Take', 'id-2'), p('Nur Bericht.'),
      h('Dritte News'), p('Bericht.'), p('Synthszr Take: Take drei.'),
    ] }
    expect(extractTakes(doc)).toEqual([
      { heading: 'Erste News', anchor: 'id-1', take: 'Take eins.' },
      { heading: 'Dritte News', anchor: 'idx:1', take: 'Take drei.' },
    ])
  })

  it('kommt mit fehlerhaftem Inhalt klar', () => {
    expect(extractTakes(null)).toEqual([])
    expect(extractTakes({ type: 'doc' })).toEqual([])
  })
})

const cand = (over: Partial<ExemplarCandidate>): ExemplarCandidate => ({
  postId: 'p', title: 'Titel', date: '2026-10-01', heading: 'Nvidia kauft Chips', anchor: 'a',
  take: 'Nvidia zahlt 13 Milliarden für Hugging Face. Der Preis kauft Distribution, keine Modelle. Entscheidend wird die Zahl der Downloads im ersten Quartal.',
  agree: 0, disagree: 0, ...over,
})

describe('pickExemplars', () => {
  it('ordnet nach thematischer Naehe zur Anfrage', () => {
    const near = cand({ anchor: 'near' })
    const far = cand({ anchor: 'far', heading: 'Apple Watch misst Schlaf', take: 'Die Uhr misst Schlaf so genau wie das Labor. Oura verliert damit sein Alleinstellungsmerkmal. Der Test sind die Abo-Zahlen bis Jahresende.' })
    const out = pickExemplars([far, near], 'Nvidia übernimmt Hugging Face: Distribution statt Modelle', 2)
    expect(out[0].anchor).toBe('near')
  })

  it('schliesst Takes mit klarer Ablehnung aus und hebt zugestimmte an', () => {
    const liked = cand({ anchor: 'liked', agree: 6, disagree: 1 })
    const plain = cand({ anchor: 'plain' })
    const disliked = cand({ anchor: 'disliked', agree: 1, disagree: 5 })
    const out = pickExemplars([plain, disliked, liked], 'Nvidia Hugging Face Distribution', 3)
    expect(out.map((t) => t.anchor)).toEqual(['liked', 'plain'])
  })

  it('bevorzugt Takes in der Zielform (40 bis 90 Woerter) vor langen', () => {
    const lang = cand({ anchor: 'lang', take: Array.from({ length: 130 }, () => 'Nvidia').join(' ') + '.' })
    const kurz = cand({ anchor: 'kurz' })
    const out = pickExemplars([lang, kurz], 'Nvidia Hugging Face', 2)
    expect(out[0].anchor).toBe('kurz')
  })

  it('begrenzt auf limit und gibt bei leerer Eingabe nichts zurueck', () => {
    expect(pickExemplars([], 'x', 3)).toEqual([])
    expect(pickExemplars([cand({ anchor: '1' }), cand({ anchor: '2' }), cand({ anchor: '3' }), cand({ anchor: '4' })], 'Nvidia', 3)).toHaveLength(3)
  })
})

describe('formatExemplarTakesForPrompt', () => {
  it('nennt Titel, Datum, Abschnitt, Zustimmung und den Take; verbietet das Abschreiben', () => {
    const block = formatExemplarTakesForPrompt([cand({ agree: 7, disagree: 3 })])
    expect(block).toContain('SO SCHREIBT MATTES SEINE TAKES')
    // Betreiber 2026-10-21: Vorbilder geben Haltung und Ton vor, nicht Dichte und Satzbau — die alten Takes waren verschachtelt.
    expect(block).toContain('übernimm Haltung und Ton, NICHT den Satzbau')
    expect(block).not.toMatch(/Dichte/)
    expect(block).toContain('„Titel"')
    expect(block).toContain('Nvidia kauft Chips')
    expect(block).toContain('70 %')
    expect(block).toContain('Nvidia zahlt 13 Milliarden')
    expect(block).toMatch(/NICHT die Formulierungen/)
  })

  it('leer ohne Beispiele', () => {
    expect(formatExemplarTakesForPrompt([])).toBe('')
  })
})
