/**
 * Application-wide constants
 * Centralized configuration for magic numbers used across the codebase
 */

// Time constants (in milliseconds)
export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = 60 * MS_PER_SECOND
export const MS_PER_HOUR = 60 * MS_PER_MINUTE
export const MS_PER_DAY = 24 * MS_PER_HOUR

// Cache TTLs
export const STOCK_SYNTHSZR_CACHE_DAYS = 14
export const STOCK_SYNTHSZR_CACHE_MS = STOCK_SYNTHSZR_CACHE_DAYS * MS_PER_DAY

// Newsletter fetch settings
export const DEFAULT_NEWSLETTER_FETCH_HOURS = 36
export const DEFAULT_NEWSLETTER_FETCH_MS = DEFAULT_NEWSLETTER_FETCH_HOURS * MS_PER_HOUR

// Session settings (already defined in lib/auth/session.ts, but exported here for reference)
export const SESSION_DURATION_DAYS = 7

// Synthesis settings
export const SYNTHESIS_HISTORY_DAYS = 90
