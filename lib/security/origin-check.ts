/**
 * Origin Header Validation
 *
 * Simpler CSRF protection for public endpoints.
 * Verifies that requests come from our own domain by checking
 * Origin and Referer headers.
 *
 * This is effective against CSRF because:
 * - Browsers always send Origin header for cross-origin POST requests
 * - Attackers cannot spoof Origin headers from JavaScript
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Get allowed origins from environment
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = []

  // Production domain (from env)
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    const baseOrigin = new URL(process.env.NEXT_PUBLIC_BASE_URL).origin
    origins.push(baseOrigin)
    // Also allow www variant
    if (baseOrigin.startsWith('https://') && !baseOrigin.includes('www.')) {
      origins.push(baseOrigin.replace('https://', 'https://www.'))
    }
  }

  // Vercel preview deployments
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`)
  }

  // Vercel production URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  }

  // Development
  if (process.env.NODE_ENV === 'development') {
    origins.push('http://localhost:3000')
    origins.push('http://127.0.0.1:3000')
  }

  return origins
}

/**
 * Check if request origin is allowed
 */
export function verifyOrigin(request: NextRequest): { valid: boolean; origin: string | null } {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // For same-origin requests, Origin might be null
  // In that case, check Referer
  const requestOrigin = origin || (referer ? new URL(referer).origin : null)

  if (!requestOrigin) {
    // No origin info - could be same-origin or curl/Postman
    // Be strict: require origin for POST requests
    return { valid: false, origin: null }
  }

  const allowedOrigins = getAllowedOrigins()

  // Check if origin is in allowed list (exact match only - no wildcards)
  // Vercel preview URLs are added explicitly via VERCEL_URL env var
  const isAllowed = allowedOrigins.some(allowed => requestOrigin === allowed)

  return { valid: isAllowed, origin: requestOrigin }
}

/**
 * Middleware helper for origin validation
 * Returns error response if origin is invalid, null if valid
 */
export function requireValidOrigin(request: NextRequest): NextResponse | null {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return null
  }

  const { valid, origin } = verifyOrigin(request)

  if (!valid) {
    console.warn(`[OriginCheck] Blocked request from origin: ${origin || 'unknown'}`)
    return NextResponse.json(
      { error: 'Invalid request origin' },
      { status: 403 }
    )
  }

  return null
}
