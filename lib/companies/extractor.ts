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

interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
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
