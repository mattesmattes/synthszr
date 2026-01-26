import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

/**
 * Convert straight quotes and English curly quotes to German typographic quotes
 * German: „..." (U+201E opening, U+201C closing)
 *
 * Handles:
 * - Straight quotes: "text" → „text"
 * - English curly quotes: "text" → „text"
 * - Mixed/nested quotes
 */
function normalizeToGermanQuotes(text: string): string {
  // First, normalize all quote types to straight quotes for uniform processing
  let normalized = text
    // English curly quotes to straight
    .replace(/[\u201C\u201D]/g, '"')  // " and " → "
    // German quotes to straight (in case of mixed input)
    .replace(/[\u201E]/g, '"')         // „ → "
    // French guillemets to straight (if used as quotes)
    .replace(/[«»]/g, '"')

  // Now convert straight quotes to German quotes
  // Strategy: track quote state and alternate between opening/closing
  const result: string[] = []
  let inQuote = false

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]

    if (char === '"') {
      if (!inQuote) {
        // Opening quote: „ (U+201E)
        result.push('„')
        inQuote = true
      } else {
        // Closing quote: " (U+201C)
        result.push('"')
        inQuote = false
      }
    } else {
      result.push(char)
    }
  }

  return result.join('')
}

/**
 * Converts markdown string to TipTap JSON format
 * Includes Link extension to properly handle markdown links
 * Normalizes quotes to German typographic quotes
 */
export function markdownToTiptap(markdown: string): Record<string, unknown> {
  // Normalize quotes to German typographic quotes before processing
  const normalizedMarkdown = normalizeToGermanQuotes(markdown)

  // Convert markdown to HTML
  const html = marked.parse(normalizedMarkdown, { async: false }) as string

  // Convert HTML to TipTap JSON with Link extension for proper link handling
  const json = generateJSON(html, [
    StarterKit,
    Link.configure({
      openOnClick: false,
    }),
  ])

  return json
}

/**
 * Converts TipTap JSON to HTML string
 */
export function tiptapToHtml(json: Record<string, unknown>): string {
  const { generateHTML } = require('@tiptap/core')
  return generateHTML(json, [
    StarterKit,
    Link.configure({
      openOnClick: false,
    }),
  ])
}
