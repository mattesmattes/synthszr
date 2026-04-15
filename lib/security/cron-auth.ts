/**
 * Cron Authentication
 *
 * Secure authentication for cron job endpoints.
 * Supports:
 * - Bearer token with CRON_SECRET
 * - Vercel cron header (x-vercel-cron)
 * - Optional dev bypass via ALLOW_DEV_CRON_BYPASS env var
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

export interface CronAuthResult {
  authorized: boolean
  method: 'bearer' | 'vercel-cron' | 'none'
}

/**
 * Constant-time compare of an incoming "Authorization: Bearer <token>"
 * header against the expected secret. Prevents timing side-channels on
 * early-exit string comparison.
 *
 * Exported so all CRON_SECRET checks across the codebase can use the
 * same helper instead of `===`.
 */
export function verifyBearerToken(authHeader: string | null, expected: string | undefined): boolean {
  if (!authHeader || !expected) return false
  const prefix = 'Bearer '
  if (!authHeader.startsWith(prefix)) return false
  const provided = authHeader.slice(prefix.length)
  const providedBuf = Buffer.from(provided, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')
  if (providedBuf.length !== expectedBuf.length) {
    // Still do a constant-time dummy compare to equalize timing
    try { timingSafeEqual(providedBuf, providedBuf) } catch { /* noop */ }
    return false
  }
  try {
    return timingSafeEqual(providedBuf, expectedBuf)
  } catch {
    return false
  }
}

/**
 * Verify cron request authentication
 *
 * Security considerations:
 * - In production, CRON_SECRET is REQUIRED
 * - Dev bypass only works if ALLOW_DEV_CRON_BYPASS=true AND NODE_ENV=development
 * - Vercel cron header is trusted (set by Vercel infrastructure)
 */
export function verifyCronAuth(request: NextRequest): CronAuthResult {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isProduction = process.env.NODE_ENV === 'production'

  // Method 1: Bearer token with CRON_SECRET (constant-time compare)
  if (verifyBearerToken(authHeader, cronSecret)) {
    return { authorized: true, method: 'bearer' }
  }

  // Method 2: Vercel cron header (trusted infrastructure header)
  if (request.headers.get('x-vercel-cron') === '1') {
    return { authorized: true, method: 'vercel-cron' }
  }

  // Method 3: Development bypass (REMOVED for security)
  // Previously allowed bypass in development - now require CRON_SECRET in all environments
  // If you need to test cron endpoints locally, set CRON_SECRET in .env.local

  // Production safety: If no CRON_SECRET is set, log error
  if (isProduction && !cronSecret) {
    console.error('[CronAuth] CRITICAL: CRON_SECRET not configured in production!')
  }

  return { authorized: false, method: 'none' }
}

/**
 * Check if cron authentication is properly configured
 */
export function isCronAuthConfigured(): boolean {
  return !!process.env.CRON_SECRET
}
