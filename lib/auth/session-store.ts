/**
 * Server-side admin session store (SEC-015).
 *
 * The session used to be a self-contained JWT valid for 7 days. That means it
 * could not be revoked: logging out deleted the cookie, but the token itself
 * stayed valid until expiry, so any copy - taken from a browser, a proxy log,
 * a synced profile, a backup - kept working. The only kill switch was rotating
 * JWT_SECRET, which logs out everyone at once.
 *
 * A session is now an opaque 256-bit random token. Postgres stores only its
 * SHA-256 hash, so reading `admin_sessions` yields nothing replayable, and
 * every request checks the row - which makes revocation immediate and a 12
 * hour TTL enforceable server-side rather than merely asserted in a claim.
 *
 * RUNTIME NOTE: hashing goes through Web Crypto, not node:crypto, because
 * middleware.ts calls verifySession() on every /admin request and the edge
 * runtime has no node:crypto. Web Crypto exists in both.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export const SESSION_COOKIE_NAME = 'synthszr_session'

/** 12 hours: short enough that a stolen cookie has a small window, long
 *  enough to survive a working session without re-login. */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60

const TOKEN_BYTES = 32

export interface SessionPayload {
  isAdmin: true
  email?: string
  name?: string
  expiresAt: Date
}

export async function hashSessionToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  // base64url without padding - safe in a cookie value and in a URL.
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Mint a session and persist its hash. Returns the raw token for the cookie;
 * it is never stored or logged.
 */
export async function createSession(email?: string, name?: string): Promise<string> {
  const rawToken = randomToken()
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000)

  const { error } = await createAdminClient()
    .from('admin_sessions')
    .insert({
      token_hash: await hashSessionToken(rawToken),
      is_admin: true,
      email: email ?? null,
      name: name ?? null,
      expires_at: expiresAt.toISOString(),
    })

  if (error) {
    // Surface it: a session that was not stored cannot be verified, so the
    // caller must not hand out a cookie for it.
    throw new Error(`Could not create session: ${error.message}`)
  }

  return rawToken
}

/**
 * Resolve a cookie value to its session, or null. Fails closed on unknown,
 * expired, revoked and non-admin rows, and on database errors.
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  if (!token) return null

  const { data, error } = await createAdminClient()
    .from('admin_sessions')
    .select('is_admin, email, name, expires_at')
    .eq('token_hash', await hashSessionToken(token))
    .eq('is_admin', true)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data) return null

  return {
    isAdmin: true,
    email: (data.email as string | null) ?? undefined,
    name: (data.name as string | null) ?? undefined,
    expiresAt: new Date(data.expires_at as string),
  }
}

/**
 * Invalidate a single session immediately. Idempotent, and deliberately quiet:
 * logout must succeed for the user even if the row is already gone.
 */
export async function revokeSession(token: string): Promise<void> {
  if (!token) return

  const { error } = await createAdminClient()
    .from('admin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', await hashSessionToken(token))
    .is('revoked_at', null)

  if (error) {
    console.error('[Auth] Could not revoke session:', error.message)
  }
}
