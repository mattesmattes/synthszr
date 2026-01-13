/**
 * Convert TipTap JSON content to email-friendly HTML
 * Shared module for newsletter email generation
 */

import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { isExcludedCompanyName } from '@/lib/data/company-exclusions'

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

// Percentage change styles for vote badges (black text on colored background)
const PERCENT_STYLES = {
  up: 'background-color: #39FF14; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px;',
  down: 'background-color: #FF6600; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px;',
  neutral: 'background-color: #9CA3AF; color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px;',
}

interface RatingData {
  company: string
  displayName: string
  rating: 'BUY' | 'HOLD' | 'SELL'
  type: 'public' | 'premarket'
  ticker?: string
  changePercent?: number
  direction?: 'up' | 'down' | 'neutral'
  isin?: string
}

interface BatchQuoteResult {
  company: string
  displayName: string
  ticker: string | null
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral' | null
  rating: 'BUY' | 'HOLD' | 'SELL' | null
}

/**
 * Fetch ratings (with ticker/percent for public companies) from APIs
 * Uses batch-quotes for public companies (includes rating, ticker, percent)
 * Uses batch-ratings for premarket companies (rating only)
 */
async function fetchRatings(
  publicCompanies: string[],
  premarketCompanies: string[],
  baseUrl: string
): Promise<Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isin?: string }>> {
  const ratingsMap = new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isin?: string }>()

  try {
    const [publicResponse, premarketResponse] = await Promise.all([
      // Use batch-quotes for public companies (includes ticker + percent)
      publicCompanies.length > 0
        ? fetch(`${baseUrl}/api/stock-synthszr/batch-quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: publicCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, quotes: [] }))
        : Promise.resolve({ ok: true, quotes: [] }),
      // Use batch-ratings for premarket companies (rating only)
      premarketCompanies.length > 0
        ? fetch(`${baseUrl}/api/premarket/batch-ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: premarketCompanies }),
          }).then(r => r.json()).catch(() => ({ ok: false, ratings: [] }))
        : Promise.resolve({ ok: true, ratings: [] }),
    ])

    // Process public quotes (includes rating, ticker, percent)
    if (publicResponse.ok && publicResponse.quotes) {
      for (const q of publicResponse.quotes as BatchQuoteResult[]) {
        if (q.rating) {
          ratingsMap.set(q.company.toLowerCase(), {
            rating: q.rating,
            type: 'public',
            ticker: q.ticker ?? undefined,
            changePercent: q.changePercent ?? undefined,
            direction: q.direction ?? undefined,
          })
        }
      }
    }

    // Process premarket ratings (rating only)
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
    // Skip excluded words (common nouns that aren't companies)
    if (isExcludedCompanyName(displayName)) continue

    const regex = new RegExp(`\\b${displayName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${displayName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      publicCompanies.push({ apiName, displayName })
    }
  }

  // Find premarket companies (natural mentions or {Company} explicit tags)
  for (const [displayName, apiName] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    // Skip excluded words (common nouns that aren't companies)
    if (isExcludedCompanyName(displayName)) continue

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
 * Generate HTML for vote badges with ticker and percent
 * Format: "Synthszr Vote: Nvidia (NVDA) ↑5.2% Buy, Tesla (TSLA) ↓2.1% Hold"
 * Premarket: "Synthszr Vote: OpenAI Buy" (no ticker/percent)
 */
function generateVoteBadgesHtml(ratings: RatingData[], baseUrl: string, postSlug?: string): string {
  if (ratings.length === 0) return ''

  const badges = ratings.map((r, idx) => {
    const ratingStyle = RATING_STYLES[r.rating]
    const label = r.rating === 'BUY' ? 'Buy' : r.rating === 'HOLD' ? 'Hold' : 'Sell'
    const prefix = idx === 0 ? '<span style="font-weight: bold; text-transform: uppercase; font-size: 13px;">Synthszr Vote:</span> ' : ', '

    // Link to analysis dialog on the blog post
    const href = postSlug
      ? `${baseUrl}/posts/${postSlug}?${r.type === 'premarket' ? 'premarket' : 'stock'}=${encodeURIComponent(r.displayName)}`
      : '#'

    // Build company info: "Nvidia (NVDA) ↑5.2%" for public, "OpenAI" for premarket
    let companyInfo = r.displayName

    // Add ticker for public companies
    if (r.ticker) {
      companyInfo += ` <span style="color: #666;">(${r.ticker})</span>`
    }

    // Add percent change for public companies
    if (typeof r.changePercent === 'number' && r.direction) {
      const arrow = r.direction === 'up' ? '↑' : r.direction === 'down' ? '↓' : '→'
      const percentStyle = PERCENT_STYLES[r.direction]
      companyInfo += ` <span style="${percentStyle}">${arrow}${Math.abs(r.changePercent).toFixed(1)}%</span>`
    }

    return `${prefix}<a href="${href}" style="color: inherit; text-decoration: none;">${companyInfo}</a> <a href="${href}" style="${ratingStyle}">${label}</a>`
  }).join('')

  // Vote badges on new line to avoid forcing wide content
  return `<br/><span style="display: inline-block; margin-top: 8px;">${badges}</span>`
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
 * Convert post content to email-friendly HTML with Synthszr Vote badges
 * Async version that fetches ratings (with ticker/percent for public companies) from APIs
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
        return rawContent
      }
    } catch {
      return rawContent
    }
  } else if (rawContent && typeof rawContent === 'object') {
    doc = rawContent as TiptapDoc
  }

  if (!doc || !doc.content) {
    return post.excerpt || ''
  }

  // Extract full text to find ALL companies
  const fullText = doc.content.map(node => extractTextFromNode(node)).join(' ')
  const allCompaniesInDoc = findCompaniesInText(fullText)

  // Collect all public and premarket companies
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

  // Fetch ratings (includes ticker/percent for public companies)
  const ratingsMap = (allPublicCompanies.size > 0 || allPremarketCompanies.size > 0)
    ? await fetchRatings(Array.from(allPublicCompanies), Array.from(allPremarketCompanies), baseUrl)
    : new Map<string, { rating: 'BUY' | 'HOLD' | 'SELL'; type: 'public' | 'premarket'; ticker?: string; changePercent?: number; direction?: 'up' | 'down' | 'neutral'; isin?: string }>()

  // Convert to HTML with vote badges (no inline tickers)
  const htmlParts = doc.content.map((node, index) => {
    const baseHtml = convertNodeToHtml(node)

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
            ticker: ratingData.ticker,
            changePercent: ratingData.changePercent,
            direction: ratingData.direction,
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
        text = text.replace(synthszrPattern, '<strong style="background-color: #CCFF00; padding: 2px 6px; font-size: 13px; text-transform: uppercase;">$1</strong>')
      }

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              // Check if this is "Synthszr Take:" - add background styling
              if (/synthszr take:?/i.test(text)) {
                text = `<strong style="background-color: #CCFF00; padding: 2px 6px; font-size: 13px; text-transform: uppercase;">${text}</strong>`
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
