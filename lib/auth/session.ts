import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'

export const SESSION_COOKIE_NAME = 'synthszr_session'
const SESSION_DURATION = 60 * 60 * 24 * 7 // 7 days in seconds

function getSecretKey() {
  // Use JWT_SECRET if available, fallback to ADMIN_PASSWORD for backwards compatibility
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) {
    throw new Error('JWT_SECRET or ADMIN_PASSWORD environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

export interface SessionPayload {
  isAdmin: boolean
  email?: string
  name?: string
  expiresAt: Date
}

export async function createSession(email?: string, name?: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION * 1000)

  const token = await new SignJWT({ isAdmin: true, email, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresAt)
    .setIssuedAt()
    .sign(getSecretKey())

  return token
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())

    return {
      isAdmin: payload.isAdmin as boolean,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      expiresAt: new Date((payload.exp as number) * 1000)
    }
  } catch {
    return null
  }
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

  try {
    const secretKey = getSecretKey()
    await jwtVerify(sessionToken, secretKey)
    return true
  } catch {
    return false
  }
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
