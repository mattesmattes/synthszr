"use client"

import { useEffect, useRef, useState, useCallback } from "react"
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
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

// Known public companies that we want to show stock tickers for
const KNOWN_COMPANIES: Record<string, string> = {
  'Apple': 'apple',
  'Microsoft': 'microsoft',
  'Google': 'google',
  'Alphabet': 'alphabet',
  'Amazon': 'amazon',
  'Meta': 'meta',
  'Facebook': 'facebook',
  'Nvidia': 'nvidia',
  'Tesla': 'tesla',
  'Netflix': 'netflix',
  'Salesforce': 'salesforce',
  'Snowflake': 'snowflake',
  'Palantir': 'palantir',
  'CrowdStrike': 'crowdstrike',
  'Cloudflare': 'cloudflare',
  'Intel': 'intel',
  'AMD': 'amd',
  'Qualcomm': 'qualcomm',
  'Broadcom': 'broadcom',
  'TSMC': 'tsmc',
  'ASML': 'asml',
  'ARM': 'arm',
  'Snap': 'snap',
  'Pinterest': 'pinterest',
  'Spotify': 'spotify',
  'Disney': 'disney',
  'Shopify': 'shopify',
  'PayPal': 'paypal',
  'Square': 'square',
  'Block': 'block',
  'Oracle': 'oracle',
  'SAP': 'sap',
  'IBM': 'ibm',
  'Adobe': 'adobe',
  'ServiceNow': 'servicenow',
  'Workday': 'workday',
  'Zoom': 'zoom',
  'Atlassian': 'atlassian',
  'Twilio': 'twilio',
  'DocuSign': 'docusign',
  'Volkswagen': 'volkswagen',
  'BMW': 'bmw',
  'Mercedes': 'mercedes',
  'Porsche': 'porsche',
  'Ford': 'ford',
  'Rivian': 'rivian',
  'Lucid': 'lucid',
  'JPMorgan': 'jpmorgan',
  'Visa': 'visa',
  'Mastercard': 'mastercard',
  'Coinbase': 'coinbase',
  'Siemens': 'siemens',
  'Allianz': 'allianz',
  'Bayer': 'bayer',
  'BASF': 'basf',
  'Adidas': 'adidas',
  'Zalando': 'zalando',
  'Uber': 'uber',
  'Airbnb': 'airbnb',
  'DoorDash': 'doordash',
  'Roblox': 'roblox',
  'Unity': 'unity',
  'Robinhood': 'robinhood',
}

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

interface StockTickerInlineProps {
  company: string
}

function StockTickerInline({ company }: StockTickerInlineProps) {
  const [data, setData] = useState<StockData | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

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

  // Background colors: Positive=Green, Neutral=Gray, Negative=Cyan
  const bgClass = data.direction === 'up'
    ? 'bg-[#22C55E]'  // Green (Tailwind green-500)
    : data.direction === 'down'
    ? 'bg-cyan-400'   // Cyan
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
    </>
  )
}

interface TiptapRendererProps {
  content: Record<string, unknown>
}

export function TiptapRenderer({ content }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tickerPortals, setTickerPortals] = useState<Array<{ element: HTMLElement; company: string }>>([])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-primary underline hover:text-primary/80',
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

  // Find and mark company names after render
  const processCompanyNames = useCallback(() => {
    if (!containerRef.current) return

    const portals: Array<{ element: HTMLElement; company: string }> = []
    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    )

    const nodesToProcess: { node: Text; matches: Array<{ company: string; index: number; length: number }> }[] = []

    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      // Skip nodes inside headings - stock tickers only in body text
      if (isInsideHeading(node)) continue

      const text = node.textContent || ''
      const matches: Array<{ company: string; index: number; length: number }> = []

      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        // Match company name followed by word boundary (not already followed by stock ticker)
        const regex = new RegExp(`\\b${displayName}\\b(?!\\s*\\([↑↓→])`, 'g')
        let match: RegExpExecArray | null
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            company: apiName,
            index: match.index,
            length: displayName.length,
          })
        }
      }

      if (matches.length > 0) {
        // Sort by index descending to process from end to start
        matches.sort((a, b) => b.index - a.index)
        nodesToProcess.push({ node, matches })
      }
    }

    // Process nodes
    for (const { node, matches } of nodesToProcess) {
      for (const match of matches) {
        const text = node.textContent || ''
        const before = text.slice(0, match.index + match.length)
        const after = text.slice(match.index + match.length)

        // Create text node for content before and including company name
        const beforeNode = document.createTextNode(before)

        // Create placeholder span for stock ticker
        const tickerSpan = document.createElement('span')
        tickerSpan.className = 'stock-ticker-placeholder'
        tickerSpan.dataset.company = match.company

        // Create text node for content after
        const afterNode = document.createTextNode(after)

        // Replace original node
        const parent = node.parentNode
        if (parent) {
          parent.insertBefore(beforeNode, node)
          parent.insertBefore(tickerSpan, node)
          parent.insertBefore(afterNode, node)
          parent.removeChild(node)

          portals.push({ element: tickerSpan, company: match.company })
        }
      }
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

  // Process "Mattes Synthese" text to add styling class
  const processMattesSyntheseText = useCallback(() => {
    if (!containerRef.current) return

    // First check headings
    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
    headings.forEach((heading) => {
      const text = heading.textContent || ''
      if (text.toLowerCase().includes('mattes synthese') || text.toLowerCase().includes("mattes' synthese")) {
        heading.classList.add('mattes-synthese-heading')
      }
    })

    // Then check bold/strong elements for "Mattes Synthese"
    const strongElements = containerRef.current.querySelectorAll('strong, b')
    strongElements.forEach((strong) => {
      const text = strong.textContent || ''
      if (text.toLowerCase().includes('mattes synthese') || text.toLowerCase().includes("mattes' synthese")) {
        strong.classList.add('mattes-synthese')
      }
    })
  }, [])

  // Process news headings: add favicon + link, remove source links from paragraphs
  const processNewsHeadings = useCallback(() => {
    if (!containerRef.current) return

    // Find all H2 headings (news headlines)
    const h2s = containerRef.current.querySelectorAll('h2')

    h2s.forEach((h2) => {
      // Skip if already processed or is "Mattes Synthese" heading
      if (h2.classList.contains('news-heading-processed')) return
      const headingText = h2.textContent?.toLowerCase() || ''
      if (headingText.includes('mattes synthese') || headingText.includes("mattes' synthese")) return

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

  // Process company names and news headings after editor renders
  useEffect(() => {
    if (editor) {
      // Wait for DOM to update
      const timeoutId = setTimeout(() => {
        processNewsHeadings() // Process news headings first (adds favicons, removes source links)
        processCompanyNames()
        processMattesSyntheseText()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [editor, content, processCompanyNames, processMattesSyntheseText, processNewsHeadings])

  if (!editor) {
    return null
  }

  return (
    <div ref={containerRef}>
      <EditorContent editor={editor} />
      {tickerPortals.map(({ element, company }, index) =>
        createPortal(<StockTickerInline company={company} />, element, `ticker-${index}`)
      )}
    </div>
  )
}
