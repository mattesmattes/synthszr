import { describe, expect, it } from 'vitest'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const terms: GlossaryMatcherTerm[] = [
  { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  { slug: 'moe', canonicalName: 'Mixture of Experts', aliases: ['MoE'] },
]

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Sammelt alle Textknoten mit glossaryLink-Mark, flach. */
function linked(node: unknown): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const mark = marks.find((m) => (m as { type?: string }).type === 'glossaryLink')
    if (typeof o.text === 'string' && mark) {
      out.push({ text: o.text, slug: (mark as { attrs: { slug: string } }).attrs.slug })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

describe('injectGlossaryMarks', () => {
  it('verlinkt einen bestätigten Begriff', () => {
    const out = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    expect(linked(out)).toEqual([{ text: 'Inferenz', slug: 'inferenz' }])
  })

  it('verlinkt nur die erste Erwähnung', () => {
    const out = injectGlossaryMarks(doc('Inferenz hier, Inferenz dort.'), ['inferenz'], terms)
    expect(linked(out)).toHaveLength(1)
  })

  it('verlinkt nicht bestätigte Begriffe nicht', () => {
    const out = injectGlossaryMarks(doc('Ein MoE-Modell nutzt Inferenz.'), ['inferenz'], terms)
    expect(linked(out).map(l => l.slug)).toEqual(['inferenz'])
  })

  it('ist idempotent — zweimal ausgeführt ändert nichts', () => {
    const once = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const twice = injectGlossaryMarks(once, ['inferenz'], terms)
    expect(twice).toEqual(once)
  })

  it('entfernt Marks, deren Begriff nicht mehr bestätigt ist', () => {
    const once = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const cleared = injectGlossaryMarks(once, [], terms)
    expect(linked(cleared)).toEqual([])
  })

  it('verlinkt nicht innerhalb eines bestehenden Links', () => {
    const withLink = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'Inferenz',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    }
    expect(linked(injectGlossaryMarks(withLink, ['inferenz'], terms))).toEqual([])
  })

  it('überlässt kollidierende Namen der Company- und Produkt-Verlinkung', () => {
    // Kollisionsregel: spezifisch vor generisch. „Cursor" ist ein
    // Chart-Produkt — auch wenn es als Begriff existiert, darf das Lexikon
    // es nicht verlinken.
    const collide: GlossaryMatcherTerm[] = [
      { slug: 'cursor', canonicalName: 'Cursor', aliases: [] },
    ]
    const out = injectGlossaryMarks(
      doc('Cursor wächst schnell.'), ['cursor'], collide, { reserved: ['Cursor'] },
    )
    expect(linked(out)).toEqual([])
  })

  it('behält andere Marks am verlinkten Text', () => {
    const bold = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'bold' }] }],
      }],
    }
    const out = injectGlossaryMarks(bold, ['inferenz'], terms) as {
      content: Array<{ content: Array<{ marks: Array<{ type: string }> }> }>
    }
    expect(out.content[0].content[0].marks.map(m => m.type).sort()).toEqual(['bold', 'glossaryLink'])
  })

  it('verlinkt ALLE vorkommenden Begriffe, ohne Obergrenze', () => {
    // Bis 2026-08-05 auf GLOSSARY_MAX_PER_ARTICLE (8) gedeckelt, gegen Linkspam
    // im Fließtext. Betreiber-Entscheidung: der Deckel ist raus, jeder erkannte
    // Begriff wird verlinkt. Die Konstante bleibt für die Länge der
    // Sidebar-Liste in detail.ts, sie hat dort einen anderen Zweck.
    const many = Array.from({ length: 12 }, (_, i) => ({
      slug: `t${i}`, canonicalName: `Begriff${i}`, aliases: [],
    }))
    const text = many.map(t => t.canonicalName).join(' und ')
    const out = injectGlossaryMarks(doc(text), many.map(t => t.slug), many)
    expect(linked(out)).toHaveLength(12)
  })

  it('verlinkt beide Begriffe, wenn die Textreihenfolge der Term-Reihenfolge widerspricht', () => {
    // Der Fall, der den Missed-Link-Bug erzeugte: 'moe' steht im Text vor
    // 'Inferenz', aber im terms-Array dahinter. Die Term-Reihenfolge kommt in
    // Produktion aus der DB und hat mit der Textposition nichts zu tun.
    const both: GlossaryMatcherTerm[] = [
      { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
      { slug: 'moe', canonicalName: 'MoE', aliases: [] },
    ]
    const out = injectGlossaryMarks(
      doc('MoE nutzt Inferenz für alles.'), ['inferenz', 'moe'], both,
    )
    expect(linked(out).map(l => l.slug).sort()).toEqual(['inferenz', 'moe'])
  })

  it('ist idempotent auch im widersprüchlichen Fall (Text- vs. Term-Reihenfolge)', () => {
    const both: GlossaryMatcherTerm[] = [
      { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
      { slug: 'moe', canonicalName: 'MoE', aliases: [] },
    ]
    const once = injectGlossaryMarks(doc('MoE nutzt Inferenz für alles.'), ['inferenz', 'moe'], both)
    const twice = injectGlossaryMarks(once, ['inferenz', 'moe'], both)
    expect(twice).toEqual(once)
  })

  it('reserviert auch Aliasse, nicht nur den kanonischen Namen', () => {
    const t: GlossaryMatcherTerm[] = [{ slug: 'x', canonicalName: 'Etwas Anderes', aliases: ['Cursor'] }]
    expect(linked(injectGlossaryMarks(doc('Cursor macht viel.'), ['x'], t, { reserved: ['Cursor'] })))
      .toEqual([])
  })
})

