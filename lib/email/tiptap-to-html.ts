/**
 * Convert TipTap JSON content to email-friendly HTML
 * Shared module for newsletter email generation
 */

import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

export interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  attrs?: Record<string, string | number>
}

export interface TiptapDoc {
  type: string
  content?: TiptapNode[]
}

// Rating badge styles (email-safe inline styles)
const RATING_STYLES = {
  BUY: 'background-color: #39FF14; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  HOLD: 'background-color: #9CA3AF; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
  SELL: 'background-color: #FF6600; color: #000; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-decoration: none;',
}

// Stock ticker badge styles
const TICKER_STYLES = {
  up: 'background-color: #39FF14; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: 600; font-size: 11px; font-family: monospace; white-space: nowrap;',
  down: 'background-color: #FF6600; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: 600; font-size: 11px; font-family: monospace; white-space: nowrap;',
  neutral: 'background-color: #9CA3AF; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: 600; font-size: 11px; font-family: monospace; white-space: nowrap;',
}

// Inline styles for email HTML (email clients ignore <style> tags)
// Gmail-optimized: Using !important and 18px base (Gmail renders at ~1x)
// Gmail scales emails based on container width - we use 600px which is standard
const EMAIL_STYLES = {
  p: 'font-family: Georgia, serif !important; font-size: 18px !important; line-height: 1.6 !important; color: #374151 !important; margin: 0 0 16px 0 !important;',
  h2: 'font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; font-size: 24px !important; font-weight: 600 !important; color: #1a1a1a !important; margin: 32px 0 12px 0 !important; line-height: 1.3 !important;',
  h3: 'font-family: -apple-system, BlinkMacSystemFont, sans-serif !important; font-size: 20px !important; font-weight: 600 !important; color: #1a1a1a !important; margin: 24px 0 10px 0 !important; line-height: 1.3 !important;',
  ul: 'font-family: Georgia, serif !important; font-size: 18px !important; line-height: 1.6 !important; color: #374151 !important; margin: 0 0 16px 0 !important; padding-left: 24px !important;',
  ol: 'font-family: Georgia, serif !important; font-size: 18px !important; line-height: 1.6 !important; color: #374151 !important; margin: 0 0 16px 0 !important; padding-left: 24px !important;',
  li: 'margin: 0 0 8px 0 !important; font-size: 18px !important;',
  blockquote: 'border-left: 4px solid #CCFF00 !important; padding-left: 16px !important; margin: 24px 0 !important; font-style: italic !important; color: #4b5563 !important; font-size: 18px !important;',
}

// Wrapper styles for Gmail compatibility (Gmail strips <style> tags)
const WRAPPER_STYLE = 'font-family: Georgia, serif !important; font-size: 18px !important; line-height: 1.6 !important; color: #374151 !important;'

/**
 * Wrap content in a styled div for Gmail compatibility
 * Gmail strips <style> tags so we need inline styles
 */
function wrapContentWithStyles(content: string): string {
  return `<div style="${WRAPPER_STYLE}">${content}</div>`
}

interface StockQuoteData {
  company: string
  changePercent: number
  direction: 'up' | 'down' | 'neutral'
}

interface RatingData {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  type: 'public' | 'premarket'
  isin?: string
}

/**
 * Fetch stock quotes for companies
 */
async function fetchStockQuotes(
  companies: string[],
  baseUrl: string
): Promise<Map<string, StockQuoteData>> {
  const quotesMap = new Map<string, StockQuoteData>()

  try {
    await Promise.all(
      companies.map(async (company) => {
        try {
          const res = await fetch(`${baseUrl}/api/stock-quote?company=${encodeURIComponent(company)}`)
          if (res.ok) {
            const data = await res.json()
            if (data.changePercent !== undefined) {
              quotesMap.set(company.toLowerCase(), {
                company,
                changePercent: data.changePercent,
                direction: data.direction || 'neutral',
              })
            }
          }
        } catch {
          // Silently fail for individual quotes
        }
      })
    )
  } catch (error) {
    console.error('[tiptap-to-html] Failed to fetch stock quotes:', error)
  }

  return quotesMap
}

/**
 * Fetch ratings for companies from APIs
 */
async function fetchRatings(
  publicCompanies: string[],
  premarketCompanies: string[],
  baseUrl: string
): Promise<Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>> {
  const ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()

  try {
    const [publicResponse, premarketResponse] = await Promise.all([
      publicCompanies.length > 0
        ? fetch(`${baseUrl}/api/stock-synthszr/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: publicCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
      premarketCompanies.length > 0
        ? fetch(`${baseUrl}/api/premarket/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: premarketCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
    ])

    // Process public ratings
    if (publicResponse.ok && publicResponse.ratings) {
      for (const r of publicResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'public' })
        }
      }
    }

    // Process premarket ratings
    if (premarketResponse.ok && premarketResponse.ratings) {
      for (const r of premarketResponse.ratings) {
        if (r.rating) {
          ratingsMap.set(r.company.toLowerCase(), { rating: r.rating, type: 'premarket', isin: r.isin })
        }
      }
    }
  } catch (error) {
    console.error('[tiptap-to-html] Failed to fetch ratings:', error)
  }

  return ratingsMap
}

