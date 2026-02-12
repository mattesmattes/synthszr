"use client"

// TipTap content renderer with Synthszr Vote badges
// Supports: DE, EN, NDS (Low German), CS (Czech) translations

import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { createPortal } from "react-dom"
import { HeadingWithQueueId } from "@/lib/tiptap/heading-with-queue-id"
import { StockSynthszrLayer } from "../stock-synthszr-layer"
import { PremarketSynthszrLayer } from "../premarket-synthszr-layer"
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from "@/lib/data/companies"

// DOM processors
import { processMattesSyntheseText } from "@/lib/tiptap/dom-processors/synthese-text"
import { processSynthszrRatingLinks } from "@/lib/tiptap/dom-processors/rating-links"
import { processNewsHeadings } from "@/lib/tiptap/dom-processors/news-headings"
import { hideExplicitCompanyTags } from "@/lib/tiptap/dom-processors/company-tags"
import { sanitizeAllLinks } from "@/lib/tiptap/dom-processors/link-sanitizer"

// Sub-components
import { SynthszrRatingLink } from "./synthszr-rating-link"
import { PremarketRatingLink } from "./premarket-rating-link"
import { ArticleThumbnailPortal } from "./article-thumbnail"

// Types
import type { TiptapRendererProps, PublicPortal, PremarketPortal } from "./types"
import type { ArticleThumbnail, ThumbnailPortal } from "@/lib/tiptap/dom-processors/news-headings"

export function TiptapRenderer({ content, postId, queueItemIds, originalContent }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const [ratingPortals, setRatingPortals] = useState<PublicPortal[]>([])
  const [premarketRatingPortals, setPremarketRatingPortals] = useState<PremarketPortal[]>([])
  const [articleThumbnails, setArticleThumbnails] = useState<ArticleThumbnail[]>([])
  const [thumbnailPortals, setThumbnailPortals] = useState<ThumbnailPortal[]>([])

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
      const matchedCompany = Object.entries(KNOWN_COMPANIES).find(
        ([displayName]) => displayName.toLowerCase() === stockParam.toLowerCase()
      )
      if (matchedCompany) {
        setAutoOpenStock(matchedCompany[1])
      }
    }

    if (premarketParam) {
      const matchedCompany = Object.entries(KNOWN_PREMARKET_COMPANIES).find(
        ([displayName]) => displayName.toLowerCase() === premarketParam.toLowerCase()
      )
      if (matchedCompany) {
        setAutoOpenPremarket(matchedCompany[1])
      }
    }
  }, [searchParams])

  // Track when editor content is ready in DOM
  const [editorReady, setEditorReady] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
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
    onCreate: () => {
      requestAnimationFrame(() => {
        setEditorReady(true)
      })
    },
  })

  // Update content when prop changes
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON())
      const newContent = JSON.stringify(content)
      if (currentContent !== newContent) {
        setEditorReady(false)
        editor.commands.setContent(content)
        requestAnimationFrame(() => setEditorReady(true))
      }
    }
  }, [editor, content])

  // Callback for rating-links processor to re-trigger processing after background generation
  const handleRefreshNeeded = useCallback(() => {
    if (!containerRef.current) return

    const runProcessing = async () => {
      processMattesSyntheseText(containerRef.current!)
      const result = await processSynthszrRatingLinks(
        containerRef.current!,
        originalContent,
        generationTriggeredRef,
        handleRefreshNeeded,
      )
      setRatingPortals(result.publicPortals)
      setPremarketRatingPortals(result.premarketPortals)
      hideExplicitCompanyTags(containerRef.current!)
    }

    runProcessing()
  }, [originalContent])

  // Process content after editor is ready
  useEffect(() => {
    if (!editorReady || !containerRef.current) return

    // Verify DOM has actual content before processing (prevents race condition)
    const hasContent = containerRef.current.querySelector('.ProseMirror')?.textContent?.trim()
    if (!hasContent) {
      const retryId = setTimeout(() => setEditorReady(false), 50)
      const resetId = setTimeout(() => setEditorReady(true), 150)
      return () => {
        clearTimeout(retryId)
        clearTimeout(resetId)
      }
    }

    const processContent = async () => {
      const container = containerRef.current!

      // 1. Sanitize all outbound link hrefs
      sanitizeAllLinks(container)

      // 2. Process news headings (adds favicons, removes source links, inserts thumbnails)
      const newThumbnailPortals = processNewsHeadings(container, articleThumbnails, queueItemIds)
      if (newThumbnailPortals.length > 0) {
        setThumbnailPortals(newThumbnailPortals)
      }

      // 3. Style Synthszr Take markers
      processMattesSyntheseText(container)

      // 4. Process Synthszr rating links BEFORE hiding {Company} tags
      const result = await processSynthszrRatingLinks(
        container,
        originalContent,
        generationTriggeredRef,
        handleRefreshNeeded,
      )
      setRatingPortals(result.publicPortals)
      setPremarketRatingPortals(result.premarketPortals)

      // 5. Hide {Company} syntax AFTER company detection and badge placement
      hideExplicitCompanyTags(container)

      // 6. Scroll to anchor if URL has hash
      const hash = window.location.hash
      if (hash) {
        const element = document.querySelector(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' })
        }
      }
    }

    processContent()
  }, [editorReady, content, articleThumbnails, queueItemIds, originalContent, handleRefreshNeeded])

  if (!editor) {
    return null
  }

  return (
    <div ref={containerRef}>
      <EditorContent editor={editor} />

      {/* Public company rating portals */}
      {ratingPortals.map((portal, index) =>
        createPortal(
          <SynthszrRatingLink
            company={portal.company}
            displayName={portal.displayName}
            rating={portal.rating}
            ticker={portal.ticker}
            changePercent={portal.changePercent}
            direction={portal.direction}
            isFirst={portal.isFirst}
          />,
          portal.element,
          `rating-${index}`
        )
      )}

      {/* Premarket company rating portals */}
      {premarketRatingPortals.map((portal, index) =>
        createPortal(
          <PremarketRatingLink
            company={portal.company}
            displayName={portal.displayName}
            rating={portal.rating}
            isFirst={portal.isFirst}
            isin={portal.isin}
          />,
          portal.element,
          `premarket-rating-${index}`
        )
      )}

      {/* Article thumbnails (circular with vote-colored backgrounds) */}
      {thumbnailPortals.map((portal, index) =>
        createPortal(
          <ArticleThumbnailPortal
            portal={portal}
            ratingPortals={ratingPortals}
            premarketRatingPortals={premarketRatingPortals}
            devicePixelRatio={devicePixelRatio}
          />,
          portal.element,
          `thumbnail-${index}`
        )
      )}

      {/* Auto-open dialogs from URL params (newsletter email links) */}
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
