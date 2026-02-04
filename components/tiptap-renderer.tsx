"use client"

// TipTap content renderer with Synthszr Vote badges
// Supports: DE, EN, NDS (Low German), CS (Czech) translations

import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { createPortal } from "react-dom"
import { HeadingWithQueueId } from "@/lib/tiptap/heading-with-queue-id"
import { StockSynthszrLayer } from "./stock-synthszr-layer"
import { StockQuotePopover } from "./stock-quote-popover"
import { PremarketSynthszrLayer } from "./premarket-synthszr-layer"
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from "@/lib/data/companies"
import { COMPANY_ALIASES } from "@/lib/data/company-aliases"
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
  const [showQuote, setShowQuote] = useState(false)

  // Neon colors matching stock performance badges (P3 enhanced)
  const ratingBadgeStyles = {
    BUY: 'bg-neon-green text-black',
    HOLD: 'bg-neon-yellow text-black',
    SELL: 'bg-neon-orange text-black',
  }

  const ratingLabels = {
    BUY: 'Buy',
    HOLD: 'Hold',
    SELL: 'Sell',
  }

  // Percentage direction styling (P3 enhanced)
  const directionStyles = {
    up: 'bg-neon-green text-black',
    down: 'bg-neon-orange text-black',
    neutral: 'bg-gray-300 text-black',
  }

  const directionArrows = {
    up: '↑',
    down: '↓',
    neutral: '→',
  }

  // Only show stock quote for companies with ticker data
  const hasQuoteData = ticker && typeof changePercent === 'number'

  return (
    <>
      <span className="inline-flex items-baseline gap-1 text-foreground text-[13px]">
        {isFirst && <span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span>}
        {!isFirst && <span>,</span>}
        {/* Company name, ticker, percentage - clickable for stock quote (if available) */}
        <span
          onClick={hasQuoteData ? () => setShowQuote(true) : undefined}
          className={`ml-1 ${hasQuoteData ? 'hover:underline cursor-pointer' : ''}`}
        >
          {displayName}
          {ticker && <span className="text-muted-foreground"> ({ticker})</span>}
          {typeof changePercent === 'number' && direction && (
            <span className={`ml-1 px-1 py-0.5 rounded text-xs font-bold ${directionStyles[direction]}`}>
              {directionArrows[direction]}{Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
        </span>
        {/* Rating badge - clickable for Synthszr analysis */}
        <span
          onClick={() => setShowSynthszr(true)}
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold not-italic cursor-pointer hover:opacity-80 ${ratingBadgeStyles[rating]}`}
        >
          {ratingLabels[rating]}
        </span>
      </span>
      {showSynthszr && (
        <StockSynthszrLayer
          company={company}
          onClose={() => setShowSynthszr(false)}
        />
      )}
      {showQuote && (
        <StockQuotePopover
          company={company}
          onClose={() => setShowQuote(false)}
        />
      )}
    </>
  )
}

function PremarketRatingLink({ company, displayName, rating, isFirst, isin }: PremarketRatingLinkProps) {
  const [showPremarket, setShowPremarket] = useState(false)

  // Neon colors matching stock performance badges (P3 enhanced)
  const ratingBadgeStyles = {
    BUY: 'bg-neon-green text-black',
    HOLD: 'bg-neon-yellow text-black',
    SELL: 'bg-neon-orange text-black',
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
        className="inline-flex items-baseline gap-1 hover:underline cursor-pointer text-foreground text-[13px]"
      >
        {isFirst ? (
          <span><span className="font-bold uppercase text-[0.8125em]">Synthszr Vote:</span> {displayName}</span>
        ) : (
          <span>, {displayName}</span>
        )}
        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold not-italic ${ratingBadgeStyles[rating]}`}>
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

interface ArticleThumbnail {
  id: string
  article_index: number
  article_queue_item_id: string | null
  image_url: string
  vote_color: string
  generation_status: string
}

interface TiptapRendererProps {
  content: Record<string, unknown>
  postId?: string // Optional: enables article thumbnail display
  queueItemIds?: string[] // Optional: queue item IDs for stable thumbnail matching
  originalContent?: Record<string, unknown> // Original German content for company detection in translations
}

export function TiptapRenderer({ content, postId, queueItemIds, originalContent }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const [ratingPortals, setRatingPortals] = useState<Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isFirst: boolean }>>([])
  const [premarketRatingPortals, setPremarketRatingPortals] = useState<Array<{ element: HTMLElement; company: string; displayName: string; rating: 'BUY' | 'HOLD' | 'SELL'; isFirst: boolean; isin?: string }>>([])
  const [articleThumbnails, setArticleThumbnails] = useState<ArticleThumbnail[]>([])
  const [thumbnailPortals, setThumbnailPortals] = useState<Array<{ element: HTMLElement; thumbnail: ArticleThumbnail; h2Element: HTMLElement }>>([])

  // Auto-open dialog state from URL params (for newsletter links)
  const [autoOpenStock, setAutoOpenStock] = useState<string | null>(null)
  const [autoOpenPremarket, setAutoOpenPremarket] = useState<string | null>(null)

  // Device pixel ratio for 1:1 thumbnail rendering (Retina optimization)
  const [devicePixelRatio, setDevicePixelRatio] = useState(1)

  // Track if mounted (for safe document.body portal usage)
  const [isMounted, setIsMounted] = useState(false)

  // Track companies that have already been triggered for generation (prevents infinite loops)
  const generationTriggeredRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setIsMounted(true)
    setDevicePixelRatio(window.devicePixelRatio || 1)
  }, [])

  // Fetch article thumbnails when postId is provided
  useEffect(() => {
    if (!postId) return

    async function fetchThumbnails() {
      try {
        const response = await fetch(`/api/generate-article-thumbnails?postId=${postId}`)
        if (response.ok) {
          const data = await response.json()
          setArticleThumbnails(data.thumbnails || [])
        }
      } catch (error) {
        console.error('[TiptapRenderer] Failed to fetch article thumbnails:', error)
      }
    }

    fetchThumbnails()
  }, [postId])

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

  // Track when editor content is ready in DOM
  const [editorReady, setEditorReady] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // Use HeadingWithQueueId for stable thumbnail matching
      }),
      HeadingWithQueueId.configure({
        levels: [1, 2, 3, 4, 5, 6],
      }),
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
    // Use onCreate to know when editor is actually ready
    onCreate: () => {
      // Small delay to ensure React has flushed DOM updates
      requestAnimationFrame(() => {
        setEditorReady(true)
      })
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
        // Reset editorReady so processing waits for new content
        setEditorReady(false)
        editor.commands.setContent(content)
        // Re-trigger ready state after content update
        requestAnimationFrame(() => setEditorReady(true))
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
      /synthszr meent:?/gi,        // NDS (Low German)
      /pohled synthszr:?/gi,       // Czech (actual translation)
      /synthszr říká:?/gi,         // Czech alternative
      /synthszr hodnocení:?/gi,    // Czech alternative
    ]

    const isSyntheseText = (text: string) => {
      const lower = text.toLowerCase()
      return lower.includes('mattes synthese') ||
             lower.includes("mattes' synthese") ||
             lower.includes('synthszr take') ||
             lower.includes('synthszr vote') ||
             lower.includes('synthszr meent') ||       // NDS
             lower.includes('pohled synthszr') ||      // Czech
             lower.includes('synthszr říká') ||        // Czech alternative
             lower.includes('synthszr hodnocení')      // Czech alternative
    }

    // First check headings
    const headings = containerRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
    headings.forEach((heading) => {
      const text = heading.textContent || ''
      if (isSyntheseText(text)) {
        heading.classList.add('mattes-synthese-heading')
      }
    })

    // Helper to highlight last sentence in a paragraph
    const highlightLastSentence = (paragraph: Element) => {
      if (paragraph.classList.contains('synthszr-last-sentence-processed')) return
      paragraph.classList.add('synthszr-last-sentence-processed')

      // Get all text content, find last sentence boundary
      const fullText = paragraph.textContent || ''
      // Find last ". " that's followed by a capital letter (start of new sentence)
      const sentenceEndRegex = /\.\s+(?=[A-ZÄÖÜ])/g
      let lastSentenceStart = 0
      let match
      while ((match = sentenceEndRegex.exec(fullText)) !== null) {
        lastSentenceStart = match.index + match[0].length
      }

      if (lastSentenceStart === 0) return // No sentence boundary found

      // Walk through text nodes to find and wrap the last sentence
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null)
      let charCount = 0
      const nodesToWrap: Array<{ node: Text; start: number; end: number }> = []

      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text | null)) {
        const nodeText = textNode.textContent || ''
        const nodeStart = charCount
        const nodeEnd = charCount + nodeText.length

        if (nodeEnd > lastSentenceStart && nodeStart < fullText.length) {
          const wrapStart = Math.max(0, lastSentenceStart - nodeStart)
          const wrapEnd = nodeText.length
          if (wrapStart < wrapEnd) {
            nodesToWrap.push({ node: textNode, start: wrapStart, end: wrapEnd })
          }
        }
        charCount = nodeEnd
      }

      // Wrap the text nodes
      for (const { node, start, end } of nodesToWrap) {
        const text = node.textContent || ''
        if (start === 0 && end === text.length) {
          // Wrap entire node
          const wrapper = document.createElement('span')
          wrapper.className = 'synthszr-last-sentence'
          node.parentNode?.insertBefore(wrapper, node)
          wrapper.appendChild(node)
        } else {
          // Split and wrap partial
          const before = text.slice(0, start)
          const toWrap = text.slice(start, end)
          const after = text.slice(end)

          const parent = node.parentNode
          if (parent) {
            if (before) {
              parent.insertBefore(document.createTextNode(before), node)
            }
            const wrapper = document.createElement('span')
            wrapper.className = 'synthszr-last-sentence'
            wrapper.textContent = toWrap
            parent.insertBefore(wrapper, node)
            if (after) {
              parent.insertBefore(document.createTextNode(after), node)
            }
            parent.removeChild(node)
          }
        }
      }
    }

    // Then check bold/strong elements
    const strongElements = containerRef.current.querySelectorAll('strong, b')
    strongElements.forEach((strong) => {
      const text = strong.textContent || ''
      if (isSyntheseText(text)) {
        strong.classList.add('mattes-synthese')
        // Find parent paragraph and highlight last sentence
        let parent: Element | null = strong.parentElement
        while (parent && parent.tagName !== 'P' && parent !== containerRef.current) {
          parent = parent.parentElement
        }
        if (parent && parent.tagName === 'P') {
          highlightLastSentence(parent)
        }
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

        // Find parent paragraph and highlight last sentence
        let paragraph: Element | null = parent as Element
        while (paragraph && paragraph.tagName !== 'P' && paragraph !== containerRef.current) {
          paragraph = paragraph.parentElement
        }
        if (paragraph && paragraph.tagName === 'P') {
          highlightLastSentence(paragraph)
        }
      }
    }
  }, [])

  // Add Synthszr rating links at the end of each Synthszr Take section
  const processSynthszrRatingLinks = useCallback(async () => {
    if (!containerRef.current) return

    // Find all Synthszr Take / Mattes Synthese markers
    const syntheszrMarkers = containerRef.current.querySelectorAll('.mattes-synthese, .mattes-synthese-heading')
    if (syntheszrMarkers.length === 0) return

    // Pre-extract {Company} tags from each section of the original content
    // This allows section-specific tag matching for translations
    const originalSectionTags: string[] = []
    if (originalContent) {
      // Extract sections from original TipTap content (split by headings or Synthszr Take)
      const extractSectionsWithTags = (doc: unknown): string[] => {
        if (!doc || typeof doc !== 'object') return []
        const d = doc as Record<string, unknown>
        if (!Array.isArray(d.content)) return []

        const sections: string[] = []
        let currentSectionTags = ''

        const extractTagsFromNode = (node: unknown): string => {
          if (!node || typeof node !== 'object') return ''
          const n = node as Record<string, unknown>
          if (n.type === 'text' && typeof n.text === 'string') {
            const matches = n.text.match(/\{[A-Za-z0-9.\-\s]+\}/g)
            return matches ? matches.join(' ') : ''
          }
          if (Array.isArray(n.content)) {
            return n.content.map(extractTagsFromNode).join(' ')
          }
          return ''
        }

        const getNodeText = (node: unknown): string => {
          if (!node || typeof node !== 'object') return ''
          const n = node as Record<string, unknown>
          if (n.type === 'text' && typeof n.text === 'string') return n.text
          if (Array.isArray(n.content)) {
            return n.content.map(getNodeText).join('')
          }
          return ''
        }

        const isSynthszrTakeNode = (node: unknown): boolean => {
          const text = getNodeText(node).toLowerCase()
          return text.includes('synthszr take') ||
                 text.includes('mattes synthese') ||
                 text.includes('synthszr vote') ||
                 text.includes('synthszr meent') ||    // NDS
                 text.includes('pohled synthszr')      // Czech
        }

        for (const node of d.content as unknown[]) {
          const n = node as Record<string, unknown>
          // Check if this is a Synthszr Take paragraph - marks end of a section
          if (n.type === 'paragraph' && isSynthszrTakeNode(node)) {
            // Add tags from this paragraph too
            currentSectionTags += ' ' + extractTagsFromNode(node)
            // Save section and start new one
            sections.push(currentSectionTags.trim())
            currentSectionTags = ''
          } else {
            // Accumulate tags from this node
            currentSectionTags += ' ' + extractTagsFromNode(node)
          }
        }
        // Don't forget last section if no trailing Synthszr Take
        if (currentSectionTags.trim()) {
          sections.push(currentSectionTags.trim())
        }

        return sections
      }

      originalSectionTags.push(...extractSectionsWithTags(originalContent))
    }

    // For each marker, find the containing paragraph/section and extract companies
    const sectionsToProcess: Array<{
      element: Element
      companies: Array<{ apiName: string; displayName: string }>
      premarketCompanies: Array<{ apiName: string; displayName: string }>
    }> = []

    let sectionIndex = 0
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
      // NOTE: Use innerText instead of textContent to preserve whitespace from <br> tags
      // This ensures word boundaries work correctly (e.g., "AM<br>Anthropic" → "AM Anthropic" not "AMAnthropic")
      let textToSearch = ''
      let prevElement = container.previousElementSibling
      while (prevElement) {
        // Stop if we hit a heading (new section)
        if (prevElement.tagName.match(/^H[1-6]$/)) break
        // Stop if we hit another Synthszr Take
        const prevText = (prevElement as HTMLElement).innerText || prevElement.textContent || ''
        if (prevText.toLowerCase().includes('synthszr take') ||
            prevText.toLowerCase().includes('mattes synthese')) break
        // Collect text from paragraphs
        if (prevElement.tagName === 'P') {
          textToSearch = prevText + ' ' + textToSearch
        }
        prevElement = prevElement.previousElementSibling
      }

      // Also include the Synthszr Take paragraph itself
      textToSearch += ' ' + ((container as HTMLElement).innerText || container.textContent || '')

      // For translated content, use section-specific {Company} tags from original German content
      // This ensures each translated section only gets tags from its corresponding original section
      const explicitCompanyTags = originalSectionTags[sectionIndex] || ''
      sectionIndex++

      // Find all mentioned public companies in the combined text
      // Matches: "Meta", "Metas" (possessive), "Google-Aktien" (compound), or {Meta} (explicit)
      // Also check explicitCompanyTags from original content for {Company} tags
      const companies: Array<{ apiName: string; displayName: string }> = []
      for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
        // Skip excluded words (common nouns that aren't companies)
        if (isExcludedCompanyName(displayName)) continue

        const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
        const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
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
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
          premarketCompanies.push({ apiName, displayName })
        }
      }

      // Check for company aliases (e.g., "Cursor" -> "Anysphere")
      for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
        const escapedAlias = aliasName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`\\b${escapedAlias}s?\\b`, 'gi')
        const explicitRegex = new RegExp(`\\{${escapedAlias}\\}`, 'gi')
        if (regex.test(textToSearch) || explicitRegex.test(textToSearch) || explicitRegex.test(explicitCompanyTags)) {
          const apiName = aliasInfo.canonical.toLowerCase()
          if (aliasInfo.type === 'public') {
            if (!companies.find(c => c.apiName === apiName)) {
              companies.push({ apiName, displayName: aliasInfo.canonical })
            }
          } else {
            if (!premarketCompanies.find(c => c.apiName === apiName)) {
              premarketCompanies.push({ apiName, displayName: aliasInfo.canonical })
            }
          }
        }
      }

      if (companies.length > 0 || premarketCompanies.length > 0) {
        sectionsToProcess.push({ element: container, companies, premarketCompanies })
      }
    })

    // ALSO scan the ENTIRE document for explicit {Company} tags
    // This catches companies tagged anywhere, not just near "Synthszr Take" sections
    const explicitTagPattern = /\{([^}]+)\}/g
    const fullText = (containerRef.current as HTMLElement).innerText || containerRef.current.textContent || ''

    // For translated content, also scan originalContent for {Company} tags
    // This ensures tags are found even if translation didn't preserve them
    let originalText = ''
    if (originalContent) {
      const extractText = (node: unknown): string => {
        if (!node || typeof node !== 'object') return ''
        const n = node as Record<string, unknown>
        if (n.type === 'text' && typeof n.text === 'string') return n.text
        if (Array.isArray(n.content)) {
          return n.content.map(extractText).join(' ')
        }
        return ''
      }
      originalText = extractText(originalContent)
    }

    // Combine matches from both rendered text and original content
    const combinedText = fullText + ' ' + originalText
    const explicitMatches = [...combinedText.matchAll(explicitTagPattern)]

    if (explicitMatches.length > 0) {
      const explicitCompanies: Array<{ apiName: string; displayName: string }> = []
      const explicitPremarketCompanies: Array<{ apiName: string; displayName: string }> = []

      for (const match of explicitMatches) {
        const taggedName = match[1].trim()

        // Check against KNOWN_COMPANIES (case-insensitive)
        for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
          if (displayName.toLowerCase() === taggedName.toLowerCase()) {
            if (!explicitCompanies.find(c => c.apiName === apiName)) {
              explicitCompanies.push({ apiName, displayName })
            }
            break
          }
        }

        // Check against KNOWN_PREMARKET_COMPANIES (case-insensitive)
        for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
          if (displayName.toLowerCase() === taggedName.toLowerCase()) {
            if (!explicitPremarketCompanies.find(c => c.apiName === apiName)) {
              explicitPremarketCompanies.push({ apiName, displayName })
            }
            break
          }
        }

        // Check against COMPANY_ALIASES (case-insensitive)
        for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
          if (aliasName.toLowerCase() === taggedName.toLowerCase()) {
            const apiName = aliasInfo.canonical.toLowerCase()
            if (aliasInfo.type === 'public') {
              if (!explicitCompanies.find(c => c.apiName === apiName)) {
                explicitCompanies.push({ apiName, displayName: aliasInfo.canonical })
              }
            } else {
              if (!explicitPremarketCompanies.find(c => c.apiName === apiName)) {
                explicitPremarketCompanies.push({ apiName, displayName: aliasInfo.canonical })
              }
            }
            break
          }
        }
      }

      // If we found explicit companies, add them to a section
      // Use the last Synthszr Take section, or create a new container at the end
      if (explicitCompanies.length > 0 || explicitPremarketCompanies.length > 0) {
        // Find the last paragraph in the document for placing the badges
        const lastParagraph = containerRef.current.querySelector('p:last-of-type')
        if (lastParagraph && !lastParagraph.classList.contains('synthszr-ratings-processed')) {
          // Filter out companies already added to other sections
          const existingApiNames = new Set(sectionsToProcess.flatMap(s =>
            [...s.companies.map(c => c.apiName), ...s.premarketCompanies.map(c => c.apiName)]
          ))
          const newCompanies = explicitCompanies.filter(c => !existingApiNames.has(c.apiName))
          const newPremarketCompanies = explicitPremarketCompanies.filter(c => !existingApiNames.has(c.apiName))

          if (newCompanies.length > 0 || newPremarketCompanies.length > 0) {
            sectionsToProcess.push({
              element: lastParagraph,
              companies: newCompanies,
              premarketCompanies: newPremarketCompanies
            })
          }
        }
      }
    }

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

      // Identify companies WITHOUT cached ratings - trigger generation in background
      // Only trigger for companies not already in the generation queue (prevents infinite loops)
      const companiesWithoutRatings = (publicResponse.ok && publicResponse.quotes || [])
        .filter((r: BatchQuoteResult) => r.rating === null)
        .map((r: BatchQuoteResult) => r.company)
        .filter((company: string) => !generationTriggeredRef.current.has(company.toLowerCase()))

      if (companiesWithoutRatings.length > 0) {
        console.log(`[TiptapRenderer] Triggering rating generation for ${companiesWithoutRatings.length} companies:`, companiesWithoutRatings)

        // Mark these companies as triggered (prevents re-triggering on refresh)
        companiesWithoutRatings.forEach((company: string) => {
          generationTriggeredRef.current.add(company.toLowerCase())
        })

        // Fire-and-forget: Generate ratings in background, then re-run this function
        Promise.all(
          companiesWithoutRatings.map((company: string) =>
            fetch('/api/stock-synthszr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ company }),
            }).catch(err => console.error(`[TiptapRenderer] Rating generation failed for ${company}:`, err))
          )
        ).then(() => {
          // After all generations complete, re-run to show the new ratings
          console.log('[TiptapRenderer] Rating generation complete, refreshing...')
          // Small delay to ensure cache is updated
          setTimeout(() => {
            // Clear processed markers to allow re-processing
            if (containerRef.current) {
              containerRef.current.querySelectorAll('.synthszr-ratings-processed').forEach(el => {
                el.classList.remove('synthszr-ratings-processed')
                // Remove existing rating containers
                el.querySelectorAll('.synthszr-ratings-container').forEach(c => c.remove())
              })
            }
            // Re-run the rating link processor
            processSynthszrRatingLinks()
          }, 500)
        })
      }

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
        ratingsContainer.className = 'synthszr-ratings-container'
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

        // Add a space before the ratings container
        const space = document.createTextNode(' ')
        section.element.appendChild(space)

        // Append to end of paragraph
        section.element.appendChild(ratingsContainer)
        section.element.classList.add('synthszr-ratings-processed')
      }

      setRatingPortals(publicPortals)
      setPremarketRatingPortals(premarketPortals)
    } catch (error) {
      console.error('[TiptapRenderer] Failed to fetch Synthszr ratings:', error)
    }
  }, [originalContent])

  // Process news headings: add favicon + link, remove source links from paragraphs, insert thumbnails
  const processNewsHeadings = useCallback(() => {
    if (!containerRef.current) return

    // Find all H2 headings (news headlines)
    const h2s = containerRef.current.querySelectorAll('h2')
    const newThumbnailPortals: Array<{ element: HTMLElement; thumbnail: ArticleThumbnail; h2Element: HTMLElement }> = []
    let articleIndex = 0

    h2s.forEach((h2) => {
      // Skip "Mattes Synthese" / "Synthszr Take" headings entirely
      const headingText = h2.textContent?.toLowerCase() || ''
      if (headingText.includes('mattes synthese') || headingText.includes("mattes' synthese") || headingText.includes('synthszr take')) return

      // Get queue item ID for thumbnail matching
      // PRIORITY ORDER for queueItemId:
      // 1. data-queue-item-id from DOM (most stable - survives reordering)
      // 2. queueItemIds array by position (legacy fallback)
      // 3. article_index match (oldest fallback)
      const domQueueItemId = h2.getAttribute('data-queue-item-id')
      const arrayQueueItemId = queueItemIds?.[articleIndex]
      const expectedQueueItemId = domQueueItemId || arrayQueueItemId

      // THUMBNAIL INSERTION: Check separately from main processing
      // This allows thumbnails to be inserted even if H2 was already processed
      // (handles case where thumbnails load after initial render)
      if (!h2.previousElementSibling?.classList.contains('article-thumbnail-container')) {
        const thumbnail = articleThumbnails.find(t => {
          if (t.generation_status !== 'completed') return false
          // Match by queue item ID (stable) - works with both DOM and array-based IDs
          if (expectedQueueItemId && t.article_queue_item_id === expectedQueueItemId) {
            return true
          }
          // Always also try article_index matching (handles legacy + mismatched queue IDs)
          return t.article_index === articleIndex
        })
        if (thumbnail) {
          // Add separator before thumbnail (except for first article)
          if (articleIndex > 0) {
            const separator = document.createElement('div')
            separator.className = 'article-separator h-8 my-8'
            h2.parentNode?.insertBefore(separator, h2)
          }
          const thumbnailContainer = document.createElement('div')
          thumbnailContainer.className = 'article-thumbnail-container flex justify-center my-4'
          h2.parentNode?.insertBefore(thumbnailContainer, h2)
          newThumbnailPortals.push({ element: thumbnailContainer, thumbnail, h2Element: h2 as HTMLElement })
        }
      }

      // Skip rest of processing if already processed (favicon, links, etc.)
      const alreadyProcessed = h2.classList.contains('news-heading-processed')

      // Add anchor ID for deep linking (always, even if processed - ensures ID is set)
      h2.id = `article-${articleIndex}`
      articleIndex++

      if (alreadyProcessed) return

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

    // Update thumbnail portals after processing all headings
    if (newThumbnailPortals.length > 0) {
      setThumbnailPortals(newThumbnailPortals)
    }
  }, [articleThumbnails, queueItemIds])

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

  // Process news headings and rating links after editor is ready
  useEffect(() => {
    if (!editorReady || !containerRef.current) return

    // Verify DOM has actual content before processing (prevents race condition)
    const hasContent = containerRef.current.querySelector('.ProseMirror')?.textContent?.trim()
    if (!hasContent) {
      // Retry after a short delay
      const retryId = setTimeout(() => setEditorReady(false), 50)
      const resetId = setTimeout(() => setEditorReady(true), 150)
      return () => {
        clearTimeout(retryId)
        clearTimeout(resetId)
      }
    }

    const processContent = async () => {
      processNewsHeadings() // Process news headings (adds favicons, removes source links, inserts thumbnails)
      processMattesSyntheseText()
      // Process Synthszr rating links BEFORE hiding {Company} tags
      // so the company detection can find explicit tags
      // IMPORTANT: Wait for async processSynthszrRatingLinks to complete before hiding tags
      await processSynthszrRatingLinks()
      // Hide {Company} syntax AFTER company detection and badge placement
      hideExplicitCompanyTags()

      // Scroll to anchor if URL has hash (IDs are set after React renders)
      const hash = window.location.hash
      if (hash) {
        const element = document.querySelector(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' })
        }
      }
    }

    processContent()
  }, [editorReady, content, hideExplicitCompanyTags, processMattesSyntheseText, processNewsHeadings, processSynthszrRatingLinks])

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

      {/* Article thumbnails (circular with vote-colored backgrounds) */}
      {thumbnailPortals.map(({ element, thumbnail, h2Element }, index) => {
        // Find the best vote color from ratings in this article section
        // BUY > HOLD > SELL > NONE (priority for thumbnail background)
        const votePriority: Record<string, number> = { 'BUY': 3, 'HOLD': 2, 'SELL': 1 }
        const voteClasses: Record<string, string> = {
          'BUY': 'bg-neon-green',
          'HOLD': 'bg-neon-yellow',
          'SELL': 'bg-neon-orange',
          'NONE': 'bg-neon-cyan'
        }

        // Find next H2 to define article section boundary
        let nextH2: Element | null = h2Element.nextElementSibling
        while (nextH2 && nextH2.tagName !== 'H2') {
          nextH2 = nextH2.nextElementSibling
        }

        // Collect all ratings in this article section
        const allRatings = [...ratingPortals, ...premarketRatingPortals]
        let bestVote: 'BUY' | 'HOLD' | 'SELL' | null = null

        for (const ratingPortal of allRatings) {
          const el = ratingPortal.element
          // Check if element is after h2Element and before nextH2
          if (h2Element.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
            if (!nextH2 || nextH2.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) {
              // This rating is in our article section
              const rating = ratingPortal.rating
              if (!bestVote || votePriority[rating] > votePriority[bestVote]) {
                bestVote = rating
              }
            }
          }
        }

        const bgClass = bestVote ? voteClasses[bestVote] : voteClasses['NONE']

        // Calculate display size for 1:1 pixel rendering
        // On Retina (dpr=2): 302px CSS = 604 physical pixels = 1:1 with our 604px image
        // On non-Retina (dpr=1): Use 604px CSS for 1:1 (larger but sharp)
        const displaySize = Math.round(604 / devicePixelRatio)

        return createPortal(
          <div
            className={`rounded-full overflow-hidden mx-auto ${bgClass} bg-neon-pulse`}
            style={{
              width: displaySize,
              height: displaySize,
            }}
          >
            <Image
              src={thumbnail.image_url}
              alt={`Article ${thumbnail.article_index + 1} thumbnail`}
              width={displaySize}
              height={displaySize}
              unoptimized
              style={{ imageRendering: 'pixelated' }}
            />
          </div>,
          element,
          `thumbnail-${index}`
        )
      })}

      {/* Auto-open dialogs from URL params (newsletter email links) */}
      {/* Render to document.body via portal to avoid CSS context issues with thumbnails */}
      {isMounted && autoOpenStock && createPortal(
        <StockSynthszrLayer
          company={autoOpenStock}
          onClose={() => setAutoOpenStock(null)}
        />,
        document.body
      )}
      {isMounted && autoOpenPremarket && createPortal(
        <PremarketSynthszrLayer
          company={autoOpenPremarket}
          onClose={() => setAutoOpenPremarket(null)}
        />,
        document.body
      )}
    </div>
  )
}
