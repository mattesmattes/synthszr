import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'
import { getAuthUrl, GMAIL_OAUTH_STATE_COOKIE } from '@/lib/gmail/oauth'
import { getSession } from '@/lib/auth/session'

const STATE_MAX_AGE = 60 * 10 // 10 Minuten

export async function GET() {
  // Verify admin is logged in
  const session = await getSession()

  if (!session) {
    return NextResponse.json(
      { error: 'Nicht autorisiert' },
      { status: 401 }
    )
  }

  try {
    // CSRF-Schutz: state-Parameter erzeugen, als httpOnly-Cookie speichern
    // und an Google übergeben. Im Callback wird er gegen das Cookie geprüft.
    const state = randomUUID()
    const cookieStore = await cookies()
    cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: STATE_MAX_AGE,
      path: '/',
    })

    const authUrl = getAuthUrl(state)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Error generating auth URL:', error)
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    )
  }
}
