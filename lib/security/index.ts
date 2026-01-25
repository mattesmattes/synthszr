/**
 * Security Module
 *
 * Centralized security utilities for the Synthszr application.
 */

// Cron authentication
export { verifyCronAuth, isCronAuthConfigured } from './cron-auth'
export type { CronAuthResult } from './cron-auth'

// Startup validation
export { validateSecurityConfig, enforceSecurityConfig } from './startup-checks'
export type { SecurityCheckResult } from './startup-checks'

// Origin validation (CSRF protection for public endpoints)
export { verifyOrigin, requireValidOrigin } from './origin-check'
