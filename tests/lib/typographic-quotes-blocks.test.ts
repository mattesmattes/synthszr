/**
 * Anführungszeichen auf BLOCKEBENE.
 *
 * Anlass sind zwei Fehler, an einer echten Seite gesehen
 * (/de/glossary/transformer): `Titel "Attention Is All You Need„` und `Das “T"`.
 *
 * Beide haben dieselbe Wurzel: der Zustandsautomat lief pro Textknoten, ein
 * Zitat läuft aber über Knotengrenzen. Die Mark-Injektion der Lexikon-
 * Verlinkung teilt einen Absatz in mehrere Textknoten, sobald sie einen Begriff
 * im Zitat verlinkt — öffnendes und schließendes Zeichen liegen dann in
 * verschiedenen Knoten, und „ist offen" beginnt in jedem neu. Dazu liefern die
 * Modelle schon gemischte Zeichen (`"`, `“`, `„`); ersetzt wurden nur die
 * geraden, wodurch die Mischung erst entstand.
 */
import { describe, expect, it } from 'vitest'
import { applyTypographicQuotes } from '@/lib/typography/quotes'

type Node = Record<string, unknown>

function text(t: string): Node {
  return { type: 'text', text: t }
}

/** Textknoten mit Link-Mark — so sieht ein von der Verlinkung geteilter Knoten aus. */
function linked(t: string, href = '/de/glossary/transformer'): Node {
  return { type: 'text', text: t, marks: [{ type: 'link', attrs: { href } }] }
}

function para(...kids: Array<Node | string>): Node {
  return {
    type: 'paragraph',
    content: kids.map((k) => (typeof k === 'string' ? text(k) : k)),
  }
}

function doc(...nodes: Node[]): Node {
  return { type: 'doc', content: nodes }
}

/** Fügt alle Textknoten in Dokumentreihenfolge zusammen — so liest es der Leser. */
function flatten(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const o = node as Record<string, unknown>
  if (typeof o.text === 'string') return o.text
  if (Array.isArray(o.content)) return o.content.map(flatten).join('')
  return ''
}

function run(d: Node, lang = 'de'): string {
  return flatten(applyTypographicQuotes(d, lang))
}

describe('applyTypographicQuotes: Paare über Knotengrenzen', () => {
  it('paart ein Zitat, das über zwei Textknoten läuft', () => {
    expect(run(doc(para('Er nannte es "Fort', 'schritt".')))).toBe('Er nannte es „Fortschritt“.')
  })

  it('paart ein Zitat um einen verlinkten Begriff — der Prod-Fehler', () => {
    // Genau die Form, die die Mark-Injektion erzeugt: das öffnende Zeichen im
    // ersten Knoten, der verlinkte Begriff dazwischen, das schließende danach.
    const d = doc(para('Titel "', linked('Attention Is All You Need'), '" von 2017'))
    expect(run(d)).toBe('Titel „Attention Is All You Need“ von 2017')
  })

  it('behält die Link-Mark am mittleren Knoten', () => {
    const d = doc(para('Titel "', linked('Attention Is All You Need'), '" von 2017'))
    const out = applyTypographicQuotes(d, 'de') as Node
    const kids = (out.content as Node[])[0].content as Node[]
    expect(kids[1].marks).toEqual([{ type: 'link', attrs: { href: '/de/glossary/transformer' } }])
  })

  it('normalisiert vom Modell gemischte Zeichen', () => {
    // `Das “T"` und `…Need„` sind beide so auf Prod gelandet.
    expect(run(doc(para('Titel "Attention Is All You Need„')))).toBe('Titel „Attention Is All You Need“')
    expect(run(doc(para('Das “T"')))).toBe('Das „T“')
  })

  it('ist idempotent: bereits typografischer Text bleibt, wie er ist', () => {
    const already = 'Er nannte es „Fortschritt“.'
    expect(run(doc(para(already)))).toBe(already)
  })

  it('lässt ein unpaariges Zollzeichen stehen, auch über Knoten verteilt', () => {
    expect(run(doc(para('Der Bildschirm ist 24" groß.')))).toBe('Der Bildschirm ist 24" groß.')
    expect(run(doc(para('Der Bildschirm ist 24', '" groß.')))).toBe('Der Bildschirm ist 24" groß.')
  })

  it('paart NICHT über Absatzgrenzen hinweg', () => {
    // Zwei Absätze sind zwei Blöcke. Ein `"` am Ende des einen und eines am
    // Anfang des anderen sind kein Paar — sonst würde ein vergessenes
    // Zollzeichen ein Zitat über den halben Artikel aufziehen.
    const d = doc(para('Ein "Zitat'), para('anderer Absatz"'))
    expect(run(d)).toBe('Ein "Zitatanderer Absatz"')
  })

  it('behandelt mehrere Paare in einem Block getrennt', () => {
    expect(run(doc(para('"A" und ', linked('B'), ' sowie "C"')))).toBe('„A“ und B sowie „C“')
  })

  it('setzt in Überschriften genauso wie in Absätzen', () => {
    const d = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Was "Attention" heißt')] })
    expect(run(d)).toBe('Was „Attention“ heißt')
  })

  it('trägt die Sprache in die Blockebene: Englisch bekommt “…”', () => {
    const d = doc(para('He called it "', linked('progress'), '" once'))
    expect(run(d, 'en')).toBe('He called it “progress” once')
  })
})
