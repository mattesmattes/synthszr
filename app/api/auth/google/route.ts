import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { getAdminAuthUrl, ADMIN_OAUTH_STATE_COOKIE } from '@/lib/auth/google'

const STATE_MAX_AGE = 60 * 10 // 10 Minuten

export async function GET() {
  // CSRF-Schutz: state-Parameter erzeugen, als httpOnly-Cookie speichern
  // und an Google übergeben. Im Callback wird er gegen das Cookie geprüft.
  const state = randomUUID()
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_MAX_AGE,
    path: '/',
  })

  const authUrl = getAdminAuthUrl(state)
  return NextResponse.redirect(authUrl)
}
