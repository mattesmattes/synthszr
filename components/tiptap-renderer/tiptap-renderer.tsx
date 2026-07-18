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
import { injectProductLinks, appendProductVoteBlock, type ProductLinkData } from "@/lib/tiptap/dom-processors/product-links"
import { processNewsHeadings } from "@/lib/tiptap/dom-processors/news-headings"
import { processBundleLabels } from "@/lib/tiptap/dom-processors/bundle-label"
import { hideExplicitCompanyTags } from "@/lib/tiptap/dom-processors/company-tags"
import { sanitizeAllLinks } from "@/lib/tiptap/dom-processors/link-sanitizer"
import { insertTipPromoSlot } from "@/lib/tiptap/dom-processors/tip-promo-slot"
import { TipPromoBox } from "../tip-promo-box"
import type { TipPromo } from "@/lib/tip-promos/types"

// Sub-components
import { SynthszrRatingLink } from "./synthszr-rating-link"
import { PremarketRatingLink } from "./premarket-rating-link"
import { ArticleThumbnailPortal } from "./article-thumbnail"

// Types
import type { TiptapRendererProps, PublicPortal, PremarketPortal } from "./types"
import type { ArticleThumbnail, ThumbnailPortal } from "@/lib/tiptap/dom-processors/news-headings"

export function TiptapRenderer({ content, postId, queueItemIds, originalContent, ssrFallbackId, locale = 'de' }: TiptapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const [ratingPortals, setRatingPortals] = useState<PublicPortal[]>([])
  const [premarketRatingPortals, setPremarketRatingPortals] = useState<PremarketPortal[]>([])
  const [articleThumbnails, setArticleThumbnails] = useState<ArticleThumbnail[]>([])
  const [thumbnailPortals, setThumbnailPortals] = useState<ThumbnailPortal[]>([])
  const [tipPromo, setTipPromo] = useState<TipPromo | null>(null)
  const [tipPromoSlot, setTipPromoSlot] = useState<HTMLElement | null>(null)

  // Auto-open dialog state from URL params (for newsletter links)
  const [autoOpenStock, setAutoOpenStock] = useState<string | null>(null)
  const [autoOpenPremarket, setAutoOpenPremarket] = useState<string | null>(null)

  // Device pixel ratio for 1:1 thumbnail rendering (Retina optimization)
  const [devicePixelRatio, setDevicePixelRatio] = useState(1)

  // Track if mounted (for safe document.body portal usage)
  const [isMounted, setIsMounted] = useState(false)

  // Track companies that have already been triggered for generation (prevents infinite loops)
  const generationTriggeredRef = useRef<Set<string>>(new Set())

  // Chart-Produkte (Name → Slug) für die Produkt-Verlinkung im Fließtext
  const [productLinks, setProductLinks] = useState<ProductLinkData>(new Map())

  useEffect(() => {
    setIsMounted(true)
    setDevicePixelRatio(window.devicePixelRatio || 1)
  }, [])

  // Chart-Produkte laden (für Produkt-Links im Text)
  useEffect(() => {
    let cancelled = false
    fetch('/api/rankings/products')
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((data: { products?: Array<{ name: string; slug: string; score: number; rank: number | null; spark: number[]; trend: 'up' | 'down' | 'flat' }> }) => {
        if (cancelled || !data?.products?.length) return
        setProductLinks(new Map(data.products.map((p) => [p.name.toLowerCase(), { displayName: p.name, slug: p.slug, score: p.score, rank: p.rank, spark: p.spark, trend: p.trend }])))
      })
      .catch(() => { /* silent — Produkt-Links sind nicht essenziell */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const seg = typeof window !== 'undefined' ? (window.location.pathname.split('/')[1] || 'de') : 'de'
    const locale = /^[a-z]{2,3}$/.test(seg) ? seg : 'de'
    fetch(`/api/tip-promos/active?locale=${encodeURIComponent(locale)}`)
      .then(r => r.ok ? r.json() : { promo: null })
      .then(data => { if (!cancelled && data?.promo) setTipPromo(data.promo) })
      .catch(() => { /* silent — tip-promo is non-essential */ })
    return () => { cancelled = true }
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
        link: false,
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

  // SSR-Fallback (statisches Server-HTML aus PostContentView) entfernen,
  // sobald der interaktive Editor mit Inhalt steht — sonst stünde der
  // Artikel doppelt im DOM.
  useEffect(() => {
    if (!editorReady || !ssrFallbackId) return
    // Nur entfernen, wenn der Editor wirklich Inhalt gerendert hat (der
    // Processing-Effect unten togglet editorReady bei leerem DOM erneut).
    const hasContent = containerRef.current?.querySelector('.ProseMirror')?.textContent?.trim()
    if (!hasContent) return
    document.getElementById(ssrFallbackId)?.remove()
  }, [editorReady, ssrFallbackId])

  // Callback for rating-links processor to re-trigger processing after background generation
  const handleRefreshNeeded = useCallback(() => {
    if (!containerRef.current) return

    const runProcessing = async () => {
      processMattesSyntheseText(containerRef.current!)
      hideExplicitCompanyTags(containerRef.current!)
      injectProductLinks(containerRef.current!, productLinks)
      appendProductVoteBlock(containerRef.current!, productLinks)
    }

    runProcessing()
  }, [originalContent, productLinks])

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

      // 1b. Bundle labels ("Thema des Tages" / "Nachlese") — MUST run before
      // processNewsHeadings, which derives its own thumbnail idempotency from
      // h2.previousElementSibling; inserting the badge afterwards would sit
      // between the thumbnail and the heading and break that check.
      processBundleLabels(container, locale)

      // 2. Process news headings (adds favicons, removes source links, inserts thumbnails)
      const newThumbnailPortals = processNewsHeadings(container, articleThumbnails, queueItemIds)
      if (newThumbnailPortals.length > 0) {
        setThumbnailPortals(newThumbnailPortals)
      }

      // 3. Style Synthszr Take markers
      processMattesSyntheseText(container)

      // 4. {Company}-Tags ausblenden
      hideExplicitCompanyTags(container)

      // 5. Produkt-Links im Fließtext (zu den Charts), NACH dem Ausblenden der {Company}-Tags
      injectProductLinks(container, productLinks)

      // 6. Produkt-Vote-Block (genannte Produkte + Momentum-Pills) je Synthszr Take
      appendProductVoteBlock(container, productLinks)

      // 7. Insert placeholder slot before the first Synthszr Take for the tip-promo box
      const slot = insertTipPromoSlot(container)
      setTipPromoSlot(slot)

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
  }, [editorReady, content, articleThumbnails, queueItemIds, originalContent, handleRefreshNeeded, productLinks, locale])

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

      {/* Tip-of-the-day promo box, mounted via portal into the slot
          inserted before the first Synthszr Take. */}
      {tipPromo && tipPromoSlot && createPortal(
        <TipPromoBox promo={tipPromo as TipPromo} inline />,
        tipPromoSlot,
        `tip-promo-${tipPromo.id}`
      )}

      {/* Article thumbnails (circular with vote-colored backgrounds) */}
      {thumbnailPortals.map((portal, index) =>
        createPortal(
          <ArticleThumbnailPortal
            portal={portal}
            productLinks={productLinks}
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
