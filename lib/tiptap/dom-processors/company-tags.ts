// DOM processor: versteckt Direktiv-Tags im gerenderten Text.

/**
 * Entfernt `{Company}`- und `{lex:Begriff}`-Direktiven aus dem sichtbaren Text.
 *
 * ZWEI TAGSORTEN MIT UNTERSCHIEDLICHER REGEL:
 *   {Nvidia}             → ganz weg (der Name steht ohnehin im Fließtext)
 *   {lex:Frontier Model} → nur die Klammern weg, DER BEGRIFF BLEIBT
 *
 * Bis 2026-08-05 lief hier ein einziges Muster `\{([^}]+)\}` über beide und
 * entfernte den Lexikonbegriff mit — an einer echten Seite gesehen, wo
 * „{lex:Frontier Model}" samt Begriff aus dem Satz verschwand.
 *
 * KNOTENÜBERGREIFEND, und das ist der Kern: hat die Mark-Injektion den Begriff
 * INNERHALB des Tags verlinkt, steht der Tag als drei Knoten im DOM —
 * `{lex:` | <a>Begriff</a> | `}`. Ein Muster, das den ganzen Tag in EINEM
 * Textknoten sucht, findet ihn dann nicht mehr; die Klammern blieben sichtbar
 * („{lex:Prompt Injection}"). Deshalb wird das öffnende Fragment einzeln entfernt
 * und die zugehörige schließende Klammer über einen Zustand nachgezogen.
 *
 * KEIN TRIM, KEIN WHITESPACE-KOLLAPS: vorher stand hier
 * `text.replace(/\s+/g,' ').trim()`. An einer Knotengrenze ist das führende oder
 * abschließende Leerzeichen bedeutungstragend — daraus entstand
 * „eingestuftesBenchmarking" und „Sandboxund". Ersetzt wird nur der Tag.
 */
export function hideExplicitCompanyTags(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)

  const nodes: Text[] = []
  let textNode: Text | null
  while ((textNode = walker.nextNode() as Text | null)) nodes.push(textNode)

  /** Steht eine schließende Klammer aus, weil ihr `{lex:` in einem früheren
   *  Knoten entfernt wurde? */
  let lexOpen = false

  for (const node of nodes) {
    const before = node.textContent ?? ''
    let text = before

    // 1. Vollständige lex-Tags: Klammern weg, Begriff behalten.
    text = text.replace(/\{lex:([^{}]*)\}/g, '$1')

    // 2. Offenes Fragment `{lex:` ohne schließende Klammer im selben Knoten.
    //    Eindeutiges Muster, deshalb gefahrlos entfernbar.
    if (/\{lex:/.test(text)) {
      text = text.replace(/\{lex:/g, '')
      lexOpen = true
    } else if (lexOpen) {
      // 3. Die zugehörige schließende Klammer — nur die ERSTE, und nur wenn
      //    tatsächlich eine aussteht. Ein `}` in normalem Text bleibt damit
      //    unangetastet.
      const i = text.indexOf('}')
      if (i !== -1) {
        text = text.slice(0, i) + text.slice(i + 1)
        lexOpen = false
      }
    }

    // 4. {Company}-Tags: ganz weg, MIT dem Leerzeichen davor. NACH den
    //    lex-Regeln, sonst nähme das allgemeine Muster den Lexikonbegriff mit.
    //
    //    Das führende Leerzeichen muss mit, sonst bleibt eine Lücke: aus
    //    „von {Nvidia} ist" würde „von  ist". Gezielt hier statt global über den
    //    ganzen Knoten zu kollabieren — genau das hat die Leerzeichen an den
    //    Knotengrenzen gefressen.
    text = text.replace(/[ \t]?\{[^{}]{1,80}\}/g, '')

    if (text !== before) node.textContent = text
  }
}
