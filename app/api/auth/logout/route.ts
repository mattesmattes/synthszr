import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, deleteSessionCookie, revokeSession } from '@/lib/auth/session'

/**
 * Logout revokes the session server-side before clearing the cookie
 * (SEC-015). Deleting the cookie alone used to leave the token valid for the
 * rest of its lifetime, so any copy of it kept working.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
    if (token) {
      await revokeSession(token)
    }
    await deleteSessionCookie()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
