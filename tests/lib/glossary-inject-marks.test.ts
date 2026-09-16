import { describe, expect, it, vi } from 'vitest'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

// injectGlossaryMarks fragt mit opts.checkContext:true pro Kandidat eine
// Kurzbeschreibung nach (fetchSummaries) — ein echter, wenn auch kleiner
// DB-Zugriff. Diese Datei prueft die MATCHING-Logik, nicht die QS-Schicht
// selbst (die hat ihre eigenen Tests, s. glossary-mention-context-qa.test.ts),
// deshalb hier gemockt: leere Ergebnisliste ⇒ kein Kandidat bekommt eine
// Summary ⇒ die QS greift gar nicht ⇒ exakt das Verhalten von vor dem Umbau.
// fetchSummariesSpy misst zusaetzlich, OB ueberhaupt gefragt wurde — Grundlage
// fuer den Opt-in-Test unten (PROD-BEFUND 2026-09-16, 200-400€/Tag).
const { fetchSummariesSpy } = vi.hoisted(() => ({
  fetchSummariesSpy: vi.fn(async () => ({ data: [], error: null })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: fetchSummariesSpy }) }),
  }),
}))

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
  it('verlinkt einen bestätigten Begriff', async () => {
    const out = await injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    expect(linked(out)).toEqual([{ text: 'Inferenz', slug: 'inferenz' }])
  })

  it('verlinkt nur die erste Erwähnung', async () => {
    const out = await injectGlossaryMarks(doc('Inferenz hier, Inferenz dort.'), ['inferenz'], terms)
    expect(linked(out)).toHaveLength(1)
  })

  it('verlinkt nicht bestätigte Begriffe nicht', async () => {
    const out = await injectGlossaryMarks(doc('Ein MoE-Modell nutzt Inferenz.'), ['inferenz'], terms)
    expect(linked(out).map(l => l.slug)).toEqual(['inferenz'])
  })

  it('ist idempotent — zweimal ausgeführt ändert nichts', async () => {
    const once = await injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const twice = await injectGlossaryMarks(once, ['inferenz'], terms)
    expect(twice).toEqual(once)
  })

  it('entfernt Marks, deren Begriff nicht mehr bestätigt ist', async () => {
    const once = await injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const cleared = await injectGlossaryMarks(once, [], terms)
    expect(linked(cleared)).toEqual([])
  })

  it('verlinkt nicht innerhalb eines bestehenden Links', async () => {
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
    expect(linked(await injectGlossaryMarks(withLink, ['inferenz'], terms))).toEqual([])
  })

  it('überlässt kollidierende Namen der Company- und Produkt-Verlinkung', async () => {
    // Kollisionsregel: spezifisch vor generisch. „Cursor" ist ein
    // Chart-Produkt — auch wenn es als Begriff existiert, darf das Lexikon
    // es nicht verlinken.
    const collide: GlossaryMatcherTerm[] = [
      { slug: 'cursor', canonicalName: 'Cursor', aliases: [] },
    ]
    const out = await injectGlossaryMarks(
      doc('Cursor wächst schnell.'), ['cursor'], collide, { reserved: ['Cursor'] },
    )
    expect(linked(out)).toEqual([])
  })

  it('behält andere Marks am verlinkten Text', async () => {
    const bold = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'bold' }] }],
      }],
    }
    const out = (await injectGlossaryMarks(bold, ['inferenz'], terms)) as {
      content: Array<{ content: Array<{ marks: Array<{ type: string }> }> }>
    }
    expect(out.content[0].content[0].marks.map(m => m.type).sort()).toEqual(['bold', 'glossaryLink'])
  })

  it('verlinkt ALLE vorkommenden Begriffe, ohne Obergrenze', async () => {
    // Bis 2026-08-05 auf GLOSSARY_MAX_PER_ARTICLE (8) gedeckelt, gegen Linkspam
    // im Fließtext. Betreiber-Entscheidung: der Deckel ist raus, jeder erkannte
    // Begriff wird verlinkt. Die Konstante bleibt für die Länge der
    // Sidebar-Liste in detail.ts, sie hat dort einen anderen Zweck.
    const many = Array.from({ length: 12 }, (_, i) => ({
      slug: `t${i}`, canonicalName: `Begriff${i}`, aliases: [],
    }))
    const text = many.map(t => t.canonicalName).join(' und ')
    const out = await injectGlossaryMarks(doc(text), many.map(t => t.slug), many)
    expect(linked(out)).toHaveLength(12)
  })

  it('verlinkt beide Begriffe, wenn die Textreihenfolge der Term-Reihenfolge widerspricht', async () => {
    // Der Fall, der den Missed-Link-Bug erzeugte: 'moe' steht im Text vor
    // 'Inferenz', aber im terms-Array dahinter. Die Term-Reihenfolge kommt in
    // Produktion aus der DB und hat mit der Textposition nichts zu tun.
    const both: GlossaryMatcherTerm[] = [
      { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
      { slug: 'moe', canonicalName: 'MoE', aliases: [] },
    ]
    const out = await injectGlossaryMarks(
      doc('MoE nutzt Inferenz für alles.'), ['inferenz', 'moe'], both,
    )
    expect(linked(out).map(l => l.slug).sort()).toEqual(['inferenz', 'moe'])
  })

  it('ist idempotent auch im widersprüchlichen Fall (Text- vs. Term-Reihenfolge)', async () => {
    const both: GlossaryMatcherTerm[] = [
      { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
      { slug: 'moe', canonicalName: 'MoE', aliases: [] },
    ]
    const once = await injectGlossaryMarks(doc('MoE nutzt Inferenz für alles.'), ['inferenz', 'moe'], both)
    const twice = await injectGlossaryMarks(once, ['inferenz', 'moe'], both)
    expect(twice).toEqual(once)
  })

  it('reserviert auch Aliasse, nicht nur den kanonischen Namen', async () => {
    const t: GlossaryMatcherTerm[] = [{ slug: 'x', canonicalName: 'Etwas Anderes', aliases: ['Cursor'] }]
    expect(linked(await injectGlossaryMarks(doc('Cursor macht viel.'), ['x'], t, { reserved: ['Cursor'] })))
      .toEqual([])
  })
})

