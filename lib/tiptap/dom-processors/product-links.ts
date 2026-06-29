// DOM processor: verlinkt Produktnamen (aus den Synthszr Charts) im Fließtext
// zu /{locale}/rankings/{slug} und hängt eine Momentum-Pill (30-Tage-Sparkline +
// Score) an. Pro Produkt wird nur die ERSTE Erwähnung verlinkt (sonst überladen).
// Ersetzt die frühere Company-Verlinkung; Vote-Badges bleiben unberührt.

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface ProductLinkEntry {
  displayName: string
  slug: string
  score: number
  spark: number[]
}

export type ProductLinkData = Map<string, ProductLinkEntry> // key: displayName.toLowerCase()

const LOCALES = ['de', 'en', 'cs', 'nds']

/** Baut die Momentum-Pill (Mini-Sparkline der letzten 30 Tage + Score-Zahl). */
function buildPill(entry: ProductLinkEntry): HTMLElement {
  const pill = document.createElement('span')
  pill.className = 'synthszr-product-pill'
  pill.style.cssText =
    'display:inline-flex;align-items:center;gap:3px;margin:0 2px;padding:1px 5px;border:1px solid #e5e7eb;border-radius:9999px;vertical-align:middle;line-height:1;white-space:nowrap;'

  const spark = entry.spark ?? []
  if (spark.length >= 2) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', '26')
    svg.setAttribute('height', '11')
    svg.setAttribute('viewBox', '0 0 26 11')
    svg.setAttribute('preserveAspectRatio', 'none')
    const max = Math.max(...spark, 0.0001)
    const pts = spark
      .map((v, i) => `${((i / (spark.length - 1)) * 26).toFixed(1)},${(10 - (v / max) * 9).toFixed(1)}`)
      .join(' ')
    const line = document.createElementNS(SVG_NS, 'polyline')
    line.setAttribute('points', pts)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', '#111827')
    line.setAttribute('stroke-width', '1')
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    svg.appendChild(line)
    pill.appendChild(svg)
  }

  const num = document.createElement('span')
  num.textContent = String(entry.score)
  num.style.cssText = 'font-size:10px;font-weight:700;color:#111827;'
  pill.appendChild(num)
  return pill
}

export function injectProductLinks(container: HTMLElement, products: ProductLinkData): void {
  if (products.size === 0) return

  const pathParts = window.location.pathname.split('/')
  const locale = LOCALES.includes(pathParts[1]) ? pathParts[1] : 'de'

  // Längere Namen zuerst, damit "Claude Code" vor "Claude" greift.
  const entries = [...products.values()].sort((a, b) => b.displayName.length - a.displayName.length)
  const linked = new Set<string>() // pro Produkt nur die erste Erwähnung

  const paragraphs = container.querySelectorAll('p')
  for (const para of paragraphs) {
    if (para.classList.contains('synthszr-product-links-processed')) continue
    para.classList.add('synthszr-product-links-processed')

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

    for (const tn of textNodes) injectIntoTextNode(tn, entries, locale, linked)
  }
}

function injectIntoTextNode(textNode: Text, entries: ProductLinkEntry[], locale: string, linked: Set<string>): void {
  const text = textNode.textContent || ''
  if (!text.trim()) return

  // Erste Erwähnung je noch-nicht-verlinktem Produkt sammeln.
  const matches: Array<{ start: number; end: number; entry: ProductLinkEntry }> = []
  for (const entry of entries) {
    if (linked.has(entry.slug)) continue
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    const match = regex.exec(text)
    if (!match) continue
    const hasOverlap = matches.some((m) => m.start < match.index + match[0].length && m.end > match.index)
    if (!hasOverlap) matches.push({ start: match.index, end: match.index + match[0].length, entry })
  }
  if (matches.length === 0) return

  matches.sort((a, b) => a.start - b.start)
  const parent = textNode.parentNode
  if (!parent) return

  const fragment = document.createDocumentFragment()
  let lastIndex = 0
  for (const match of matches) {
    if (linked.has(match.entry.slug)) continue
    if (match.start < lastIndex) continue // Überlappung mit bereits eingefügtem Match
    if (match.start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)))
    const link = document.createElement('a')
    link.href = `/${locale}/rankings/${match.entry.slug}`
    link.textContent = text.slice(match.start, match.end)
    link.className = 'text-foreground underline hover:text-foreground/70'
    fragment.appendChild(link)
    fragment.appendChild(buildPill(match.entry))
    linked.add(match.entry.slug)
    lastIndex = match.end
  }
  if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))

  parent.replaceChild(fragment, textNode)
}
