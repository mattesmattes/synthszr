// DOM processor: verlinkt Produktnamen (aus den Synthszr Charts) im Fließtext
// zu /{locale}/rankings/{slug}. Ersetzt die frühere Company-Verlinkung; die
// Vote-Badges (processSynthszrRatingLinks) bleiben davon unberührt.

export interface ProductLinkEntry {
  displayName: string
  slug: string
}

export type ProductLinkData = Map<string, ProductLinkEntry> // key: displayName.toLowerCase()

const LOCALES = ['de', 'en', 'cs', 'nds']

/**
 * Injiziert <a>-Links um Produkt-Erwähnungen im Absatztext.
 * Muss NACH hideExplicitCompanyTags() laufen (sonst Treffer in {Tag}-Mustern).
 */
export function injectProductLinks(container: HTMLElement, products: ProductLinkData): void {
  if (products.size === 0) return

  const pathParts = window.location.pathname.split('/')
  const locale = LOCALES.includes(pathParts[1]) ? pathParts[1] : 'de'

  // Längere Namen zuerst, damit "Claude Code" vor "Claude" greift.
  const entries = [...products.values()].sort((a, b) => b.displayName.length - a.displayName.length)

  const paragraphs = container.querySelectorAll('p')
  for (const para of paragraphs) {
    if (para.classList.contains('synthszr-product-links-processed')) continue
    para.classList.add('synthszr-product-links-processed')

    // Nur Textknoten außerhalb von <a> und .synthszr-ratings-container.
    const textNodes: Text[] = []
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        let parent = node.parentNode
        while (parent && parent !== para) {
          if (
            parent.nodeName === 'A' ||
            (parent instanceof Element && parent.classList.contains('synthszr-ratings-container'))
          ) {
            return NodeFilter.FILTER_REJECT
          }
          parent = parent.parentNode
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let node: Node | null
    while ((node = walker.nextNode())) textNodes.push(node as Text)

    for (const tn of textNodes) injectIntoTextNode(tn, entries, locale)
  }
}

function injectIntoTextNode(textNode: Text, entries: ProductLinkEntry[], locale: string): void {
  const text = textNode.textContent || ''
  if (!text.trim()) return

  const matches: Array<{ start: number; end: number; entry: ProductLinkEntry }> = []
  for (const entry of entries) {
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi')
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const hasOverlap = matches.some((m) => m.start < match!.index + match![0].length && m.end > match!.index)
      if (!hasOverlap) matches.push({ start: match.index, end: match.index + match[0].length, entry })
    }
  }
  if (matches.length === 0) return

  matches.sort((a, b) => a.start - b.start)
  const parent = textNode.parentNode
  if (!parent) return

  const fragment = document.createDocumentFragment()
  let lastIndex = 0
  for (const match of matches) {
    if (match.start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)))
    const link = document.createElement('a')
    link.href = `/${locale}/rankings/${match.entry.slug}`
    link.textContent = text.slice(match.start, match.end)
    link.className = 'text-foreground underline hover:text-foreground/70'
    fragment.appendChild(link)
    lastIndex = match.end
  }
  if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))

  parent.replaceChild(fragment, textNode)
}
