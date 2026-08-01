/**
 * Security Module
 *
 * Centralized security utilities for the Synthszr application.
 */

// Cron authentication
export { verifyCronAuth, isCronAuthConfigured, verifyBearerToken } from './cron-auth'
export type { CronAuthResult } from './cron-auth'

// Startup validation
export { validateSecurityConfig, enforceSecurityConfig } from './startup-checks'
export type { SecurityCheckResult } from './startup-checks'

// Origin validation (CSRF protection for public endpoints)
export { verifyOrigin, requireValidOrigin } from './origin-check'

// SSRF protection (blocklist-based, for the article crawler and other
// server-side fetches of externally-supplied URLs)
export { assertPublicUrl, safeFetch, isPrivateIP, isPrivateIPv4, isPrivateIPv6 } from './ssrf'
