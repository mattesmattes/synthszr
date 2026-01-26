/**
 * Typography utilities for language-specific formatting
 */

import type { LanguageCode } from '@/lib/types'

/**
 * Quote styles by language
 * - German (de, nds): „..." (U+201E opening, U+201C closing)
 * - English (en): "..." (U+201C opening, U+201D closing)
 * - Czech (cs): „..." (same as German)
 * - French (fr): « ... » (with non-breaking spaces)
 * - Other languages default to English style
 */
const QUOTE_STYLES: Record<string, { open: string; close: string }> = {
  de: { open: '\u201E', close: '\u201C' },   // „..."
  nds: { open: '\u201E', close: '\u201C' },  // „..." (Low German uses German style)
  cs: { open: '\u201E', close: '\u201C' },   // „..." (Czech uses German style)
  en: { open: '\u201C', close: '\u201D' },   // "..."
  fr: { open: '\u00AB\u00A0', close: '\u00A0\u00BB' }, // « ... » with nbsp
  es: { open: '\u00AB', close: '\u00BB' },   // «...»
  it: { open: '\u00AB', close: '\u00BB' },   // «...»
  pt: { open: '\u201C', close: '\u201D' },   // "..."
  nl: { open: '\u201C', close: '\u201D' },   // "..."
  pl: { open: '\u201E', close: '\u201D' },   // „..."
}

// Default to English style
const DEFAULT_QUOTES = { open: '\u201C', close: '\u201D' }

/**
 * Get the quote style for a language
 */
export function getQuoteStyle(language: string): { open: string; close: string } {
  return QUOTE_STYLES[language] || DEFAULT_QUOTES
}

/**
 * Normalize quotes in text to the correct typographic style for the given language
 *
 * Handles:
 * - Straight quotes: "..."
 * - English curly quotes: "..."
 * - German quotes: „..."
 * - French guillemets: «...»
 */
export function normalizeQuotes(text: string, language: LanguageCode | string): string {
  const { open, close } = getQuoteStyle(language)

  // First, normalize all quote types to a placeholder
  let normalized = text
    // Straight quotes
    .replace(/"/g, '\x00QUOTE\x00')
    // English curly quotes
    .replace(/[\u201C\u201D]/g, '\x00QUOTE\x00')
    // German quotes
    .replace(/[\u201E]/g, '\x00QUOTE\x00')
    // French guillemets (without spaces)
    .replace(/[«»]/g, '\x00QUOTE\x00')

  // Now convert placeholders to correct quotes using state machine
  const result: string[] = []
  let inQuote = false
  let i = 0

  while (i < normalized.length) {
    // Check for placeholder
    if (normalized.slice(i, i + 7) === '\x00QUOTE\x00') {
      if (!inQuote) {
        result.push(open)
        inQuote = true
      } else {
        result.push(close)
        inQuote = false
      }
      i += 7 // Skip placeholder
    } else {
      result.push(normalized[i])
      i++
    }
  }

  return result.join('')
}

/**
 * Recursively normalize quotes in TipTap JSON content
 */
export function normalizeQuotesInTipTap(
  content: Record<string, unknown>,
  language: LanguageCode | string
): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(content, (key, value) => {
      // Only process text content in TipTap nodes
      if (key === 'text' && typeof value === 'string') {
        return normalizeQuotes(value, language)
      }
      return value
    })
  )
}

/**
 * Normalize quotes in a plain string for the given language
 * Convenience wrapper for normalizeQuotes
 */
export function fixQuotes(text: string, language: LanguageCode | string): string {
  return normalizeQuotes(text, language)
}