describe('injectGlossaryMarks — mehrdeutige Aliasse', () => {
  it('verlinkt einen mehrdeutigen Alias nicht auf den FALSCHEN Begriff', () => {
    // PROD-BEFUND 2026-08-05: "Benchmarking" wurde auf /glossary/evaluation
    // verlinkt, obwohl es einen eigenen Begriff "Benchmark" gibt — der Alias steht
    // bei BEIDEN, und gewonnen hat, wer in der DB-Reihenfolge vorne stand.
    //
    // Der mehrdeutige Alias faellt jetzt aus. Uebrig bleibt der Treffer ueber den
    // kanonischen Namen "Benchmark" (die Kompositum-Regel erlaubt Grenzen nur
    // davor, "Benchmarking" enthaelt also "Benchmark") — und der zeigt auf die
    // RICHTIGE Seite. Genau das ist erwuenscht.
    const terms = [
      { slug: 'evaluation', canonicalName: 'Evaluation', aliases: ['Benchmarking'] },
      { slug: 'benchmark', canonicalName: 'Benchmark', aliases: ['Benchmarking'] },
    ]
    const out = injectGlossaryMarks(doc('Ein eingestuftes Benchmarking-Verfahren.'),
      terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['benchmark'])
  })

  it('verlinkt weiter über den KANONISCHEN Namen, auch wenn ein Alias mehrdeutig ist', () => {
    const terms = [
      { slug: 'evaluation', canonicalName: 'Evaluation', aliases: ['Benchmarking'] },
      { slug: 'benchmark', canonicalName: 'Benchmark', aliases: ['Benchmarking'] },
    ]
    const out = injectGlossaryMarks(doc('Der Benchmark zeigt es.'), terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['benchmark'])
  })

  it('verlinkt einen EINDEUTIGEN Alias weiterhin', () => {
    const terms = [
      { slug: 'evaluation', canonicalName: 'Evaluation', aliases: ['Modellevaluation'] },
      { slug: 'benchmark', canonicalName: 'Benchmark', aliases: ['Leistungstest'] },
    ]
    const out = injectGlossaryMarks(doc('Die Modellevaluation lief.'), terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['evaluation'])
  })
})

