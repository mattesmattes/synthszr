// DOM processor: Produkt-Verlinkung + Produkt-Vote-Block.
// - injectProductLinks: verlinkt Produktnamen (aus den Charts) im Fließtext zu
//   /{locale}/rankings/{slug} (NUR Links, keine Pills).
// - appendProductVoteBlock: hängt pro Synthszr-Take-Sektion einen "Synthszr Vote:"-
//   Block an mit den im Abschnitt genannten Produkten + farbcodierter Momentum-Pill
//   (grün=steigend, rot=fallend, schwarz=stagnierend) + Score.
// Ersetzt die frühere Company-Vote-Logik.

const SVG_NS = 'http://www.w3.org/2000/svg'
const LOCALES = ['de', 'en', 'cs', 'nds']

export interface ProductLinkEntry {
  displayName: string
  slug: string
  score: number
  spark: number[]
  trend: 'up' | 'down' | 'flat' // aus der Erwähnungs-Rate (Datenschicht), nicht aus spark
}

export type ProductLinkData = Map<string, ProductLinkEntry> // key: displayName.toLowerCase()

function localeFrom(): string {
  const parts = window.location.pathname.split('/')
  return LOCALES.includes(parts[1]) ? parts[1] : 'de'
}

const TREND_COLOR = { up: '#16a34a', down: '#dc2626', flat: '#111827' } as const

/** Momentum-Pill: farbige Mini-Sparkline (Trend-Farbe) + Score. */
function buildVotePill(entry: ProductLinkEntry): HTMLElement {
  const color = TREND_COLOR[entry.trend ?? 'flat']
  const pill = document.createElement('span')
  pill.className = 'synthszr-product-pill'
  pill.style.cssText =
    'display:inline-flex;align-items:center;gap:3px;margin-left:4px;padding:1px 6px;border:1px solid #e5e7eb;border-radius:9999px;vertical-align:middle;line-height:1;white-space:nowrap;'

  const spark = entry.spark ?? []
  if (spark.length >= 2) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', '30')
    svg.setAttribute('height', '12')
    svg.setAttribute('viewBox', '0 0 30 12')
    svg.setAttribute('preserveAspectRatio', 'none')
    const max = Math.max(...spark, 0.0001)
    const pts = spark.map((v, i) => `${((i / (spark.length - 1)) * 30).toFixed(1)},${(11 - (v / max) * 10).toFixed(1)}`).join(' ')
    const line = document.createElementNS(SVG_NS, 'polyline')
    line.setAttribute('points', pts)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', '1.25')
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    svg.appendChild(line)
    pill.appendChild(svg)
  }

  const num = document.createElement('span')
  num.textContent = String(entry.score)
  num.style.cssText = `font-size:11px;font-weight:700;color:${color};`
  pill.appendChild(num)
  return pill
}

/** Verlinkt je Produkt die erste Erwähnung im Fließtext (keine Pill). */
export function injectProductLinks(container: HTMLElement, products: ProductLinkData): void {
  if (products.size === 0) return
  const locale = localeFrom()
  const entries = [...products.values()].sort((a, b) => b.displayName.length - a.displayName.length)
  const linked = new Set<string>()

  const paragraphs = container.querySelectorAll('p')
  for (const para of paragraphs) {
    if (para.classList.contains('synthszr-product-links-processed')) continue
    para.classList.add('synthszr-product-links-processed')

    const textNodes: Text[] = []
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        let parent = node.parentNode
        while (parent && parent !== para) {
          if (parent.nodeName === 'A' || (parent instanceof Element && parent.classList.contains('synthszr-product-vote'))) {
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

  const matches: Array<{ start: number; end: number; entry: ProductLinkEntry }> = []
  for (const entry of entries) {
    if (linked.has(entry.slug)) continue
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`\\b${escaped}\\b`, 'i').exec(text)
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
    if (linked.has(match.entry.slug) || match.start < lastIndex) continue
    if (match.start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)))
    const link = document.createElement('a')
    link.href = `/${locale}/rankings/${match.entry.slug}`
    link.textContent = text.slice(match.start, match.end)
    link.className = 'text-foreground underline hover:text-foreground/70'
    fragment.appendChild(link)
    linked.add(match.entry.slug)
    lastIndex = match.end
  }
  if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
  parent.replaceChild(fragment, textNode)
}

/** Findet die in einem Textabschnitt genannten Chart-Produkte (längste zuerst, kein Overlap). */
function mentionedProducts(text: string, entries: ProductLinkEntry[]): ProductLinkEntry[] {
  const taken: Array<{ start: number; end: number }> = []
  const seen = new Set<string>()
  const found: ProductLinkEntry[] = []
  for (const entry of entries) {
    const escaped = entry.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi')
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      const overlap = taken.some((t) => t.start < m!.index + m![0].length && t.end > m!.index)
      if (overlap) continue
      taken.push({ start: m.index, end: m.index + m[0].length })
      if (!seen.has(entry.slug)) { seen.add(entry.slug); found.push(entry) }
    }
  }
  return found
}

/** Hängt pro Synthszr-Take-Sektion einen Produkt-Vote-Block (genannte Produkte + Pills) an. */
export function appendProductVoteBlock(container: HTMLElement, products: ProductLinkData): void {
  if (products.size === 0) return
  const locale = localeFrom()
  const entries = [...products.values()].sort((a, b) => b.displayName.length - a.displayName.length)

  const markers = container.querySelectorAll('.mattes-synthese, .mattes-synthese-heading')
  markers.forEach((marker) => {
    let mc: Element | null = marker
    while (mc && mc.tagName !== 'P' && mc !== container) mc = mc.parentElement
    if (!mc || mc === container) return
    if (mc.classList.contains('synthszr-product-vote-processed')) return

    // Text der News-Absätze VOR der Take + die Take selbst (für Produkt-Erkennung).
    let textToSearch = ''
    let prev = mc.previousElementSibling
    while (prev) {
      const t = (prev as HTMLElement).innerText || prev.textContent || ''
      if (prev.tagName.match(/^H[1-6]$/)) { textToSearch = t + ' ' + textToSearch; break }
      if (/synthszr take|synthszr contra|mattes synthese/i.test(t)) break
      if (prev.tagName === 'P') textToSearch = t + ' ' + textToSearch
      prev = prev.previousElementSibling
    }
    textToSearch += ' ' + ((mc as HTMLElement).innerText || mc.textContent || '')

    const found = mentionedProducts(textToSearch, entries).slice(0, 6)
    mc.classList.add('synthszr-product-vote-processed')
    if (found.length === 0) return

    const block = document.createElement('span')
    block.className = 'synthszr-product-vote'
    block.style.cssText = 'font-size:13px;'
    const label = document.createElement('span')
    label.textContent = 'Synthszr Charts: '
    label.style.cssText = 'font-weight:700;text-transform:uppercase;font-size:0.8125em;'
    block.appendChild(label)

    found.forEach((entry, idx) => {
      if (idx > 0) block.appendChild(document.createTextNode(', '))
      const link = document.createElement('a')
      link.href = `/${locale}/rankings/${entry.slug}`
      link.textContent = entry.displayName
      link.className = 'text-foreground hover:underline'
      block.appendChild(link)
      block.appendChild(buildVotePill(entry))
    })

    mc.appendChild(document.createTextNode(' '))
    mc.appendChild(block)
  })
}
