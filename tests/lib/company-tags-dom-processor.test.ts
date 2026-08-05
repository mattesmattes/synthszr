/**
 * hideExplicitCompanyTags — die drei Darstellungsfehler vom 2026-08-05.
 *
 * Alle drei kamen aus diesem Prozessor, und alle drei an echten Seiten gesehen:
 *
 *   1. „{lex:Prompt Injection}" stand mit Klammern im Text. Das Muster
 *      \{([^}]+)\} findet einen Tag nicht mehr, wenn die Mark-Injektion den
 *      Textknoten aufgespalten hat: `{lex:` | Link | `}` sind drei Knoten.
 *   2. „eingestuftesBenchmarking" — das Leerzeichen vor dem Link fehlte, weil
 *      der Prozessor jeden angefassten Textknoten trimmt. An einer Knotengrenze
 *      ist dieses Leerzeichen bedeutungstragend.
 *   3. „{lex:Frontier Model}" verschwand samt Begriff, wo der Tag in EINEM Knoten
 *      stand — das Muster für {Company} lief ungeprüft über {lex:} mit, obwohl
 *      dort der Begriff STEHEN BLEIBEN muss.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { hideExplicitCompanyTags } from '@/lib/tiptap/dom-processors/company-tags'

describe('hideExplicitCompanyTags', () => {
  let dom: JSDOM
  const originalDocument = globalThis.document

  function render(html: string): string {
    dom = new JSDOM(`<div id="c">${html}</div>`)
    ;(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document
    // NodeFilter kommt aus dem DOM-Global, nicht aus document — createTreeWalker
    // braucht beides.
    ;(globalThis as unknown as { NodeFilter: unknown }).NodeFilter = dom.window.NodeFilter
    const el = dom.window.document.getElementById('c')!
    hideExplicitCompanyTags(el as unknown as HTMLElement)
    return el.textContent ?? ''
  }

  afterEach(() => {
    ;(globalThis as unknown as { document: Document }).document = originalDocument
  })

  it('entfernt einen {Company}-Tag samt Klammern und Inhalt', () => {
    expect(render('<p>Der Chip von {Nvidia} ist knapp.</p>')).toBe('Der Chip von ist knapp.')
  })

  it('behält bei {lex:Begriff} den BEGRIFF und entfernt nur die Klammern', () => {
    // Fall 3: vorher verschwand der Begriff mit, weil das {Company}-Muster
    // ungeprüft über den lex-Tag mitlief.
    expect(render('<p>Ein {lex:Frontier Model} unter dem Verfahren.</p>'))
      .toBe('Ein Frontier Model unter dem Verfahren.')
  })

  it('entfernt die Klammern auch, wenn der Tag über DREI Knoten gesplittet ist', () => {
    // Fall 1: so sieht das DOM aus, nachdem die Mark-Injektion den Begriff
    // innerhalb des Tags verlinkt hat.
    const out = render('<p>Versuch der {lex:<a class="glossary-link">Prompt Injection</a>}. Das AISI testet.</p>')
    expect(out).toBe('Versuch der Prompt Injection. Das AISI testet.')
  })

  it('lässt das Leerzeichen VOR einem Link stehen', () => {
    // Fall 2: der Trim fraß es. Zwei Textknoten, der erste endet mit Leerzeichen.
    const out = render('<p>ein eingestuftes <a class="glossary-link">Benchmarking</a>-Verfahren</p>')
    expect(out).toBe('ein eingestuftes Benchmarking-Verfahren')
  })

  it('lässt das Leerzeichen NACH einem Link stehen', () => {
    const out = render('<p>im <a class="glossary-link">Sandbox</a> und schaltet ab</p>')
    expect(out).toBe('im Sandbox und schaltet ab')
  })

  it('rührt Text ohne Tags nicht an', () => {
    const text = '  Zwei  Leerzeichen   bleiben.  '
    expect(render(`<p>${text}</p>`)).toBe(text)
  })
})