describe('injectGlossaryMarks — Flexionsendungen', () => {
  const t = (n: string, s: string) => [{ slug: s, canonicalName: n, aliases: [] }]

  it('nimmt die Pluralendung mit in den Link', () => {
    // PROD-BEFUND 2026-08-05: "Grafikkarten-Vergleiche" wurde als
    // "[Grafikkarte]n-Vergleiche" verlinkt — das n stand ausserhalb des Links.
    const out = injectGlossaryMarks(doc('Die Grafikkarten-Vergleiche zeigen es.'),
      ['grafikkarte'], t('Grafikkarte', 'grafikkarte'))
    expect(linked(out)[0].text).toBe('Grafikkarten')
  })

  it('nimmt ein Genitiv-s mit', () => {
    const out = injectGlossaryMarks(doc('Des Tokens Wert.'), ['token'], t('Token', 'token'))
    expect(linked(out)[0].text).toBe('Tokens')
  })

  it('dehnt NICHT auf ein anderes Wort aus', () => {
    // "Intelligenz" ist keine Flexion von "Intel" — "ligenz" steht nicht in der
    // Endungsliste. Der Kompositum-Treffer bleibt, wie er ist.
    const out = injectGlossaryMarks(doc('Die Intelligenz wuchs.'), ['intel'], t('Intel', 'intel'))
    expect(linked(out)[0]?.text).toBe('Intel')
  })

  it('nimmt die englische -ing-Form mit in den Link', () => {
    // BETREIBER-BEFUND 2026-08-14 (Screenshot): Im Take stand „europäisches
    // Host ing" — „Host" war aus „Hosting" herausgelöst und verlinkt, das „ing"
    // blieb als Rest daneben stehen. Diese Texte sind voller englischer
    // Gerundien (Hosting, Training, Prompting), und „ing" ist dort ebenso eine
    // Endung wie „en" im Deutschen.
    const out = injectGlossaryMarks(doc('Europäisches Hosting hilft.'), ['host'], t('Host', 'host'))
    expect(linked(out)[0]?.text).toBe('Hosting')
  })

  it('lässt ein Kompositum unangetastet', () => {
    // "Inferenzkosten": "kosten" ist keine Flexionsendung, der Link umfasst
    // weiterhin nur den Begriff.
    const out = injectGlossaryMarks(doc('Die Inferenzkosten sanken.'), ['inferenz'], t('Inferenz', 'inferenz'))
    expect(linked(out)[0].text).toBe('Inferenz')
  })
})

describe('injectGlossaryMarks — Ueberschriften', () => {
  const terms = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]

  function docWithHeading() {
    return {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 },
          content: [{ type: 'text', text: 'Inferenz wird teurer' }] },
        { type: 'paragraph',
          content: [{ type: 'text', text: 'Die Inferenz kostet Rechenzeit.' }] },
      ],
    }
  }

  it('verlinkt NICHT in der Ueberschrift, sondern im Fliesstext', () => {
    // Ein Link in der Ueberschrift stoert die Typografie — und weil jeder Begriff
    // nur EINMAL verlinkt wird, war er danach fuer den Fliesstext verbraucht.
    const out = injectGlossaryMarks(docWithHeading(), ['inferenz'], terms) as {
      content: Array<{ type: string; content: Array<{ marks?: Array<{ type: string }> }> }>
    }
    const heading = out.content[0]
    const paragraph = out.content[1]
    expect(heading.content[0].marks ?? []).toEqual([])
    expect((paragraph.content.find(n => n.marks?.some(m => m.type === 'glossaryLink')))).toBeTruthy()
  })

  it('laesst den Ueberschriftentext unveraendert', () => {
    const out = injectGlossaryMarks(docWithHeading(), ['inferenz'], terms) as {
      content: Array<{ content: Array<{ text?: string }> }>
    }
    expect(out.content[0].content.map(n => n.text).join('')).toBe('Inferenz wird teurer')
  })
})