/**
 * Find companies mentioned in text
 * Supports: natural mentions, possessive forms, compound words, and explicit {Company} tags
 */
function findCompaniesInText(text: string): { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> } {
  const publicCompanies: Array<{ apiName: string; displayName: string }> = []
  const premarketCompanies: Array<{ apiName: string; displayName: string }> = []

  // Find public companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_COMPANIES)) {
    const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      publicCompanies.push({ apiName, displayName })
    }
  }

  // Find premarket companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      premarketCompanies.push({ apiName, displayName })
    }
  }

  return { public: publicCompanies, premarket: premarketCompanies }
}

/**
 * Remove {Company} explicit tags from text
 */
function stripExplicitCompanyTags(text: string): string {
  return text.replace(/\{([^}]+)\}/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Generate HTML for vote badges
 * Uses bold uppercase for "Synthszr Vote:" prefix
 */
function generateVoteBadgesHtml(ratings: RatingData[], baseUrl: string, postSlug?: string): string {
  if (ratings.length === 0) return ''

  const badges = ratings.map((r, idx) => {
    const style = RATING_STYLES[r.rating]
    const label = r.rating === 'BUY' ? 'Buy' : r.rating === 'HOLD' ? 'Hold' : 'Sell'
    const prefix = idx === 0 ? '<span style="font-weight: bold; text-transform: uppercase;">Synthszr Vote:</span> ' : ', '

    // Link to analysis dialog on the blog post
    const href = postSlug
      ? `${baseUrl}/posts/${postSlug}?${r.type === 'premarket' ? 'premarket' : 'stock'}=${encodeURIComponent(r.displayName)}`
      : '#'

    return `${prefix}<a href="${href}" style="color: inherit; text-decoration: none;">${r.displayName}</a> <a href="${href}" style="${style}">${label}</a>`
  }).join('')

  return `<span style="margin-left: 8px; white-space: nowrap;">${badges}</span>`
}

/**
 * Convert post content to email-friendly HTML (sync version for backwards compatibility)
 * Handles both TipTap JSON objects and JSON strings
 */
export function generateEmailContent(post: { content?: unknown; excerpt?: string }): string {
  const rawContent = post.content

  // If content is a JSON string, parse it first
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return convertTiptapToHtml(parsed as TiptapDoc)
      }
    } catch {
      // Not JSON, might be HTML string - use as is
      return rawContent
    }
    // If we couldn't parse it and it's a string, return as is
    return rawContent
  }

  // If content is TipTap JSON object, convert to basic HTML
  if (rawContent && typeof rawContent === 'object') {
    return convertTiptapToHtml(rawContent as TiptapDoc)
  }

  // Fallback to excerpt
  return post.excerpt || ''
}

/**
 * Convert post content to email-friendly HTML with Synthszr Vote badges AND stock ticker badges
 * Async version that fetches ratings and quotes from APIs
 */
