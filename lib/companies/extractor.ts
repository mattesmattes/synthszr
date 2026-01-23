/**
 * Company Extractor - Extracts company mentions from TipTap content
 *
 * This module consolidates company detection logic from tiptap-renderer.tsx
 * for use in server-side processing (syncing to post_company_mentions table).
 */

import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import { COMPANY_ALIASES } from '@/lib/data/company-aliases'
import { isExcludedCompanyName } from '@/lib/data/company-exclusions'

export interface ExtractedCompany {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

export interface ArticleCompanyMention {
  company: ExtractedCompany
  articleIndex: number
  articleQueueItemId?: string
  articleHeadline: string
  articleExcerpt: string
}

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: {
    level?: number
    [key: string]: unknown
  }
}

/**
 * Recursively extract text from TipTap JSON structure
 */
function extractTextFromNode(node: TipTapNode): string {
  if (node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(' ')
  }
  return ''
}

/**
 * Extract all text from TipTap content JSON
 */
function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  return extractTextFromNode(content as TipTapNode)
}

/**
 * Extract all company mentions from TipTap content
 *
 * Detects:
 * - Natural mentions: "Apple berichtete..."
 * - Explicit tags: {Apple}
 * - Possessives: "Metas Strategie..."
 * - Compound words: "Google-Aktien"
 * - Aliases: "Cursor" → "Anysphere"
 */
export function extractCompaniesFromContent(content: unknown): ExtractedCompany[] {
  const text = extractTextFromContent(content)
  if (!text) return []

  const companies: ExtractedCompany[] = []
  const seenSlugs = new Set<string>()

  // Helper to add company if not already seen
  const addCompany = (name: string, slug: string, type: 'public' | 'premarket') => {
    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug)
      companies.push({ name, slug, type })
    }
  }

  // Check public companies
  for (const [displayName, apiSlug] of Object.entries(KNOWN_COMPANIES)) {
    // Skip excluded words (common nouns that aren't companies)
    if (isExcludedCompanyName(displayName)) continue

    // Match: Company, Companys (possessive), Company-Aktien (compound)
    const regex = new RegExp(`\\b${escapeRegex(displayName)}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapeRegex(displayName)}\\}`, 'gi')

    if (regex.test(text) || explicitRegex.test(text)) {
      addCompany(displayName, apiSlug, 'public')
    }
  }

  // Check premarket companies
  for (const [displayName, apiSlug] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    if (isExcludedCompanyName(displayName)) continue

    const escapedName = escapeRegex(displayName)
    const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')

    if (regex.test(text) || explicitRegex.test(text)) {
      addCompany(displayName, apiSlug, 'premarket')
    }
  }

  // Check company aliases (e.g., "Cursor" -> "Anysphere")
  for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
    const escapedAlias = escapeRegex(aliasName)
    const regex = new RegExp(`\\b${escapedAlias}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedAlias}\\}`, 'gi')

    if (regex.test(text) || explicitRegex.test(text)) {
      const slug = aliasInfo.canonical.toLowerCase()
      addCompany(aliasInfo.canonical, slug, aliasInfo.type)
    }
  }

  return companies
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Check if text contains a company mention
 */
