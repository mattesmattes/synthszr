/**
 * Supabase Error Handling Utilities
 *
 * Provides consistent error handling patterns for Supabase queries,
 * especially for .single() calls which throw on no results.
 */

import { PostgrestError } from '@supabase/supabase-js'

/** Error code when .single() finds no matching rows */
export const PGRST116_NO_ROWS = 'PGRST116'

/** Error code when .single() finds multiple rows */
export const PGRST_MULTIPLE_ROWS = 'PGRST116'

/**
 * Check if a Supabase error is a "no rows found" error from .single()
 * This is often expected behavior (e.g., checking if a record exists)
 */
export function isNoRowsError(error: PostgrestError | null): boolean {
  return error?.code === PGRST116_NO_ROWS
}

/**
 * Check if a Supabase error is an unexpected database error
 * (not a "no rows found" which is often expected)
 */
export function isUnexpectedError(error: PostgrestError | null): boolean {
  return error !== null && error.code !== PGRST116_NO_ROWS
}

/**
 * Log an error only if it's unexpected (not "no rows found")
 * Returns true if an unexpected error was logged
 */
export function logIfUnexpected(
  context: string,
  error: PostgrestError | null
): boolean {
  if (isUnexpectedError(error)) {
    console.error(`[${context}] Database error:`, error)
    return true
  }
  return false
}
