import { cookies } from 'next/headers'
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import {
  ADMIN_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME as STORE_COOKIE_NAME,
  createSession as createStoredSession,
  revokeSession as revokeStoredSession,
  verifySession as verifyStoredSession,
  type SessionPayload,
} from '@/lib/auth/session-store'

/**
 * Public surface of admin auth. The implementation moved to
 * lib/auth/session-store.ts (SEC-015): sessions are opaque tokens whose hash
 * lives in `admin_sessions`, instead of self-contained JWTs that could not be
 * revoked before their 7-day expiry. The function signatures are unchanged so
 * the ~119 modules importing this file keep working.
 */

export const SESSION_COOKIE_NAME = STORE_COOKIE_NAME
const SESSION_DURATION = ADMIN_SESSION_TTL_SECONDS

export type { SessionPayload }

export async function createSession(email?: string, name?: string): Promise<string> {
  return createStoredSession(email, name)
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  return verifyStoredSession(token)
}

export async function revokeSession(token: string): Promise<void> {
  return revokeStoredSession(token)
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    return null
  }

  return verifySession(token)
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION,
    path: '/'
  })
}

export async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export function validatePassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminPassword) {
    console.error('ADMIN_PASSWORD is not set')
    return false
  }

  // Use timing-safe comparison to prevent timing attacks
  const passwordBuffer = Buffer.from(password)
  const adminBuffer = Buffer.from(adminPassword)

  // If lengths differ, still do a comparison to maintain constant time
  // but always return false
  if (passwordBuffer.length !== adminBuffer.length) {
    // Compare against itself to maintain constant time
    timingSafeEqual(adminBuffer, adminBuffer)
    return false
  }

  return timingSafeEqual(passwordBuffer, adminBuffer)
}

/**
 * Check if request has valid admin session (for API routes using NextRequest)
 * Use this instead of duplicating isAdminSession() in each route
 */
export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionToken) return false

  return (await verifySession(sessionToken)) !== null
}

/**
 * Require admin authentication for a request.
 * Always checks auth in all environments (no production-only bypass).
 *
 * @returns null if authenticated, NextResponse with 401 if not
 *
 * Usage:
 * const authError = await requireAdmin(request)
 * if (authError) return authError
 */
export async function requireAdmin(request: NextRequest): Promise<Response | null> {
  const isAdmin = await isAdminRequest(request)
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  return null
}

/**
 * Require cron secret OR admin session for a request.
 * Useful for endpoints that can be triggered by cron jobs or manually by admin.
 *
 * @returns null if authenticated, NextResponse with 401 if not
 */
export async function requireCronOrAdmin(request: NextRequest): Promise<Response | null> {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Check cron secret first
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return null
  }

  // Fall back to admin session
  return requireAdmin(request)
}
