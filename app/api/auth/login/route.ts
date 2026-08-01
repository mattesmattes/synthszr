import { NextRequest, NextResponse } from 'next/server'
import { createSession, setSessionCookie, validatePassword } from '@/lib/auth/session'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // Rate-Limit gegen Brute-Force aufs Admin-Passwort (5/min pro IP)
    const rl = await checkRateLimit(`login:${getClientIP(request)}`, rateLimiters.strict() ?? undefined)
    if (!rl.success) return rateLimitResponse(rl)

    const body = await request.json()
    const { password } = body

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      )
    }

    if (!validatePassword(password)) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      )
    }

    const token = await createSession()
    await setSessionCookie(token)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