describe('injectGlossaryMarks — mehrdeutige Aliasse', () => {
  it('verlinkt einen mehrdeutigen Alias nicht auf den FALSCHEN Begriff', async () => {
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
    const out = await injectGlossaryMarks(doc('Ein eingestuftes Benchmarking-Verfahren.'),
      terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['benchmark'])
  })

  it('verlinkt weiter über den KANONISCHEN Namen, auch wenn ein Alias mehrdeutig ist', async () => {
    const terms = [
      { slug: 'evaluation', canonicalName: 'Evaluation', aliases: ['Benchmarking'] },
      { slug: 'benchmark', canonicalName: 'Benchmark', aliases: ['Benchmarking'] },
    ]
    const out = await injectGlossaryMarks(doc('Der Benchmark zeigt es.'), terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['benchmark'])
  })

  it('verlinkt einen EINDEUTIGEN Alias weiterhin', async () => {
    const terms = [
      { slug: 'evaluation', canonicalName: 'Evaluation', aliases: ['Modellevaluation'] },
      { slug: 'benchmark', canonicalName: 'Benchmark', aliases: ['Leistungstest'] },
    ]
    const out = await injectGlossaryMarks(doc('Die Modellevaluation lief.'), terms.map(t => t.slug), terms)
    expect(linked(out).map(l => l.slug)).toEqual(['evaluation'])
  })
})

