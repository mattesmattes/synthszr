"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { createPortal } from "react-dom"
import { StockSynthszrLayer } from "./stock-synthszr-layer"
import { PremarketSynthszrLayer } from "./premarket-synthszr-layer"
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from "@/lib/data/companies"
import { isExcludedCompanyName } from "@/lib/data/company-exclusions"

interface BatchQuoteResult {
  company: string
  displayName: string
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
}

interface SynthszrRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  ticker?: string
  changePercent?: number
  direction?: 'up' | 'down' | 'neutral'
  isFirst: boolean
}

interface PremarketRatingLinkProps {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  isFirst: boolean
  isin?: string
}

function SynthszrRatingLink({ company, displayName, rating, ticker, changePercent, direction, isFirst }: SynthszrRatingLinkProps) {
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

  // Percentage direction styling
  const directionStyles = {
    up: 'text-[#39FF14]',     // Neon Green
    down: 'text-[#FF6600]',   // Neon Orange
    neutral: 'text-gray-400', // Gray
  }

  const directionArrows = {
    up: '↑',
    down: '↓',
    neutral: '→',
  }

  return (
    <>
      <button
        onClick={() => setShowSynthszr(true)}
        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-foreground text-[13px]"
      >
        {isFirst && <span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span>}
        {!isFirst && <span>,</span>}
        <span className="ml-1">
          {displayName}
          {ticker && <span className="text-muted-foreground"> ({ticker})</span>}
          {typeof changePercent === 'number' && direction && (
            <span className={`ml-1 ${directionStyles[direction]}`}>
              {directionArrows[direction]}{Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
        </span>
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
        className="inline-flex items-center gap-1 hover:underline cursor-pointer text-foreground text-[13px]"
      >
        {isFirst ? (
          <span><span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span> {displayName}</span>
        ) : (
          <span>, {displayName}</span>
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

interface TiptapRendererProps {
  content: Record<string, unknown>
}

export function TiptapRenderer({ content }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const [ratingPortals, setRatingPortals] = useState<Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isFirst: boolean }>>([])
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
      /synthszr vote:?/gi,
    ]

    const isSyntheseText = (text: string) => {
      const lower = text.toLowerCase()
      return lower.includes('mattes synthese') ||
             lower.includes("mattes' synthese") ||
             lower.includes('synthszr take') ||
             lower.includes('synthszr vote')
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

    // Process nodes (wrap "Synthszr Take:" or "Synthszr Vote:" in styled span)
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
        // Skip excluded words (common nouns that aren't companies)
        if (isExcludedCompanyName(displayName)) continue

        const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
        const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch)) {
          companies.push({ apiName, displayName })
        }
      }

      // Find all mentioned premarket companies in the combined text
      const premarketCompanies: Array<{ apiName: string; displayName: string }> = []
      for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
        // Skip excluded words (common nouns that aren't companies)
        if (isExcludedCompanyName(displayName)) continue

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
          ? fetch('/api/stock-synthszr/batch-quotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: allPublicCompanies }),
            }).then(r => r.json())
          : Promise.resolve({ ok: true, quotes: [] }),
        allPremarketCompanies.length > 0
          ? fetch('/api/premarket/batch-ratings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companies: allPremarketCompanies }),
            }).then(r => r.json())
          : Promise.resolve({ ok: true, ratings: [] }),
      ])

      // Build quotes map for public companies (includes ticker, %, direction, and rating)
      const publicQuotesMap = new Map<string, BatchQuoteResult>(
        (publicResponse.ok && publicResponse.quotes || [])
          .filter((r: BatchQuoteResult) => r.rating !== null)
          .map((r: BatchQuoteResult) => [r.company.toLowerCase(), r])
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

      const publicPortals: Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isFirst: boolean }> = []
      const premarketPortals: Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean; isin?: string }> = []

      // Add rating links to each section
      for (const section of sectionsToProcess) {
        const publicCompaniesWithRatings = section.companies.filter(c =>
          publicQuotesMap.has(c.apiName.toLowerCase())
        )
        const premarketCompaniesWithRatings = section.premarketCompanies.filter(c =>
          premarketRatingsMap.has(c.apiName.toLowerCase())
        )

        if (publicCompaniesWithRatings.length === 0 && premarketCompaniesWithRatings.length === 0) continue

        // Create a span container for the rating links
        const ratingsContainer = document.createElement('span')
        ratingsContainer.className = 'synthszr-ratings-container ml-2'
        ratingsContainer.style.fontSize = '13px'

        // Add public company ratings with ticker and percentage
        publicCompaniesWithRatings.forEach((company, idx) => {
          const quoteData = publicQuotesMap.get(company.apiName.toLowerCase())
          if (!quoteData || !quoteData.rating) return

          const placeholder = document.createElement('span')
          placeholder.className = 'synthszr-rating-placeholder inline-block'
          placeholder.style.fontSize = '13px'
          placeholder.dataset.company = company.apiName
          placeholder.dataset.displayName = company.displayName
          placeholder.dataset.rating = quoteData.rating

          ratingsContainer.appendChild(placeholder)
          publicPortals.push({
            element: placeholder,
            company: company.apiName,
            displayName: company.displayName,
            rating: quoteData.rating,
            ticker: quoteData.ticker ?? undefined,
            changePercent: quoteData.changePercent ?? undefined,
            direction: quoteData.direction ?? undefined,
            isFirst: idx === 0,
          })
        })

        // Add premarket company ratings
        premarketCompaniesWithRatings.forEach((company, idx) => {
          const ratingData = premarketRatingsMap.get(company.apiName.toLowerCase())
          if (!ratingData) return

          const placeholder = document.createElement('span')
          placeholder.className = 'premarket-rating-placeholder inline-block'
          placeholder.style.fontSize = '13px'
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

  // Process news headings and rating links after editor renders
  useEffect(() => {
    if (editor) {
      // Wait for DOM to update
      const timeoutId = setTimeout(async () => {
        processNewsHeadings() // Process news headings (adds favicons, removes source links)
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
  }, [editor, content, hideExplicitCompanyTags, processMattesSyntheseText, processNewsHeadings, processSynthszrRatingLinks])

  if (!editor) {
    return null
  }

  return (
    <div ref={containerRef}>
      <EditorContent editor={editor} />
      {ratingPortals.map(({ element, company, displayName, rating, ticker, changePercent, direction, isFirst }, index) =>
        createPortal(
          <SynthszrRatingLink company={company} displayName={displayName} rating={rating} ticker={ticker} changePercent={changePercent} direction={direction} isFirst={isFirst} />,
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
