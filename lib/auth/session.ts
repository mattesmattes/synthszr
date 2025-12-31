import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const SESSION_COOKIE_NAME = 'synthszr_session'
const SESSION_DURATION = 60 * 60 * 24 * 7 // 7 days in seconds

function getSecretKey() {
  const secret = process.env.ADMIN_PASSWORD
  if (!secret) {
    throw new Error('ADMIN_PASSWORD environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

export interface SessionPayload {
  isAdmin: boolean
  expiresAt: Date
}

export async function createSession(): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION * 1000)

  const token = await new SignJWT({ isAdmin: true })
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

  return password === adminPassword
}