describe('injectGlossaryMarks — Wortende (extendToWordEnd)', () => {
  const t = (n: string, s: string) => [{ slug: s, canonicalName: n, aliases: [] }]

  it('nimmt die Pluralendung mit in den Link', async () => {
    // PROD-BEFUND 2026-08-05: "Grafikkarten-Vergleiche" wurde als
    // "[Grafikkarte]n-Vergleiche" verlinkt — das n stand ausserhalb des Links.
    const out = await injectGlossaryMarks(doc('Die Grafikkarten-Vergleiche zeigen es.'),
      ['grafikkarte'], t('Grafikkarte', 'grafikkarte'))
    expect(linked(out)[0].text).toBe('Grafikkarten')
  })

  it('nimmt ein Genitiv-s mit', async () => {
    const out = await injectGlossaryMarks(doc('Des Tokens Wert.'), ['token'], t('Token', 'token'))
    expect(linked(out)[0].text).toBe('Tokens')
  })

  it('dehnt bis zum Wortende, auch ohne bekannte Endung (2026-09-14: kein Fest-Liste mehr)', async () => {
    // Frueher blieb der Treffer bei "Intel" stehen, weil "ligenz" auf keiner
    // kuratierten Endungsliste stand — das Wort sah dann kaputt aus (nur
    // "Intel" verlinkt, "ligenz" bloss daneben). extendToWordEnd zieht den
    // Link seither immer bis zum tatsaechlichen Wortende (Betreiber-Vorgabe:
    // ganzes Wort statt kaputtem Teil). Fuer die ECHTE Firma "Intel" gilt das
    // nicht, die laeuft ueber matchWholeWordInText (s. lib/data/company-exclusions.ts).
    const out = await injectGlossaryMarks(doc('Die Intelligenz wuchs.'), ['intel'], t('Intel', 'intel'))
    expect(linked(out)[0]?.text).toBe('Intelligenz')
  })

  it('nimmt die englische -ing-Form mit in den Link', async () => {
    // BETREIBER-BEFUND 2026-08-14 (Screenshot): Im Take stand „europäisches
    // Host ing" — „Host" war aus „Hosting" herausgelöst und verlinkt, das „ing"
    // blieb als Rest daneben stehen. Diese Texte sind voller englischer
    // Gerundien (Hosting, Training, Prompting), und „ing" ist dort ebenso eine
    // Endung wie „en" im Deutschen.
    const out = await injectGlossaryMarks(doc('Europäisches Hosting hilft.'), ['host'], t('Host', 'host'))
    expect(linked(out)[0]?.text).toBe('Hosting')
  })

  it('zieht den Link über das ganze Kompositum, nicht nur den Erstgliedbegriff', async () => {
    // "Inferenzkosten": "kosten" ist kein flektierender Rest, sondern ein
    // eigenes Wort — extendToWordEnd zieht den Link trotzdem bis zum
    // Wortende, statt nur "Inferenz" zu verlinken und "kosten" abzuschneiden
    // (PROD-BEFUND 2026-09-14, "Abschreibungshorizonte": derselbe Fall).
    const out = await injectGlossaryMarks(doc('Die Inferenzkosten sanken.'), ['inferenz'], t('Inferenz', 'inferenz'))
    expect(linked(out)[0].text).toBe('Inferenzkosten')
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

  it('verlinkt NICHT in der Ueberschrift, sondern im Fliesstext', async () => {
    // Ein Link in der Ueberschrift stoert die Typografie — und weil jeder Begriff
    // nur EINMAL verlinkt wird, war er danach fuer den Fliesstext verbraucht.
    const out = (await injectGlossaryMarks(docWithHeading(), ['inferenz'], terms)) as {
      content: Array<{ type: string; content: Array<{ marks?: Array<{ type: string }> }> }>
    }
    const heading = out.content[0]
    const paragraph = out.content[1]
    expect(heading.content[0].marks ?? []).toEqual([])
    expect((paragraph.content.find(n => n.marks?.some(m => m.type === 'glossaryLink')))).toBeTruthy()
  })

  it('laesst den Ueberschriftentext unveraendert', async () => {
    const out = (await injectGlossaryMarks(docWithHeading(), ['inferenz'], terms)) as {
      content: Array<{ content: Array<{ text?: string }> }>
    }
    expect(out.content[0].content.map(n => n.text).join('')).toBe('Inferenz wird teurer')
  })
})

describe('injectGlossaryMarks — Erwähnungs-Kontext-QS ist Opt-in', () => {
  // PROD-BEFUND 2026-09-16: die QS war zunaechst fuer ALLE Aufrufer an. Der
  // taegliche "relink"-Job (backfill.ts) laeuft aber im Ein-Minuten-Cron-Takt
  // ENDLOS durch den gesamten Artikelbestand (Cursor setzt sich am Ende
  // zurueck) und war laut eigenem Kommentar dort ausdruecklich "kein
  // Kostenrisiko: macht keine Modell-Aufrufe" — jede bereits korrekt
  // verlinkte Fundstelle bekam bei JEDEM Zyklus erneut einen LLM-Aufruf,
  // unbegrenzt oft am Tag (200-400€/Tag). Diese Tests sichern das Opt-in ab.
  const terms = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]

  it('fragt OHNE checkContext keine Kurzbeschreibung ab (kein DB-Zusatzaufruf)', async () => {
    fetchSummariesSpy.mockClear()
    await injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    expect(fetchSummariesSpy).not.toHaveBeenCalled()
  })

  it('fragt MIT checkContext:true eine Kurzbeschreibung ab', async () => {
    fetchSummariesSpy.mockClear()
    await injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms, { checkContext: true })
    expect(fetchSummariesSpy).toHaveBeenCalled()
  })
})
