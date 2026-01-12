"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { createPortal } from "react-dom"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react"
import { StockSynthszrLayer } from "./stock-synthszr-layer"
import { PremarketSynthszrLayer } from "./premarket-synthszr-layer"
import { Button } from "./ui/button"
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from "@/lib/data/companies"

interface StockData {
  symbol: string
  exchange: string
  displayName: string
  price: number
  previousClose: number
  open: number
  high: number
  low: number
  change: number
  changePercent: number
  direction: 'up' | 'down' | 'neutral'
  currency: string
  timestamp: number
}

interface StockRatingResult {
  company: string
  rating: 'BUY' | 'HOLD' | 'SELL' | null
  cached: boolean
}

interface StockTickerInlineProps {
  company: string
}

interface SynthszrRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  isFirst: boolean
}

interface PremarketRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  isFirst: boolean
  isin?: string
}

function SynthszrRatingLink({ company, displayName, rating, isFirst }: SynthszrRatingLinkProps) {
  const [showSynthszr, setShowSynthszr] = useState(false)

  // Neon colors matching stock performance badges
  const ratingBadgeStyles = {
    BUY: 'bg-[#39FF14] text-black',      // Neon Green
    HOLD: 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white',  // Gray
    SELL: 'bg-[#FF6600] text-black',     // Neon Orange
  }

  const ratingLabels = {
    BUY: 'Buy',
    HOLD: 'Hold',
    SELL: 'Sell',
  }

  return (
    <>
      <button
        onClick={() => setShowSynthszr(true)}
        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-foreground"
      >
        {isFirst ? (
          <span style={{ fontSize: '13px' }}><span className="font-bold uppercase">Synthszr Vote:</span> {displayName}</span>
        ) : (
          <span style={{ fontSize: '13px' }}>, {displayName}</span>
        )}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold not-italic ${ratingBadgeStyles[rating]}`}>
          {ratingLabels[rating]}
        </span>
      </button>
      {showSynthszr && (
        <StockSynthszrLayer
          company={company}
          onClose={() => setShowSynthszr(false)}
        />
      )}
    </>
  )
}

function PremarketRatingLink({ company, displayName, rating, isFirst, isin }: PremarketRatingLinkProps) {
  const [showPremarket, setShowPremarket] = useState(false)

  // Neon colors matching stock performance badges
  const ratingBadgeStyles = {
    BUY: 'bg-[#39FF14] text-black',      // Neon Green
    HOLD: 'bg-gray-300 dark:bg-gray-500 text-black dark:text-white',  // Gray
    SELL: 'bg-[#FF6600] text-black',     // Neon Orange
  }

  const ratingLabels = {
    BUY: 'Buy',
    HOLD: 'Hold',
    SELL: 'Sell',
  }

  return (
    <>
      <button
        onClick={() => setShowPremarket(true)}
        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-foreground"
      >
        {isFirst ? (
          <span style={{ fontSize: '13px' }}><span className="font-bold uppercase">Synthszr Vote:</span> {displayName}</span>
        ) : (
          <span style={{ fontSize: '13px' }}>, {displayName}</span>
        )}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold not-italic ${ratingBadgeStyles[rating]}`}>
          {ratingLabels[rating]}
        </span>
      </button>
      {showPremarket && (
        <PremarketSynthszrLayer
          company={company}
          isin={isin}
          onClose={() => setShowPremarket(false)}
        />
      )}
    </>
  )
}

