/**
 * Firmennamen im Lexikon-Erklärtext werden auf /[lang]/stocks/[ticker] verlinkt.
 *
 * Serverseitig, weil die Lexikonseite ihren Text über renderStaticArticleHtml
 * rendert und keinen Client-Renderer hat — die DOM-Prozessoren, die das in
 * Artikeln übernehmen, kommen dort nie zum Zug.
 */
import { describe, expect, it } from 'vitest'
import { injectStockLinks } from '@/lib/glossary/inject-stock-links'

function doc(...texts: string[]) {
  return {
    type: 'doc',
    content: texts.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  }
}

/** Sammelt alle Textknoten mit link-Mark, flach. */
function links(node: unknown): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const link = marks.find((m) => (m as { type?: string }).type === 'link')
    if (typeof o.text === 'string' && link) {
      out.push({ text: o.text, href: (link as { attrs: { href: string } }).attrs.href })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

/** Gesamttext, um Textverlust beim Splitten auszuschließen. */
function plain(node: unknown): string {
  const walk = (n: unknown): string => {
    if (!n || typeof n !== 'object') return ''
    const o = n as Record<string, unknown>
    const self = typeof o.text === 'string' ? o.text : ''
    const kids = Array.isArray(o.content) ? o.content.map(walk).join('') : ''
    return self + kids
  }
  return walk(node)
}

describe('injectStockLinks', () => {
  it('verlinkt einen börsennotierten Firmennamen auf seinen Ticker', () => {
    const result = injectStockLinks(doc('Nvidia baut die Chips dafür.'), 'de')
    expect(links(result)).toEqual([{ text: 'Nvidia', href: '/de/stocks/nvda' }])
  })

  it('nutzt das Sprachsegment der gerenderten Seite', () => {
    const result = injectStockLinks(doc('Nvidia baut die Chips dafür.'), 'en')
    expect(links(result)[0].href).toBe('/en/stocks/nvda')
  })

  it('verliert keinen Text beim Aufspalten des Knotens', () => {
    const text = 'Sowohl Nvidia als auch andere Anbieter liefern Hardware.'
    const result = injectStockLinks(doc(text), 'de')
    expect(plain(result)).toBe(text)
  })

  it('verlinkt dieselbe Firma nur EINMAL, auch bei mehreren Nennungen', () => {
    // Fünf identische Links auf denselben Namen wären Linkspam statt Hilfe.
    const result = injectStockLinks(
      doc('Nvidia liefert.', 'Auch Nvidia profitiert.', 'Nvidia wieder.'),
      'de',
    )
    expect(links(result)).toHaveLength(1)
  })

  it('findet eine zweite Firma im selben Textknoten, egal auf welcher Seite', () => {
    // Wird nur der Teil HINTER dem Treffer weitergesucht, bleibt die Firma davor
    // unverlinkt — die Fehlerklasse, die bei den Glossar-Marks als Critical
    // gemeldet wurde (nur 'after' rekursiv gewalkt).
    //
    // DIE REIHENFOLGE IM SATZ IST ENTSCHEIDEND, damit dieser Test überhaupt
    // etwas prüft: die Firmenliste ist nach Namenslänge sortiert, "Microsoft"
    // (9 Zeichen) wird also vor "Nvidia" (6) getroffen. Steht Microsoft vorne,
    // ist `before` leer und der Pfad wird nie berührt — mit umgekehrter
    // Reihenfolge deaktiviert (per Gegenprobe geprüft) fällt der Test.
    const result = injectStockLinks(doc('Nvidia und Microsoft arbeiten zusammen.'), 'de')
    const hrefs = links(result).map((l) => l.href).sort()
    expect(hrefs).toEqual(['/de/stocks/msft', '/de/stocks/nvda'])
  })

  it('verlinkt eine NICHT börsennotierte Firma nicht', () => {
    // OpenAI steht in KNOWN_COMPANIES, hat aber keinen Ticker — die Zielseite
    // antwortete mit notFound(), der Link ginge ins Leere.
    const result = injectStockLinks(doc('OpenAI hat das Modell veröffentlicht.'), 'de')
    expect(links(result)).toEqual([])
  })

  it('rührt Text mit bestehender Mark nicht an', () => {
    // Ein Firmenname innerhalb eines Glossar-Links darf nicht doppelt verlinkt
    // werden — verschachtelte <a> sind ungültiges HTML.
    const withMark = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Nvidia',
          marks: [{ type: 'glossaryLink', attrs: { slug: 'gpu' } }],
        }],
      }],
    }
    const result = injectStockLinks(withMark, 'de')
    expect(links(result)).toEqual([])
  })

  it('ignoriert Allerweltswörter aus der Ausschlussliste', () => {
    // "Experte"/"Insider" stehen in EXCLUDED_COMPANY_NAMES: sie sehen wie
    // Firmennamen aus, sind aber gewöhnliche Substantive.
    const result = injectStockLinks(doc('Ein Experte erklärte den Insider-Handel.'), 'de')
    expect(links(result)).toEqual([])
  })

  it('trifft keinen Namen, der Teil eines längeren Wortes ist', () => {
    const result = injectStockLinks(doc('Die Applikation läuft stabil.'), 'de')
    expect(links(result).map((l) => l.href)).not.toContain('/de/stocks/aapl')
  })

  it('lässt ein Dokument ohne Firmennamen unverändert', () => {
    const input = doc('Ein Modell rechnet und antwortet.')
    const result = injectStockLinks(input, 'de')
    expect(links(result)).toEqual([])
    expect(plain(result)).toBe(plain(input))
  })
})