export async function generateEmailContentWithVotes(
  post: { content?: unknown; excerpt?: string; slug?: string },
  baseUrl: string
): Promise<string> {
  const rawContent = post.content
  let doc: TiptapDoc | null = null

  // Parse content
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        doc = parsed as TiptapDoc
      } else {
        // Return HTML wrapped in styled container for Gmail compatibility
        return wrapContentWithStyles(rawContent)
      }
    } catch {
      // Content is likely already HTML - wrap in styled container
      return wrapContentWithStyles(rawContent)
    }
  } else if (rawContent && typeof rawContent === 'object') {
    doc = rawContent as TiptapDoc
  }

  if (!doc || !doc.content) {
    return wrapContentWithStyles(post.excerpt || '')
  }

  // Extract full text to find ALL companies
  const fullText = doc.content.map(node => extractTextFromNode(node)).join(' ')
  const allCompaniesInDoc = findCompaniesInText(fullText)

  // Collect all public companies for stock quotes AND ratings
  const allPublicCompanies = new Set<string>()
  const allPremarketCompanies = new Set<string>()

  allCompaniesInDoc.public.forEach(c => allPublicCompanies.add(c.apiName))
  allCompaniesInDoc.premarket.forEach(c => allPremarketCompanies.add(c.apiName))

  // First pass: find all Synthszr Take paragraphs for vote badges
  const synthszrTakeParagraphs: { index: number; text: string }[] = []

  doc.content.forEach((node, index) => {
    if (node.type === 'paragraph') {
      const text = extractTextFromNode(node)
      if (/synthszr take:?/i.test(text)) {
        // Get text from surrounding paragraphs too (news context)
        let contextText = text
        // Look at previous 3 nodes for context
        for (let i = Math.max(0, index - 3); i < index; i++) {
          contextText = extractTextFromNode(doc!.content![i]) + ' ' + contextText
        }
        synthszrTakeParagraphs.push({ index, text: contextText })
      }
    }
  })

  // Collect companies for Synthszr Take vote badges
  const paragraphCompanies = new Map<number, { public: Array<{ apiName: string; displayName: string }>; premarket: Array<{ apiName: string; displayName: string }> }>()

  for (const para of synthszrTakeParagraphs) {
    const companies = findCompaniesInText(para.text)
    paragraphCompanies.set(para.index, companies)
  }

  // Fetch both stock quotes AND ratings in parallel
  const [stockQuotesMap, ratingsMap] = await Promise.all([
    allPublicCompanies.size > 0
      ? fetchStockQuotes(Array.from(allPublicCompanies), baseUrl)
      : Promise.resolve(new Map<string, StockQuoteData>()),
    (allPublicCompanies.size > 0 || allPremarketCompanies.size > 0)
      ? fetchRatings(Array.from(allPublicCompanies), Array.from(allPremarketCompanies), baseUrl)
      : Promise.resolve(new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; isin?: string }>()),
  ])

  // Build a set of company display names for ticker insertion
  const companyDisplayNames = new Map<string, { apiName: string; displayName: string }>()
  allCompaniesInDoc.public.forEach(c => companyDisplayNames.set(c.displayName.toLowerCase(), c))

  // Convert to HTML with vote badges and stock tickers
  const htmlParts = doc.content.map((node, index) => {
    const baseHtml = convertNodeToHtmlWithTickers(node, stockQuotesMap, companyDisplayNames)

    // Check if this is a Synthszr Take paragraph
    const companies = paragraphCompanies.get(index)
    if (companies && (companies.public.length > 0 || companies.premarket.length > 0)) {
      // Build ratings for this paragraph
      const ratings: RatingData[] = []

      for (const c of companies.public) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'public',
          })
        }
      }

      for (const c of companies.premarket) {
        const ratingData = ratingsMap.get(c.apiName.toLowerCase())
        if (ratingData) {
          ratings.push({
            company: c.apiName,
            displayName: c.displayName,
            rating: ratingData.rating,
            type: 'premarket',
            isin: ratingData.isin,
          })
        }
      }

      if (ratings.length > 0) {
        const voteBadges = generateVoteBadgesHtml(ratings, baseUrl, post.slug)
        // Insert badges before closing </p> tag
        return baseHtml.replace(/<\/p>$/, `${voteBadges}</p>`)
      }
    }

    return baseHtml
  })

  return htmlParts.join('\n')
}

/**
 * Extract plain text from a TipTap node
 */
function extractTextFromNode(node: TiptapNode): string {
  if (node.type === 'text') {
    return node.text || ''
  }
  if (node.content) {
    return node.content.map(extractTextFromNode).join('')
  }
  return ''
}

/**
 * Convert a single TipTap node to HTML
 */