function textContainsCompany(text: string, displayName: string): boolean {
  const escapedName = escapeRegex(displayName)
  const regex = new RegExp(`\\b${escapedName}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
  const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
  return regex.test(text) || explicitRegex.test(text)
}

/**
 * Extract a short excerpt from text (first ~150 chars, ending at word boundary)
 */
function extractExcerpt(text: string, maxLength: number = 150): string {
  // Clean up text: remove {Company} tags, normalize whitespace
  const cleaned = text
    .replace(/\{[^}]+\}/g, '') // Remove {Company} tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()

  if (cleaned.length <= maxLength) return cleaned

  // Find last space before maxLength
  const truncated = cleaned.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...'
  }
  return truncated + '...'
}

/**
 * Extract companies per article (H2 section) from TipTap content
 *
 * Returns one entry per company per article. A company mentioned in
 * multiple articles will have multiple entries.
 *
 * @param content - TipTap JSON content
 * @param queueItemIds - Optional array of queue item IDs (from generated_posts.pending_queue_item_ids)
 */
export function extractCompaniesPerArticle(
  content: unknown,
  queueItemIds?: string[]
): ArticleCompanyMention[] {
  if (!content || typeof content !== 'object') return []

  const rootNode = content as TipTapNode
  if (!rootNode.content || !Array.isArray(rootNode.content)) return []

  const mentions: ArticleCompanyMention[] = []

  // Parse content into articles (H2 sections)
  // Each article starts with an H2 and includes all content until the next H2
  interface Article {
    index: number
    headline: string
    text: string
    queueItemId?: string
  }

  const articles: Article[] = []
  let currentArticle: Article | null = null
  let articleIndex = 0

  for (const node of rootNode.content) {
    // Check if this is an H2 heading (new article)
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headlineText = extractTextFromNode(node)
      const lowerHeadline = headlineText.toLowerCase()

      // Skip "Synthszr Take" or "Mattes Synthese" headings - these are commentary, not articles
      if (lowerHeadline.includes('synthszr take') ||
          lowerHeadline.includes('mattes synthese') ||
          lowerHeadline.includes("mattes' synthese")) {
        continue
      }

      // Start new article
      currentArticle = {
        index: articleIndex,
        headline: headlineText,
        text: headlineText, // Include headline in searchable text
        queueItemId: queueItemIds?.[articleIndex],
      }
      articles.push(currentArticle)
      articleIndex++
    } else if (currentArticle) {
      // Add content to current article
      const nodeText = extractTextFromNode(node)
      if (nodeText.trim()) {
        currentArticle.text += ' ' + nodeText
      }
    }
  }

  // Now extract companies from each article
  for (const article of articles) {
    const companiesInArticle = new Set<string>()

    // Check public companies
    for (const [displayName, apiSlug] of Object.entries(KNOWN_COMPANIES)) {
      if (isExcludedCompanyName(displayName)) continue

      if (textContainsCompany(article.text, displayName)) {
        if (!companiesInArticle.has(apiSlug)) {
          companiesInArticle.add(apiSlug)
          mentions.push({
            company: { name: displayName, slug: apiSlug, type: 'public' },
            articleIndex: article.index,
            articleQueueItemId: article.queueItemId,
            articleHeadline: article.headline,
            articleExcerpt: extractExcerpt(article.text),
          })
        }
      }
    }

    // Check premarket companies
    for (const [displayName, apiSlug] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
      if (isExcludedCompanyName(displayName)) continue

      if (textContainsCompany(article.text, displayName)) {
        if (!companiesInArticle.has(apiSlug)) {
          companiesInArticle.add(apiSlug)
          mentions.push({
            company: { name: displayName, slug: apiSlug, type: 'premarket' },
            articleIndex: article.index,
            articleQueueItemId: article.queueItemId,
            articleHeadline: article.headline,
            articleExcerpt: extractExcerpt(article.text),
          })
        }
      }
    }

    // Check company aliases (e.g., "Cursor" -> "Anysphere")
    for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
      if (textContainsCompany(article.text, aliasName)) {
        const slug = aliasInfo.canonical.toLowerCase()
        if (!companiesInArticle.has(slug)) {
          companiesInArticle.add(slug)
          mentions.push({
            company: { name: aliasInfo.canonical, slug, type: aliasInfo.type },
            articleIndex: article.index,
            articleQueueItemId: article.queueItemId,
            articleHeadline: article.headline,
            articleExcerpt: extractExcerpt(article.text),
          })
        }
      }
    }
  }

  return mentions
}

/**
 * Parse TipTap content from string or object
 */
export function parseTipTapContent(content: string | object): unknown {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    } catch {
      return null
    }
  }
  return content
}
