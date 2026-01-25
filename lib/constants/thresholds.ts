/**
 * Centralized Thresholds and Constants
 *
 * This file contains commonly used numeric thresholds and limits
 * that are shared across the application. Centralizing these values
 * makes them easier to find, audit, and update consistently.
 */

// =============================================================================
// API & Pagination
// =============================================================================

/** Default number of items per page for paginated API endpoints */
export const DEFAULT_LIMIT = 10

/** Maximum number of companies per batch request */
export const MAX_BATCH_SIZE = 20

// =============================================================================
// Caching
// =============================================================================

/** Cache TTL for stock synthszr ratings (in hours) */
export const CACHE_TTL_HOURS = 24

/** Cache TTL for middleware language cache (in milliseconds) */
export const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// =============================================================================
// Rate Limiting
// =============================================================================

/** Default rate limit per minute for API endpoints */
export const RATE_LIMIT_PER_MINUTE = 30

// =============================================================================
// Synthesis Pipeline
// =============================================================================

/** Minimum number of sources required for synthesis */
export const SYNTHESIS_MIN_SOURCES = 3

// =============================================================================
// Edit Learning System
// =============================================================================

/** Minimum cosine similarity for clustering similar edits */
export const SIMILARITY_THRESHOLD = 0.85

/** Minimum confidence score for patterns to be included in Ghostwriter prompts */
export const PATTERN_MIN_CONFIDENCE = 0.4

/** Confidence increase when user keeps a pattern */
export const PATTERN_KEEP_DELTA = 0.1

/** Confidence decrease when user reverts a pattern */
export const PATTERN_REVERT_DELTA = -0.1

/** Confidence threshold below which patterns are auto-deactivated */
export const PATTERN_DEACTIVATE_THRESHOLD = 0.3

/** Maximum number of patterns to include in Ghostwriter prompts */
export const PATTERN_MAX_COUNT = 20

/** Weekly decay factor for pattern confidence */
export const PATTERN_DECAY_FACTOR = 0.95

// =============================================================================
// Scheduled Tasks (Cron)
// =============================================================================

/** Maximum number of digest sections to process for image generation */
export const MAX_DIGEST_SECTIONS = 3

/** Maximum characters to include in content preview for image generation */
export const MAX_CONTENT_PREVIEW_CHARS = 2000

/** Minimum length (characters) for analysis content to be considered valid */
export const MIN_ANALYSIS_LENGTH = 100