function StockTickerInline({ company }: StockTickerInlineProps) {
  const [data, setData] = useState<StockData | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [showSynthszr, setShowSynthszr] = useState(false)

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/stock-quote?company=${encodeURIComponent(company)}`)
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch {
        // Silently fail
      }
    }
    fetchQuote()
  }, [company])

  if (!data) return null

  const arrow = data.direction === 'up' ? '↑' : data.direction === 'down' ? '↓' : '→'

  // Background colors: Positive=Neon Green, Neutral=Gray, Negative=Neon Orange
  const bgClass = data.direction === 'up'
    ? 'bg-[#39FF14]'  // Neon Green
    : data.direction === 'down'
    ? 'bg-[#FF6600]'  // Neon Orange
    : 'bg-gray-300 dark:bg-gray-600'  // Gray

  // Text colors for dialog (keep original styling there)
  const colorClass = data.direction === 'up'
    ? 'text-green-600 dark:text-green-400'
    : data.direction === 'down'
    ? 'text-red-600 dark:text-red-400'
    : 'text-foreground'

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price)
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className={`text-xs font-medium text-black px-1.5 py-0.5 rounded ${bgClass} hover:opacity-80 cursor-pointer ml-1`}
      >
        {arrow}{Math.abs(data.changePercent).toFixed(1)}%
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>{data.displayName}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {data.symbol}.{data.exchange}
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current Price */}
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold">
                {formatPrice(data.price)} {data.currency}
              </span>
              <span className={`flex items-center gap-1 text-lg font-medium ${colorClass}`}>
                {data.direction === 'up' ? (
                  <TrendingUp className="h-5 w-5" />
                ) : data.direction === 'down' ? (
                  <TrendingDown className="h-5 w-5" />
                ) : (
                  <Minus className="h-5 w-5" />
                )}
                {data.change > 0 ? '+' : ''}{formatPrice(data.change)} ({data.changePercent > 0 ? '+' : ''}{data.changePercent.toFixed(2)}%)
              </span>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Eröffnung</p>
                <p className="font-medium">{formatPrice(data.open)} {data.currency}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Vortag</p>
                <p className="font-medium">{formatPrice(data.previousClose)} {data.currency}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tageshoch</p>
                <p className="font-medium">{formatPrice(data.high)} {data.currency}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tagestief</p>
                <p className="font-medium">{formatPrice(data.low)} {data.currency}</p>
              </div>
            </div>

            {/* Stock-Synthszr Button */}
            <Button
              onClick={() => {
                setDialogOpen(false)
                setShowSynthszr(true)
              }}
              className="w-full bg-[#CCFF00] text-black hover:bg-[#CCFF00]/80"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Stock-Synthszr generieren
            </Button>

            {/* Timestamp & Source */}
            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Stand: {formatTime(data.timestamp)}
              </p>
              <a
                href="https://eodhd.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Quelle: EODHD
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stock-Synthszr Layer */}
      {showSynthszr && (
        <StockSynthszrLayer
          company={company}
          symbol={data.symbol}
          currency={data.currency}
          price={data.price}
          changePercent={data.changePercent}
          onClose={() => setShowSynthszr(false)}
        />
      )}
    </>
  )
}

interface TiptapRendererProps {
  content: Record<string, unknown>
}

export function TiptapRenderer({ content }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const [tickerPortals, setTickerPortals] = useState<Array<{ element: HTMLElement; company: string }>>([])
  const [ratingPortals, setRatingPortals] = useState<Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean }>>([])
  const [premarketRatingPortals, setPremarketRatingPortals] = useState<Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean; isin?: string }>>([])

  // Auto-open dialog state from URL params (for newsletter links)
  const [autoOpenStock, setAutoOpenStock] = useState<string | null>(null)
  const [autoOpenPremarket, setAutoOpenPremarket] = useState<string | null>(null)

  // Read URL params to auto-open dialogs (from newsletter email links)
  useEffect(() => {
    const stockParam = searchParams.get('stock')
    const premarketParam = searchParams.get('premarket')

    if (stockParam) {
      // Find the matching company API name from display name
      const matchedCompany = Object.entries(KNOWN_COMPANIES).find(
        ([displayName]) => displayName.toLowerCase() === stockParam.toLowerCase()
      )
      if (matchedCompany) {
        setAutoOpenStock(matchedCompany[1]) // API name
      }
    }

    if (premarketParam) {
      // For premarket, the company name is the API name directly
      const matchedCompany = Object.entries(KNOWN_PREMARKET_COMPANIES).find(
        ([displayName]) => displayName.toLowerCase() === premarketParam.toLowerCase()
      )
      if (matchedCompany) {
        setAutoOpenPremarket(matchedCompany[1]) // API name
      }
    }
  }, [searchParams])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-foreground underline hover:text-foreground/70',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ],
    content: content,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose prose-neutral max-w-none font-serif text-base md:text-sm leading-relaxed tiptap-content",
      },
    },
  })

  // Check if node is inside a heading element
  const isInsideHeading = (node: Node): boolean => {
    let current: Node | null = node
    while (current) {
      if (current instanceof HTMLElement) {
        const tagName = current.tagName.toLowerCase()
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
          return true
        }
      }
      current = current.parentNode
    }
    return false
  }

  // Get the current section (H2) for a node
  const getCurrentSection = (node: Node): Element | null => {
    let current: Node | null = node
    while (current && current !== containerRef.current) {
      // Walk backwards through siblings to find preceding H2
      let sibling: Node | null = current
      while (sibling) {
        if (sibling instanceof HTMLElement && sibling.tagName === 'H2') {
          return sibling
        }
        sibling = sibling.previousSibling
      }
      current = current.parentNode
    }
    return null
  }

  // Find and mark company names after render (once per news section)
  const processCompanyNames = useCallback(() => {
    if (!containerRef.current) return

    const portals: Array<{ element: HTMLElement; company: string }> = []
    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    // Track which companies already have a ticker in each section
    const shownInSection = new Map<Element | null, Set<string>>()

    const nodesToProcess: { node: Text; matches: Array<{ company: string; index: number; length: number }> }[] = []

    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      // Skip nodes inside headings - stock tickers only in body text
      if (isInsideHeading(node)) continue

      const section = getCurrentSection(node)
      if (!shownInSection.has(section)) {
        shownInSection.set(section, new Set())
      }
      const sectionCompanies = shownInSection.get(section)!

      const text = node.textContent || ''
      const matches: Array<{ company: string; index: number; length: number }> = []

      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        // Skip if already shown in this section
        if (sectionCompanies.has(apiName)) continue

        // Match company name optionally followed by:
        // - German possessive "s" (e.g., "Metas", "Googles")
        // - Compound word parts with hyphen (e.g., "Google-Aktien")
        // Not already followed by stock ticker indicator
        const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b(?!\\s*\\([↑↓→])`, 'g')
        const match = regex.exec(text)
        if (match) {
          // Check if inside curly braces {Company} - these are directive tags for Synthszr Vote only
          const charBefore = match.index > 0 ? text[match.index - 1] : ''
          const charAfter = text[match.index + match[0].length] || ''
          const isDirectiveTag = charBefore === '{' || charAfter === '}'

          // Always add to sectionCompanies for Synthszr Vote badges
          sectionCompanies.add(apiName)

          // Only add to matches for inline ticker if NOT a directive tag
          if (!isDirectiveTag) {
            matches.push({
              company: apiName,
              index: match.index,
              length: match[0].length,  // Use actual matched length including compound parts
            })
          }
        }
      }

      if (matches.length > 0) {
        // Sort by index descending to process from end to start
        matches.sort((a, b) => b.index - a.index)
        nodesToProcess.push({ node, matches })
      }
    }

    // Process nodes - handle multiple matches per node in one pass
    for (const { node, matches } of nodesToProcess) {
      const text = node.textContent || ''
      const parent = node.parentNode
      if (!parent) continue

      // Sort by index ascending to build fragments in order
      const sortedMatches = [...matches].sort((a, b) => a.index - b.index)

      // Build fragments: alternating text and company markers
      const fragments: Array<{ type: 'text'; content: string } | { type: 'company'; company: string; name: string }> = []
      let lastEnd = 0

      for (const match of sortedMatches) {
        // Add text before this match
        if (match.index > lastEnd) {
          fragments.push({ type: 'text', content: text.slice(lastEnd, match.index) })
        }
        // Add the company name and ticker marker
        fragments.push({
          type: 'company',
          company: match.company,
          name: text.slice(match.index, match.index + match.length)
        })
        lastEnd = match.index + match.length
      }

      // Add remaining text after last match
      if (lastEnd < text.length) {
        fragments.push({ type: 'text', content: text.slice(lastEnd) })
      }

      // Create DOM nodes from fragments
      for (const fragment of fragments) {
        if (fragment.type === 'text') {
          parent.insertBefore(document.createTextNode(fragment.content), node)
        } else {
          // Add company name text
          parent.insertBefore(document.createTextNode(fragment.name), node)
          // Add ticker placeholder span
          const tickerSpan = document.createElement('span')
          tickerSpan.className = 'stock-ticker-placeholder'
          tickerSpan.dataset.company = fragment.company
          parent.insertBefore(tickerSpan, node)
          portals.push({ element: tickerSpan, company: fragment.company })
        }
      }

      // Remove original node only after all new nodes are inserted
      parent.removeChild(node)
    }

    setTickerPortals(portals)
  }, [])

  // Update content when prop changes
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON())
      const newContent = JSON.stringify(content)
      if (currentContent !== newContent) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  // Process "Mattes Synthese" or "Synthszr Take" text to add styling class
  const processMattesSyntheseText = useCallback(() => {
    if (!containerRef.current) return

    const synthesePatterns = [
      /mattes synthese:?/gi,
      /mattes' synthese:?/gi,
      /synthszr take:?/gi,
    ]

    const isSyntheseText = (text: string) => {
      const lower = text.toLowerCase()
      return lower.includes('mattes synthese') ||
             lower.includes("mattes' synthese") ||
             lower.includes('synthszr take')
    }

    // First check headings
    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
    headings.forEach((heading) => {
      const text = heading.textContent || ''
      if (isSyntheseText(text)) {
        heading.classList.add('mattes-synthese-heading')
      }
    })

    // Then check bold/strong elements
    const strongElements = containerRef.current.querySelectorAll('strong, b')
    strongElements.forEach((strong) => {
      const text = strong.textContent || ''
      if (isSyntheseText(text)) {
        strong.classList.add('mattes-synthese')
      }
    })

    // Also check for plain text "Synthszr Take:" that's not already in a styled element
    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    const nodesToProcess: { node: Text; pattern: RegExp; match: RegExpExecArray }[] = []
    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent || ''
      // Skip if parent is already styled or is a heading
      const parent = textNode.parentElement
      if (parent?.classList.contains('mattes-synthese') ||
          parent?.classList.contains('mattes-synthese-heading') ||
          parent?.tagName === 'STRONG' ||
          parent?.tagName === 'B' ||
          isInsideHeading(textNode)) {
        continue
      }

      for (const pattern of synthesePatterns) {
        pattern.lastIndex = 0
        const match = pattern.exec(text)
        if (match) {
          nodesToProcess.push({ node: textNode, pattern, match })
          break
        }
      }
    }

    // Process nodes (wrap "Synthszr Take:" in styled span)
    for (const { node, match } of nodesToProcess) {
      const text = node.textContent || ''
      const before = text.slice(0, match.index)
      const matchedText = match[0]
      const after = text.slice(match.index + matchedText.length)

      const beforeNode = document.createTextNode(before)
      const styledSpan = document.createElement('span')
      styledSpan.className = 'mattes-synthese font-bold'
      styledSpan.textContent = matchedText
      const afterNode = document.createTextNode(after)

      const parent = node.parentNode
      if (parent) {
        parent.insertBefore(beforeNode, node)
        parent.insertBefore(styledSpan, node)
        parent.insertBefore(afterNode, node)
        parent.removeChild(node)
      }
    }
  }, [])

  // Add Synthszr rating links at the end of each Synthszr Take section
  const processSynthszrRatingLinks = useCallback(async () => {
    if (!containerRef.current) return

    // Find all Synthszr Take / Mattes Synthese markers
    const syntheszrMarkers = containerRef.current.querySelectorAll('.mattes-synthese, .mattes-synthese-heading')
    if (syntheszrMarkers.length === 0) return

    // For each marker, find the containing paragraph/section and extract companies
    const sectionsToProcess: Array<{
      element: Element
      companies: Array<{ apiName: string; displayName: string }>
      premarketCompanies: Array<{ apiName: string; displayName: string }>
    }> = []

    syntheszrMarkers.forEach((marker) => {
      // Find the paragraph containing this marker
      let container: Element | null = marker
      while (container && container.tagName !== 'P' && container !== containerRef.current) {
        container = container.parentElement
      }
      if (!container || container === containerRef.current) return

      // Skip if already processed
      if (container.classList.contains('synthszr-ratings-processed')) return

      // Collect text from the news paragraph(s) BEFORE the Synthszr Take
      // Go back through previous siblings to find news content (stop at H2 or start)
      let textToSearch = ''
      let prevElement = container.previousElementSibling
      while (prevElement) {
        // Stop if we hit a heading (new section)
        if (prevElement.tagName.match(/^H[1-6]$/)) break
        // Stop if we hit another Synthszr Take
        if (prevElement.textContent?.toLowerCase().includes('synthszr take') ||
            prevElement.textContent?.toLowerCase().includes('mattes synthese')) break
        // Collect text from paragraphs
        if (prevElement.tagName === 'P') {
          textToSearch = (prevElement.textContent || '') + ' ' + textToSearch
        }
        prevElement = prevElement.previousElementSibling
      }

      // Also include the Synthszr Take paragraph itself
      textToSearch += ' ' + (container.textContent || '')

      // Find all mentioned public companies in the combined text
      // Matches: "Meta", "Metas" (possessive), "Google-Aktien" (compound), or {Meta} (explicit)
      const companies: Array<{ apiName: string; displayName: string }> = []
      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
        const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch)) {
          companies.push({ apiName, displayName })
        }
      }

      // Find all mentioned premarket companies in the combined text
      const premarketCompanies: Array<{ apiName: string; displayName: string }> = []
      for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
        // Escape special regex characters in company names (e.g., "Character.AI")
        const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
        const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch)) {
          premarketCompanies.push({ apiName, displayName })
        }
      }

      if (companies.length > 0 || premarketCompanies.length > 0) {
        sectionsToProcess.push({ element: container, companies, premarketCompanies })
      }
    })

    if (sectionsToProcess.length === 0) return

    // Collect all unique companies for batch API calls
    const allPublicCompanies = [...new Set(sectionsToProcess.flatMap(s => s.companies.map(c => c.apiName)))]
    const allPremarketCompanies = [...new Set(sectionsToProcess.flatMap(s => s.premarketCompanies.map(c => c.apiName)))]

    // Fetch ratings from both APIs in parallel
    try {
      const [publicResponse, premarketResponse] = await Promise.all([
        allPublicCompanies.length > 0
          ? fetch('/api/stock-synthszr/batch-ratings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: allPublicCompanies }),
            }).then(r => r.json())
          : Promise.resolve({ ok: true, ratings: [] }),
        allPremarketCompanies.length > 0
          ? fetch('/api/premarket/batch-ratings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: allPremarketCompanies }),
            }).then(r => r.json())
          : Promise.resolve({ ok: true, ratings: [] }),
      ])

      // Build ratings maps
      const publicRatingsMap = new Map<string, 'BUY' | 'HOLD' | 'SELL'>(
        (publicResponse.ok && publicResponse.ratings || [])
          .filter((r: StockRatingResult) => r.rating !== null)
          .map((r: StockRatingResult) => [r.company.toLowerCase(), r.rating as 'BUY' | 'HOLD' | 'SELL'])
      )

      interface PremarketRatingResult {
        company: string
        rating: 'BUY' | 'HOLD' | 'SELL' | null
        isin?: string
      }
      const premarketRatingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; isin?: string }>(
        (premarketResponse.ok && premarketResponse.ratings || [])
          .filter((r: PremarketRatingResult) => r.rating !== null)
          .map((r: PremarketRatingResult) => [r.company.toLowerCase(), { rating: r.rating as 'BUY' | 'HOLD' | 'SELL', isin: r.isin }])
      )

      const publicPortals: Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean }> = []
      const premarketPortals: Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean; isin?: string }> = []

      // Add rating links to each section
      for (const section of sectionsToProcess) {
        const publicCompaniesWithRatings = section.companies.filter(c =>
          publicRatingsMap.has(c.apiName.toLowerCase())
        )
        const premarketCompaniesWithRatings = section.premarketCompanies.filter(c =>
          premarketRatingsMap.has(c.apiName.toLowerCase())
        )

        if (publicCompaniesWithRatings.length === 0 && premarketCompaniesWithRatings.length === 0) continue

        // Create a span container for the rating links
        const ratingsContainer = document.createElement('span')
        ratingsContainer.className = 'synthszr-ratings-container ml-2'

        // Add public company ratings
        publicCompaniesWithRatings.forEach((company, idx) => {
          const rating = publicRatingsMap.get(company.apiName.toLowerCase())
          if (!rating) return

          const placeholder = document.createElement('span')
          placeholder.className = 'synthszr-rating-placeholder inline-block'
          placeholder.dataset.company = company.apiName
          placeholder.dataset.displayName = company.displayName
          placeholder.dataset.rating = rating

          ratingsContainer.appendChild(placeholder)
          publicPortals.push({
            element: placeholder,
            company: company.apiName,
            displayName: company.displayName,
            rating,
            isFirst: idx === 0,
          })
        })

        // Add premarket company ratings
        premarketCompaniesWithRatings.forEach((company, idx) => {
          const ratingData = premarketRatingsMap.get(company.apiName.toLowerCase())
          if (!ratingData) return

          const placeholder = document.createElement('span')
          placeholder.className = 'premarket-rating-placeholder inline-block'
          placeholder.dataset.company = company.apiName
          placeholder.dataset.displayName = company.displayName
          placeholder.dataset.rating = ratingData.rating
          if (ratingData.isin) placeholder.dataset.isin = ratingData.isin

          ratingsContainer.appendChild(placeholder)
          premarketPortals.push({
            element: placeholder,
            company: company.apiName,
            displayName: company.displayName,
            rating: ratingData.rating,
            isFirst: publicCompaniesWithRatings.length === 0 && idx === 0,
            isin: ratingData.isin,
          })
        })

        // Append to end of paragraph
        section.element.appendChild(ratingsContainer)
        section.element.classList.add('synthszr-ratings-processed')
      }

      setRatingPortals(publicPortals)
      setPremarketRatingPortals(premarketPortals)
    } catch (error) {
      console.error('[TiptapRenderer] Failed to fetch Synthszr ratings:', error)
    }
  }, [])

  // Process news headings: add favicon + link, remove source links from paragraphs
  const processNewsHeadings = useCallback(() => {
    if (!containerRef.current) return

    // Find all H2 headings (news headlines)
    const h2s = containerRef.current.querySelectorAll('h2')

    h2s.forEach((h2) => {
      // Skip if already processed or is "Mattes Synthese" / "Synthszr Take" heading
      if (h2.classList.contains('news-heading-processed')) return
      const headingText = h2.textContent?.toLowerCase() || ''
      if (headingText.includes('mattes synthese') || headingText.includes("mattes' synthese") || headingText.includes('synthszr take')) return

      // Find the next sibling paragraph that contains a source link
      let nextSibling = h2.nextElementSibling
      let sourceUrl: string | null = null
      let sourceLinkElement: Element | null = null

      // Look through the next few siblings to find a paragraph with a source link
      for (let i = 0; i < 3 && nextSibling; i++) {
        if (nextSibling.tagName.toLowerCase() === 'p') {
          // Find links that match the pattern "→ Source" or just arrow links
          const links = nextSibling.querySelectorAll('a')
          links.forEach((link) => {
            const linkText = link.textContent || ''
            // Match patterns like "→ Medium", "→ TechCrunch", etc.
            if (linkText.trim().startsWith('→') || linkText.trim().match(/^→\s/)) {
              sourceUrl = link.getAttribute('href')
              sourceLinkElement = link
            }
          })
          if (sourceUrl) break
        }
        // Also check if next is heading (don't look further)
        if (nextSibling.tagName.toLowerCase().match(/^h[1-6]$/)) break
        nextSibling = nextSibling.nextElementSibling
      }

      if (sourceUrl) {
        // Extract domain for favicon
        try {
          const url = new URL(sourceUrl)
          let faviconDomain = url.hostname

          // Special handling for Substack: use subdomain for favicon if available
          // e.g., "mlpills.substack.com" → use that for favicon (shows newsletter icon)
          // e.g., "substack.com/redirect/..." → try to extract from link text
          if (faviconDomain === 'substack.com' || faviconDomain === 'www.substack.com') {
            // For generic substack.com URLs (redirects, app-links), try to get newsletter name from link text
            // The link text is often formatted as "→ Newsletter Name" or "→ mlpills.substack.com"
            const linkText = (sourceLinkElement as Element | null)?.textContent || ''
            const substackMatch = linkText.match(/([a-z0-9_-]+)\.substack\.com/i)
            if (substackMatch) {
              faviconDomain = `${substackMatch[1]}.substack.com`
            }
          }

          // Create wrapper link for heading content
          const headingContent = h2.innerHTML
          const faviconImg = document.createElement('img')
          faviconImg.src = `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`
          faviconImg.alt = faviconDomain
          faviconImg.className = 'inline-block w-5 h-5 mr-2 align-middle opacity-70'
          faviconImg.style.marginTop = '-2px'

          // Create link wrapper
          const linkWrapper = document.createElement('a')
          linkWrapper.href = sourceUrl
          linkWrapper.target = '_blank'
          linkWrapper.rel = 'noopener noreferrer'
          linkWrapper.className = 'no-underline hover:opacity-80 transition-opacity'
          linkWrapper.innerHTML = headingContent

          // Clear heading and add favicon + linked content
          h2.innerHTML = ''
          h2.appendChild(faviconImg)
          h2.appendChild(linkWrapper)
          h2.classList.add('news-heading-processed')

          // Remove the source link from the paragraph
          if (sourceLinkElement) {
            // Check if link is at end of paragraph (possibly with trailing dot/space)
            const linkToRemove = sourceLinkElement as Element
            const parent = linkToRemove.parentNode
            if (parent) {
              // Remove preceding " " or "." if present
              const prevSibling = linkToRemove.previousSibling
              if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE) {
                const text = prevSibling.textContent || ''
                // Remove trailing space, dot, or arrow from previous text
                prevSibling.textContent = text.replace(/\s*$/, '')
              }
              // Remove the link element
              linkToRemove.remove()
              // Remove trailing dot after link if present
              const nextNode = parent.lastChild
              if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
                const text = nextNode.textContent || ''
                if (text.trim() === '.' || text.trim() === '') {
                  nextNode.textContent = text.replace(/\.\s*$/, '')
                }
              }
            }
          }
        } catch {
          // Invalid URL, skip favicon
        }
      }
    })
  }, [])

  // Hide {Company} syntax from rendered content (used for explicit company tagging)
  const hideExplicitCompanyTags = useCallback(() => {
    if (!containerRef.current) return

    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = []
    let textNode: Text | null

    // Pattern matches {CompanyName} - we'll remove these from display
    const pattern = /\{([^}]+)\}/g

    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent || ''
      const matches = [...text.matchAll(pattern)]
      if (matches.length > 0) {
        nodesToProcess.push({ node: textNode, matches })
      }
    }

    // Process nodes - remove {Company} patterns
    for (const { node, matches } of nodesToProcess) {
      let text = node.textContent || ''
      for (const match of matches) {
        text = text.replace(match[0], '')
      }
      // Clean up extra spaces
      text = text.replace(/\s+/g, ' ').trim()
      node.textContent = text
    }
  }, [])

  // Process company names and news headings after editor renders
  useEffect(() => {
    if (editor) {
      // Wait for DOM to update
      const timeoutId = setTimeout(async () => {
        processNewsHeadings() // Process news headings (adds favicons, removes source links)
        processCompanyNames()
        processMattesSyntheseText()
        // Process Synthszr rating links BEFORE hiding {Company} tags
        // so the company detection can find explicit tags
        // IMPORTANT: Wait for async processSynthszrRatingLinks to complete before hiding tags
        await processSynthszrRatingLinks()
        // Hide {Company} syntax AFTER company detection and badge placement
        hideExplicitCompanyTags()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [editor, content, hideExplicitCompanyTags, processCompanyNames, processMattesSyntheseText, processNewsHeadings, processSynthszrRatingLinks])

  if (!editor) {
    return null
  }

  return (
    <div ref={containerRef}>
      <EditorContent editor={editor} />
      {tickerPortals.map(({ element, company }, index) =>
        createPortal(<StockTickerInline company={company} />, element, `ticker-${index}`)
      )}
      {ratingPortals.map(({ element, company, displayName, rating, isFirst }, index) =>
        createPortal(
          <SynthszrRatingLink company={company} displayName={displayName} rating={rating} isFirst={isFirst} />,
          element,
          `rating-${index}`
        )
      )}
      {premarketRatingPortals.map(({ element, company, displayName, rating, isFirst, isin }, index) =>
        createPortal(
          <PremarketRatingLink company={company} displayName={displayName} rating={rating} isFirst={isFirst} isin={isin} />,
          element,
          `premarket-rating-${index}`
        )
      )}

      {/* Auto-open dialogs from URL params (newsletter email links) */}
      {autoOpenStock && (
        <StockSynthszrLayer
          company={autoOpenStock}
          onClose={() => setAutoOpenStock(null)}
        />
      )}
      {autoOpenPremarket && (
        <PremarketSynthszrLayer
          company={autoOpenPremarket}
          onClose={() => setAutoOpenPremarket(null)}
        />
      )}
    </div>
  )
}
