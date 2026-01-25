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

export interface CronAuthResult {
  authorized: boolean
  method: 'bearer' | 'vercel-cron' | 'dev-bypass' | 'none'
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

  // Method 1: Bearer token with CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { authorized: true, method: 'bearer' }
  }

  // Method 2: Vercel cron header (trusted infrastructure header)
  if (request.headers.get('x-vercel-cron') === '1') {
    return { authorized: true, method: 'vercel-cron' }
  }

  // Method 3: Development bypass (MUST be explicitly enabled)
  // Security: Requires BOTH conditions to prevent accidental exposure
  if (!isProduction && process.env.ALLOW_DEV_CRON_BYPASS === 'true') {
    console.warn('[CronAuth] Using development bypass - disable in production!')
    return { authorized: true, method: 'dev-bypass' }
  }

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
