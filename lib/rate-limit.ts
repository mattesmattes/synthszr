import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

// Create a rate limiter only if Upstash is configured
let ratelimit: Ratelimit | null = null

function getRateLimiter(): Ratelimit | null {
  if (ratelimit) return ratelimit

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  const isProduction = process.env.NODE_ENV === 'production'

  if (!url || !token) {
    if (isProduction) {
      // In production, rate limiting MUST be configured
      console.error('[RateLimit] CRITICAL: Upstash Redis not configured in production!')
      console.error('[RateLimit] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')
      // Don't throw - gracefully degrade but log loudly on every request
    } else {
      console.warn('[RateLimit] Rate limiting disabled in development')
    }
    return null
  }

  ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
    analytics: true,
    prefix: 'synthszr',
  })

  return ratelimit
}

export interface RateLimitResult {
  success: boolean
  remaining: number
  reset: number
  limit: number
}

/**
 * Check rate limit for a request
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param limit - Optional: requests per window (default: 10)
 * @param window - Optional: window duration (default: '1 m')
 */
export async function checkRateLimit(
  identifier: string,
  customLimiter?: Ratelimit
): Promise<RateLimitResult> {
  const limiter = customLimiter || getRateLimiter()

  if (!limiter) {
    // If rate limiting is not configured in production, log every request as warning
    if (process.env.NODE_ENV === 'production') {
      console.error(`[RateLimit] UNPROTECTED REQUEST: ${identifier} - configure Upstash Redis!`)
    }
    // Allow but mark as unprotected
    return { success: true, remaining: 0, reset: Date.now() + 60000, limit: 0 }
  }

  const result = await limiter.limit(identifier)

  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
    limit: result.limit,
  }
}

/**
 * Get client IP from request headers
 */
export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  if (realIP) {
    return realIP
  }

  return 'anonymous'
}

/**
 * Create a rate-limited response
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: 'Too many requests',
      retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.reset.toString(),
        'Retry-After': Math.ceil((result.reset - Date.now()) / 1000).toString(),
      },
    }
  )
}

/**
 * Rate limiter presets for different endpoints
 */
export const rateLimiters = {
  // Newsletter: 10 requests per hour (anti-spam for subscription endpoints)
  newsletter: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'synthszr:newsletter',
    })
  },

  // Strict: 5 requests per minute (for expensive operations like image generation)
  strict: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(5, '1 m'),
      prefix: 'synthszr:strict',
    })
  },

  // Standard: 30 requests per minute
  standard: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      prefix: 'synthszr:standard',
    })
  },

  // Relaxed: 100 requests per minute (for public read endpoints)
  relaxed: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(100, '1 m'),
      prefix: 'synthszr:relaxed',
    })
  },

  // Admin: 60 requests per minute (for authenticated admin endpoints)
  // Prevents abuse even with valid session (e.g., compromised credentials)
  admin: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      prefix: 'synthszr:admin',
    })
  },

  // Admin write: 20 requests per minute (for admin write operations)
  // More restrictive for state-changing operations
  adminWrite: () => {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null

    return new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(20, '1 m'),
      prefix: 'synthszr:admin-write',
    })
  },
}