function convertNodeToHtml(node: TiptapNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${renderContent(node.content)}</p>`
    case 'heading': {
      const level = node.attrs?.level || 2
      return `<h${level}>${renderContent(node.content)}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ul>`
    case 'orderedList':
      return `<ol>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ol>`
    case 'blockquote':
      return `<blockquote>${renderContent(node.content)}</blockquote>`
    case 'horizontalRule':
      return '<hr />'
    default:
      return renderContent(node.content)
  }
}

/**
 * Convert a single TipTap node to HTML with inline stock tickers AND inline styles
 */
function convertNodeToHtmlWithTickers(
  node: TiptapNode,
  stockQuotesMap: Map<string, StockQuoteData>,
  companyDisplayNames: Map<string, { apiName: string; displayName: string }>
): string {
  switch (node.type) {
    case 'paragraph':
      return `<p style="${EMAIL_STYLES.p}">${renderContentWithTickers(node.content, stockQuotesMap, companyDisplayNames)}</p>`
    case 'heading': {
      const level = node.attrs?.level || 2
      const style = level === 2 ? EMAIL_STYLES.h2 : EMAIL_STYLES.h3
      // No tickers in headings
      return `<h${level} style="${style}">${renderContent(node.content)}</h${level}>`
    }
    case 'bulletList':
      return `<ul style="${EMAIL_STYLES.ul}">${node.content?.map(li => `<li style="${EMAIL_STYLES.li}">${renderContentWithTickers(li.content?.[0]?.content, stockQuotesMap, companyDisplayNames)}</li>`).join('')}</ul>`
    case 'orderedList':
      return `<ol style="${EMAIL_STYLES.ol}">${node.content?.map(li => `<li style="${EMAIL_STYLES.li}">${renderContentWithTickers(li.content?.[0]?.content, stockQuotesMap, companyDisplayNames)}</li>`).join('')}</ol>`
    case 'blockquote':
      return `<blockquote style="${EMAIL_STYLES.blockquote}">${renderContentWithTickers(node.content, stockQuotesMap, companyDisplayNames)}</blockquote>`
    case 'horizontalRule':
      return '<hr />'
    default:
      return renderContentWithTickers(node.content, stockQuotesMap, companyDisplayNames)
  }
}

/**
 * Render TipTap node content with marks AND inline stock ticker badges
 */
function renderContentWithTickers(
  content: TiptapNode[] | undefined,
  stockQuotesMap: Map<string, StockQuoteData>,
  companyDisplayNames: Map<string, { apiName: string; displayName: string }>,
  usedCompanies: Set<string> = new Set()
): string {
  if (!content) return ''

  return content.map(node => {
    if (node.type === 'text') {
      let text = node.text || ''

      // Remove {Company} explicit tags from display
      text = stripExplicitCompanyTags(text)

      // Insert stock ticker badges after company names (first occurrence only)
      for (const [displayNameLower, companyInfo] of companyDisplayNames) {
        if (usedCompanies.has(displayNameLower)) continue

        const quote = stockQuotesMap.get(companyInfo.apiName.toLowerCase())
        if (!quote) continue

        // Match company name (case insensitive)
        const regex = new RegExp(`\\b(${companyInfo.displayName})\\b`, 'i')
        if (regex.test(text)) {
          usedCompanies.add(displayNameLower)

          const arrow = quote.direction === 'up' ? '↑' : quote.direction === 'down' ? '↓' : '→'
          const sign = quote.changePercent >= 0 ? '+' : ''
          const percentStr = `${sign}${quote.changePercent.toFixed(1)}%`
          const style = TICKER_STYLES[quote.direction]

          const tickerBadge = ` <span style="${style}">${arrow} ${percentStr}</span>`

          text = text.replace(regex, `$1${tickerBadge}`)
        }
      }

      // Check if text contains "Synthszr Take:" and style it
      const synthszrPattern = /(Synthszr Take:?)/gi
      const hasBoldMark = node.marks?.some(m => m.type === 'bold')

      // If "Synthszr Take:" is not already bold, wrap it with styling
      if (!hasBoldMark && synthszrPattern.test(text)) {
        text = text.replace(synthszrPattern, '<strong style="background-color: #CCFF00; padding: 2px 6px;">$1</strong>')
      }

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              // Check if this is "Synthszr Take:" - add background styling
              if (/synthszr take:?/i.test(text)) {
                text = `<strong style="background-color: #CCFF00; padding: 2px 6px;">${text}</strong>`
              } else {
                text = `<strong>${text}</strong>`
              }
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'link':
              text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
              break
          }
        }
      }

      return text
    }

    return ''
  }).join('')
}

/**
 * Convert TipTap document to HTML (sync version)
 */
export function convertTiptapToHtml(doc: TiptapDoc): string {
  if (!doc.content) return ''
  return doc.content.map(convertNodeToHtml).join('\n')
}

/**
 * Render TipTap node content with marks (bold, italic, links)
 * Includes special styling for "Synthszr Take:" sections
 */
function renderContent(content?: TiptapNode[]): string {
  if (!content) return ''

  return content.map(node => {
    if (node.type === 'text') {
      let text = node.text || ''

      // Remove {Company} explicit tags from display
      text = stripExplicitCompanyTags(text)

      // Check if text contains "Synthszr Take:" and style it
      const synthszrPattern = /(Synthszr Take:?)/gi
      const hasBoldMark = node.marks?.some(m => m.type === 'bold')

      // If "Synthszr Take:" is not already bold, wrap it with styling
      if (!hasBoldMark && synthszrPattern.test(text)) {
        text = text.replace(synthszrPattern, '<strong style="background-color: #CCFF00; padding: 2px 6px;">$1</strong>')
      }

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              // Check if this is "Synthszr Take:" - add background styling
              if (/synthszr take:?/i.test(text)) {
                text = `<strong style="background-color: #CCFF00; padding: 2px 6px;">${text}</strong>`
              } else {
                text = `<strong>${text}</strong>`
              }
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'link':
              text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
              break
          }
        }
      }

      return text
    }

    return ''
  }).join('')
}
