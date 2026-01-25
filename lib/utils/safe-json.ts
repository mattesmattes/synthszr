/**
 * Safe JSON parsing utilities
 *
 * Provides error handling for JSON.parse operations to prevent
 * unhandled exceptions from malformed database content.
 */

/**
 * Safely parse a JSON string, returning the parsed value or a fallback
 *
 * @param value - The value to parse (string or already-parsed object)
 * @param fallback - Value to return if parsing fails (default: null)
 * @returns The parsed object, original value (if not string), or fallback on error
 */
export function safeParseJSON<T = unknown>(
  value: string | T,
  fallback: T | null = null
): T | null {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as T
  } catch (error) {
    console.error('[safeParseJSON] Failed to parse JSON:', error instanceof Error ? error.message : error)
    return fallback
  }
}

/**
 * Safely parse a JSON string with explicit error information
 *
 * @param value - The value to parse (string or already-parsed object)
 * @returns Object with either data or error field
 */
export function safeParseJSONWithError<T = unknown>(
  value: string | T
): { data: T; error: null } | { data: null; error: string } {
  if (typeof value !== 'string') {
    return { data: value, error: null }
  }

  try {
    return { data: JSON.parse(value) as T, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    return { data: null, error: message }
  }
}

/**
 * Parse TipTap JSON content from database
 * Returns empty document structure on failure to prevent render errors
 */
export function parseTipTapContent(
  content: string | Record<string, unknown>
): Record<string, unknown> {
  const emptyDoc = { type: 'doc', content: [] }

  if (typeof content !== 'string') {
    return content || emptyDoc
  }

  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch (error) {
    console.error('[parseTipTapContent] Failed to parse TipTap JSON:', error instanceof Error ? error.message : error)
    return emptyDoc
  }
}
